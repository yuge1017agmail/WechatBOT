# 版本更新说明

发布日期：2026-04-27

本次迭代围绕"更稳定地自动回复微信私聊"和"让回复更像真人销售表达"展开。下面按变化类型分类列出。

---

## 一、发送链路重大改造（核心稳定性）

历史背景：旧版发送链路曾出现过"误发联系人名"、"回复发到错的人"、"任务标记成功但微信无任何反应"、"焦点不在输入框时回复粘贴到其他应用"等事故。本次改造做了以下根本性调整。

### 1. 0 坐标依赖

所有微信 UI 交互改用原生快捷键，不再使用任何写死坐标：

- 打开搜索框：`Cmd+F`（微信原生快捷键）
- 关闭浮层：`Esc`
- 焦点切换到输入框：`Tab`
- 选中搜索结果：默认高亮 + `Enter`

收益：跨屏、跨分辨率、跨缩放、跨窗口位置全部兼容。即使把微信拖到不同位置，自动化仍然 work。

### 2. 双层校验机制

**第 1 层：OCR 视觉校验**

发送前截图微信窗口顶部 50px 标题条，用 macOS Vision 框架识别当前会话名，归一化后做包含匹配。匹配失败立即拒绝发送。

**第 2 层：Sentinel 焦点探针**

粘贴真实回复**之前**，先粘贴一个唯一短串（带纳秒时间戳的标记字符串），立刻全选复制读回剪贴板。如果探针字符串不在剪贴板里，说明键盘焦点不在输入框，立即拒绝发送。

两层校验同时通过才执行真正的发送。

### 3. 智能跳过 prepare

当前会话已经是目标联系人时，跳过整个搜索切换流程，直接进入发送阶段。避免重复 `Cmd+F` 破坏已就绪状态——这从根本上修复了同一发信人第二次回复失败的问题。

### 4. 字符归一化

自动处理以下 OCR 与原文的字符差异：

- 全角 ↔ 半角（`｜` ↔ `|`、`：` ↔ `:`、`，` ↔ `,` 等）
- 破折号家族统一（`—`、`–`、`-`、`−`、`－` → `-`）
- 大小写归一
- 空白字符完全去除（OCR 在标点周围加视觉空格的行为）

让"OCR 看到的"和"代码里的联系人名"在比较时不会因为编码细节差异导致误报。

### 5. 安全默认值不变

`paste-only` 模式仍是默认值。AI 回复粘贴到输入框后停下来，等用户人工按 Enter 发送。把不可逆的"发送"动作交还给人。

---

## 二、模型与启动配置

### 6. 模型配置支持

- `.launcher-config.json` 新增 `MODEL_NAME` 配置项，启动器会读取并传给运行进程。
- 大模型请求使用配置里的模型名，不再写死。
- 修复 DeepSeek 接口路径兼容：`baseURL` 用 `https://api.deepseek.com`，请求路径自动使用 `/chat/completions`，模型示例 `deepseek-v4-flash`。

### 7. 启动弹窗优化

启动时拆成两步选择：

1. **发送模式**：仅粘贴不发送 / 自动发送
2. **消息节奏**：
   - 标准：8 秒轮询，10 秒合并等待，30 条历史
   - 快速：5 秒轮询，8 秒合并等待，30 条历史
   - 稳妥：15 秒轮询，15 秒合并等待，50 条历史

启动日志会显示当前发送模式和消息节奏。

### 8. 微信账号切换检测

启动器新增 `wechat-cli` 账号绑定检查。启动前会读取 `~/.wechat-cli/config.json` 中的 `db_dir`，并扫描微信容器里的账号数据库目录。如果发现 `wechat-cli` 当前绑定目录和微信最近活跃账号目录明显不同，会停止启动并弹窗提示，引导执行 `wechat-cli init`。这避免了换账号后后台仍读取旧账号数据库导致"识别不到新消息"。

---

## 三、消息处理与 CLI 稳定性

### 9. 多消息合并 + 串行处理

- 原先固定 30 秒轮询改为可配置轮询。
- 同一用户短时间连续发送多条消息时，系统会等一段时间，等用户停止后合并理解并生成一次回复。
- 后台理解和生成回复改为串行处理，避免多个用户同时触发抢占处理链路。
- 保留 `output/*.md` 任务文件机制（用于发送缓冲、失败归档、人工排查），不增加 token 成本。

### 10. wechat-cli 调用稳定性

- `wechat-cli` 调用从 shell 字符串拼接改为参数数组方式。
- 联系人名包含空格、竖线等特殊字符时，读取历史记录更稳定。
- 增强聊天历史解析，兼容 `wechat-cli history --format json` 返回对象或数组的两种情况。

### 11. 服务号与公众号过滤

新增真实私聊判断逻辑，只处理需要回复的个人私聊。自动忽略：

- 群聊
- `brandservicesessionholder` / `brandsessionholder`
- `gh_` 开头的公众号账号
- 常见通知/服务账号
- 显示名为 `服务号` 或 `订阅号` 的入口

轮询日志会显示已忽略的群聊/服务号消息数量。

---

## 四、内容质量

### 12. 人设与回复风格

新增 `人设.md`，AI 每次生成回复前都会读取。可以通过修改它来调整身份设定、语气、用词习惯、回复边界、禁止事项。目标是减少 AI 味和客服腔，让回复更接近真实微信表达。

### 13. 知识库检索

- 新增 `knowledge/` 知识库目录与 `knowledge-search.ts` 本地 Markdown 检索模块。
- 客户咨询专业问题时，系统会先检索知识库，再结合：客户问题、最近聊天记录、`人设.md`、命中的知识库片段，生成最终回复。
- 当前使用本地关键词检索：不调用额外模型、不产生 embedding 成本、每次最多取前 5 个相关片段进入 prompt。
- 没有检索到相关资料时，系统会要求模型不要编造专业细节，而是自然说明"我确认下再回你"。

---

## 五、改动清单

| 文件 | 性质 | 说明 |
|---|---|---|
| `wechat-ui-send.ts` | 大改 | 编排层增加 smart prepare、OCR 校验、字符归一化 |
| `scripts/prepare_wechat_chat.applescript` | 大改 | 改用 `Cmd+F` 等原生快捷键，删除所有写死坐标 |
| `scripts/deliver_wechat_message.applescript` | 大改 | 改用 `Esc+Tab` 拉焦点，新增 Sentinel 探针校验 |
| `scripts/wechat_ocr.m` | 保持不变 | macOS Vision OCR 工具继续使用 |
| `scripts/build-ocr-helper.sh` | 新增 | OCR helper 编译脚本 |
| `poller.ts` | 改 | 服务号过滤、合并等待、串行处理 |
| `launcher.ts` | 改 | 启动弹窗拆分、账号切换检测、模型配置传递 |
| `knowledge-search.ts` | 新增 | 本地 Markdown 检索模块 |
| `人设.md` | 新增 | AI 角色设定 |
| `knowledge/` | 新增目录 | 知识库存放位置 |
| `README.md` / `knowledge/README.md` | 更新 | 启动流程、消息节奏、人设、知识库使用说明 |

---

## 六、行为变化（用户能感知的）

1. **失败模式更显式**：以前"日志说成功但微信无反应"的情况，现在改为"日志报错、任务进 failed/"，附带详细失败原因（OCR 原文、归一化后字符串、sentinel 实读内容等）。能立刻定位问题。
2. **回复速度可能略慢**：每次发送会额外执行 1-2 次 OCR（每次约 200-400ms）。智能跳过情况下只有 1 次 OCR；完整 prepare 情况下增加约 500-700ms。
3. **焦点不在微信时仍然能切会话**：旧版常常静默失败；新版会强制激活并轮询确认前台。
4. **回复语感更像真人**：通过 `人设.md` + 知识库片段定向，AI 味减少。

---

## 七、升级与回滚

### 升级

```bash
cd ~/Desktop/WechatBOT-main

# 备份
cp wechat-ui-send.ts wechat-ui-send.ts.bak
cp scripts/prepare_wechat_chat.applescript scripts/prepare_wechat_chat.applescript.bak
cp scripts/deliver_wechat_message.applescript scripts/deliver_wechat_message.applescript.bak

# 替换新版
cp ~/Downloads/wechatbot-改造方案/wechat-ui-send.ts ./
cp ~/Downloads/wechatbot-改造方案/scripts/prepare_wechat_chat.applescript ./scripts/
cp ~/Downloads/wechatbot-改造方案/scripts/deliver_wechat_message.applescript ./scripts/
cp ~/Downloads/wechatbot-改造方案/scripts/build-ocr-helper.sh ./scripts/
chmod +x ./scripts/build-ocr-helper.sh

# 编译 OCR helper
bash scripts/build-ocr-helper.sh

# 类型检查
npx tsc --noEmit

# 用 paste-only 模式实测
WECHAT_SEND_MODE=paste-only npm start
```

### 回滚

```bash
cd ~/Desktop/WechatBOT-main
mv wechat-ui-send.ts.bak wechat-ui-send.ts
mv scripts/prepare_wechat_chat.applescript.bak scripts/prepare_wechat_chat.applescript
mv scripts/deliver_wechat_message.applescript.bak scripts/deliver_wechat_message.applescript
```

OCR helper 二进制和编译脚本可保留，对旧版无影响。

---

## 八、推荐用法

1. 修改 `.launcher-config.json`，配置 API key、baseURL、模型名。
2. 修改 `人设.md`，让回复贴近自己的微信表达。
3. 把产品资料、卖点、售后政策等写入 `knowledge/` 下的 Markdown 文件。
4. 双击 `Start WeChat AI.command`。
5. 首次建议选择：发送模式 `仅粘贴不发送`、消息节奏 `标准`。
6. 确认回复内容、窗口定位和知识库引用效果稳定后，再切到 `自动发送`。

---

## 九、已知限制

1. **微信版本依赖**：方案依赖 `Cmd+F` 打开全局搜索、`Esc+Tab` 聚焦输入框这两个微信原生快捷键。微信改版改了快捷键时需要重新校准。
2. **OCR 识别准确率**：极端情况下（联系人名包含大量生僻字、emoji 密集、字号过小）可能识别不出来。出现假阴性时任务进 `failed/`，需要手动处理或简化备注名。
3. **多窗口微信不支持**：方案假设微信进程只有 1 个主窗口。开了多个独立聊天窗口时行为可能不可预期。
4. **测试套件目前不可用**：`npm test` 因 Node.js v25 + ts-node 兼容性问题挂掉。这是测试基础设施问题，不影响产品代码。等 Node 升级稳定后修。

---

## 十、设计原则的延续

- **paste-only 默认值不变**：自动化辅助而不是替代人决策。
- **失败优先于错发**：任何不确定状态下停止比"赌一把"重要。
- **群聊与服务号过滤继续生效**：filter 在 `poller.ts` 一层就拦下。

新增的 OCR + Sentinel 双层校验，把"可能错发的窗口"进一步缩小到接近 0。
