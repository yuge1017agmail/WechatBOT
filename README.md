# WeChatBOT

WeChatBOT 是一个运行在 macOS 上的微信私聊自动回复工具。它通过 `wechat-cli` 轮询微信新消息，调用兼容 OpenAI Chat Completions 的大模型接口生成回复，再把回复写成 Markdown 任务文件，由 AppleScript 驱动微信桌面版完成粘贴或发送。

> 首次运行请优先选择“仅粘贴不发送”。确认联系人定位、回复内容和发送窗口都正确后，再切换到“自动发送”。

## 适用场景

- 监听微信桌面版私聊新消息
- 结合最近聊天记录生成一条可直接发送的回复
- 将每次回复落盘为可审计的 Markdown 任务
- 串行处理发送任务，避免多个会话同时抢占微信窗口
- 自动忽略群聊、服务号和公众号消息
- 支持“仅粘贴”和“自动发送”两种模式

## 运行流程

```text
wechat-cli 新消息
  -> 同一用户短时间消息合并
  -> poller.ts 拉取最近聊天记录
  -> 检索 knowledge/ 知识库
  -> 读取 人设.md
  -> 大模型生成回复
  -> output/*.md 写入发送任务
  -> dispatcher.ts 监听并排队
  -> AppleScript 打开微信会话
  -> 粘贴或发送
  -> 归档到 sent/ 或 failed/
```

启动时，程序会先把已经存在的未读私聊标记为“已处理”，避免一启动就批量补发旧消息。

## 环境要求

- macOS
- Node.js 18+，推荐使用 Node.js 20 LTS
- 已安装并登录微信桌面版 `WeChat`
- 已安装 `wechat-cli`，且能在终端直接执行
- 运行脚本的宿主应用已获得 macOS“辅助功能”权限，例如 Terminal 或 iTerm
- 一个兼容 OpenAI Chat Completions 的模型网关和 API Key

## 快速开始

1. 安装依赖：

   ```bash
   npm install
   ```

2. 确认 `wechat-cli` 可用：

   ```bash
   wechat-cli --help
   ```

   如果刚更换过微信账号，请在当前账号已登录的状态下重新执行：

   ```bash
   wechat-cli init
   ```

3. 修改项目根目录的 `.launcher-config.json`：

   ```json
   {
     "ANTHROPIC_API_KEY": "your-api-key",
     "ANTHROPIC_BASE_URL": "https://your-openai-compatible-base-url",
     "MODEL_NAME": "your-model-id"
   }
   ```

4. 赋予启动脚本执行权限：

   ```bash
   chmod +x "Start WeChat AI.command"
   ```

5. 双击 [Start WeChat AI.command](Start%20WeChat%20AI.command)，先选择发送模式，再选择消息节奏。

首次建议选择“仅粘贴不发送”。这个模式会把回复放进微信输入框，但不会按回车发送。

## 配置说明

| 配置项 | 说明 |
| --- | --- |
| `ANTHROPIC_API_KEY` | 模型网关的 API Key |
| `ANTHROPIC_BASE_URL` | 模型网关根地址；普通 OpenAI 兼容网关默认请求 `/v1/chat/completions`，DeepSeek 会请求 `/chat/completions` |
| `MODEL_NAME` | 可选，模型网关支持的模型 ID；不设置时默认 `claude-opus-4-6` |
| `WECHAT_SEND_MODE` | 可选值为 `paste-only` 或 `send`，不设置时默认 `paste-only` |
| `POLL_INTERVAL_MS` | 可选，轮询新消息间隔；启动弹窗会自动设置 |
| `MESSAGE_SETTLE_MS` | 可选，同一用户连续发消息时的合并等待时间；启动弹窗会自动设置 |
| `HISTORY_LIMIT` | 可选，生成回复前读取的最近聊天记录条数；启动弹窗会自动设置 |

`ANTHROPIC_*` 是项目沿用的变量名。当前实际请求格式是 OpenAI Chat Completions，默认模型名为 `claude-opus-4-6`。如果你的网关使用其他模型名，请在 `.launcher-config.json` 中配置 `MODEL_NAME`。

DeepSeek 示例：

```json
{
  "ANTHROPIC_API_KEY": "your-api-key",
  "ANTHROPIC_BASE_URL": "https://api.deepseek.com",
  "MODEL_NAME": "deepseek-v4-flash"
}
```

请不要把真实 API Key 外发或提交到公开仓库。如果要长期维护这个项目，建议把真实配置改成本地私有文件或模板化配置。

## 启动方式

### 双击启动

推荐使用 [Start WeChat AI.command](Start%20WeChat%20AI.command)。它会自动进入项目目录，读取 `.launcher-config.json`，检查 `wechat-cli` 是否仍绑定当前活跃的微信账号，先弹窗选择发送模式，再弹窗选择消息节奏，并检查辅助功能权限。

发送模式包括：

- 仅粘贴不发送
- 自动发送

消息节奏包括：

- 标准：8 秒轮询，10 秒合并等待，30 条历史
- 快速：5 秒轮询，8 秒合并等待，30 条历史
- 稳妥：15 秒轮询，15 秒合并等待，50 条历史

“合并等待”用于处理同一用户短时间连续发送多行消息。程序会等这个窗口内不再收到该用户的新消息后，再拉取聊天历史并生成一次回复。

## 人设与回复风格

项目根目录的 [人设.md](人设.md) 用来控制 AI 自动回复的表达风格、语气和用词。程序每次生成回复前都会读取这个文件，因此你可以直接修改它，让回复更接近自己的微信表达。

建议把这里写成“你平时怎么说话”，而不是写成客服话术。比如：

- 常用称呼和口头语
- 不喜欢的 AI 腔或客服腔
- 面对客户询价、问位置、问库存时的表达习惯
- 哪些内容不能承诺，需要先确认

## 知识库

项目根目录的 [knowledge/](knowledge/) 用来存放产品卖点、材质说明、报价规则、交付说明、售后政策等资料。客户问专业问题时，系统会先检索这里的 Markdown 文档，再结合“客户问题 + 最近聊天记录 + 人设.md + 命中的知识片段”生成回复。

推荐结构：

```text
knowledge/
  products/
    花瓣沙发.md
    云朵床.md
  policies/
    交付说明.md
    售后说明.md
```

每个文件建议只写一个产品或一个主题，标题尽量使用客户会说的名字。示例：

```md
# 花瓣沙发

## 核心卖点

- 造型柔和，适合法式、奶油风、现代轻奢空间。
- 坐感偏软，但仍有支撑，不是塌陷型。

## 回复注意

客户问价格时，先问尺寸和材质，不要直接报死价。
```

当前知识库检索是本地关键词检索，不调用额外模型，不产生 embedding 成本。每次只会把前 5 个相关片段交给大模型，避免把整套资料都塞进 prompt。没有检索到资料时，系统会要求模型不要硬编专业细节，而是自然地说“我确认下再回你”。

### 命令行启动

```bash
npm run launcher
```

这和双击启动走同一套逻辑。

### 直接传环境变量启动

```bash
ANTHROPIC_API_KEY=your-api-key \
ANTHROPIC_BASE_URL=https://your-openai-compatible-base-url \
MODEL_NAME=your-model-id \
POLL_INTERVAL_MS=8000 \
MESSAGE_SETTLE_MS=10000 \
HISTORY_LIMIT=30 \
WECHAT_SEND_MODE=paste-only \
npm start
```

发送模式说明：

- `WECHAT_SEND_MODE=paste-only`：只粘贴到输入框，不发送
- `WECHAT_SEND_MODE=send`：粘贴后直接按回车发送

## 辅助功能权限

微信窗口搜索、粘贴和发送依赖 macOS 辅助功能权限。请给运行脚本的应用授权：

```text
系统设置 -> 隐私与安全性 -> 辅助功能
```

常见需要授权的应用包括：

- Terminal
- iTerm

如果权限不足，程序可能可以启动，但发送任务会失败并进入 `output/failed/`。

## 任务目录

程序会自动创建并使用 `output/`：

```text
output/
  *.md
  processing/
  sent/
  failed/
```

目录含义：

- `output/*.md`：待处理任务
- `output/processing/`：正在发送的任务
- `output/sent/`：已成功处理的任务
- `output/failed/`：处理失败的任务，需要人工检查

启动时如果发现 `processing/` 中有遗留任务，会先移动到 `failed/`，避免上次中断的任务被误判为仍在处理中。

## 任务文件格式

每个发送任务都是带 front matter 的 Markdown 文件。模型生成回复后，程序会先写入任务文件，再由分发器串行发送；这个文件层不参与模型请求，不会增加 token 成本。

```md
---
chat: "张三"
username: "wxid_demo"
is_group: false
last_message: "你好，在吗"
sender: ""
timestamp: 1776149999
---
回复内容：你好，我在的，请问你想了解哪一款产品？
```

如果只想测试发送链路，可以手动在 `output/` 下放入类似格式的 `.md` 文件。分发器会自动读取、移动并执行发送。

## 关键文件

- [monitor.ts](monitor.ts)：主入口，同时启动消息轮询器和任务分发器
- [poller.ts](poller.ts)：读取新消息、拉取历史、检索知识库、调用模型、写入 Markdown 任务
- [knowledge-search.ts](knowledge-search.ts)：读取、切分并检索 `knowledge/` 下的 Markdown 知识库
- [dispatcher.ts](dispatcher.ts)：监听 `output/`，串行处理任务并归档结果
- [task-parser.ts](task-parser.ts)：解析 Markdown 任务文件
- [wechat-ui-send.ts](wechat-ui-send.ts)：封装微信 UI 自动化调用
- [launcher.ts](launcher.ts)：双击启动和 `npm run launcher` 的启动逻辑
- [人设.md](人设.md)：AI 自动回复的人设、语气和表达风格
- [knowledge/README.md](knowledge/README.md)：知识库文档写法说明
- [scripts/prepare_wechat_chat.applescript](scripts/prepare_wechat_chat.applescript)：搜索并进入目标微信会话
- [scripts/deliver_wechat_message.applescript](scripts/deliver_wechat_message.applescript)：粘贴回复，并按模式决定是否发送

## 测试

```bash
npm test
```

当前测试覆盖：

- 启动配置解析
- 微信账号切换检测
- 发送模式映射
- 轮询去重逻辑
- 知识库切分与关键词检索
- 人设 prompt 合并
- Markdown 任务解析
- 任务目录流转
- 微信发送调用顺序

## 常见问题

### 启动后一直没有新消息

请依次检查：

- 微信桌面版是否已登录
- `wechat-cli new-messages --format json` 是否能返回数据
- 如果刚更换过微信账号，请在当前账号登录状态下重新执行 `wechat-cli init`
- 收到的是否为真实私聊消息，当前代码会过滤群聊、服务号和公众号
- 消息是否在启动前就已经未读，启动前未读会被跳过

### 启动时提示微信账号可能已切换

启动器会比较 `wechat-cli` 当前绑定的数据库目录和微信最近活跃的账号数据库目录。如果两者明显不同，会停止启动，避免读旧账号消息或漏掉新账号消息。

处理方法：

```bash
wechat-cli init
```

重新初始化后再启动项目。如果仍然识别不到新消息，可以先备份再重置 `~/.wechat-cli/last_check.json`，然后让对方重新发送一条启动后的新消息测试。

### 任务生成了，但没有发送

请优先检查：

- Terminal 或 iTerm 是否已获得“辅助功能”权限
- 微信窗口是否可见且已登录
- `output/failed/` 中是否有失败任务
- 联系人显示名是否能被微信搜索准确定位

### 发送到了不期望的会话

当前会话定位依赖微信搜索联系人显示名。如果存在重名联系人、相似群名或搜索结果顺序变化，可能会进入错误会话。真实自动发送前务必使用 `paste-only` 模式验证。

### 模型接口报错

请检查：

- `.launcher-config.json` 中的 API Key 是否正确
- `ANTHROPIC_BASE_URL` 是否为网关根地址，而不是完整的 `/v1/chat/completions`
- 网关是否支持或正确映射 `claude-opus-4-6`
- 网关返回格式是否兼容 OpenAI Chat Completions

## 已知限制

- 仅支持 macOS
- 当前只处理真实私聊，群聊、服务号和公众号会被过滤
- 轮询间隔、消息合并等待和历史条数由启动弹窗选择
- 启动前已存在的未读私聊会被跳过
- 微信会话定位依赖显示名称搜索，重名联系人存在风险
- 自动发送依赖桌面 UI 自动化，微信版本更新可能影响脚本稳定性

## 开发说明

本项目目前是一体化实现：消息监听、回复生成、任务分发和微信 UI 自动化都在同一个 Node.js 项目中。`docs/superpowers/` 下保留了设计稿和实现计划，适合后续继续拆分、重构或扩展。
