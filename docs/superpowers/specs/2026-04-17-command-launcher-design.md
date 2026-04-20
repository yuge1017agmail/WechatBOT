# Command Launcher Design

## Goal

为当前项目增加一个可双击启动的 `.command` 入口，让用户无需手动输入命令，就能启动整套微信 AI 监控与自动发送系统。

启动器需要满足两个核心目标：

- 日常使用足够简单：双击即可启动
- 默认行为足够清晰：启动时由用户选择“自动发送”或“仅粘贴不发送”

## Chosen Approach

采用“单个 `.command` 启动器 + 一个项目本地隐藏配置文件”的方案。

- `.command` 文件作为唯一日常入口
- 启动器通过 `osascript` 弹出原生对话框，让用户选择运行模式
- 启动器从项目本地隐藏配置文件中读取 API key 和 API base URL
- 启动器最终在 Terminal 中切到项目目录并执行现有 `monitor.ts`

## Why This Approach

- 最贴合当前项目：现有系统本来就是 Node + Terminal 启动，包装成本最低
- 维护简单：不需要引入 Electron、Automator App、菜单栏程序或额外打包流程
- 调试方便：启动后日志直接留在 Terminal 窗口里，便于排查问题
- 用户体验够用：虽然会打开 Terminal，但对“点击即可启动”的目标已经足够

## Scope

本次改造包括：

- 新增一个可双击的 `.command` 启动文件
- 新增一个项目本地隐藏配置文件用于保存 API key 和 base URL
- 启动时弹出模式选择
- 根据选择设置 `WECHAT_SEND_MODE`
- 启动当前完整系统

本次不包括：

- 打包成 macOS `.app`
- 配置管理界面
- 多套环境切换
- 系统托盘图标
- 自动后台守护

## Files

### New Files

- `Start WeChat AI.command`
  双击启动入口
- `.launcher-config.json`
  本地启动配置文件，保存 API key 和 base URL

### Existing Files Reused

- `monitor.ts`
  启动器最终调用的系统入口
- `package.json`
  不需要改变启动方式，只复用现有 Node 运行时和依赖

## Launcher Flow

双击 `Start WeChat AI.command` 后，流程如下：

1. 启动器切到项目根目录
2. 检查 `.launcher-config.json` 是否存在且格式有效
3. 读取：
   - `ANTHROPIC_API_KEY`
   - `ANTHROPIC_BASE_URL`
4. 通过 `osascript` 弹出模式选择：
   - 自动发送
   - 仅粘贴不发送
5. 将选择映射为：
   - `send`
   - `paste-only`
6. 在 Terminal 中打印启动信息
7. 设置环境变量并启动：
   - `ANTHROPIC_API_KEY`
   - `ANTHROPIC_BASE_URL`
   - `WECHAT_SEND_MODE`
8. 执行：
   - `node --no-warnings --loader ts-node/esm monitor.ts`
9. 保持 Terminal 窗口打开，让用户可以看到日志并手动停止

## Configuration File

配置文件使用简单 JSON，放在项目根目录，示例：

```json
{
  "ANTHROPIC_API_KEY": "fk-...",
  "ANTHROPIC_BASE_URL": "https://oa.api2d.net"
}
```

约束：

- 文件由本地直接读取，不进入命令行历史
- 启动器只依赖这两个字段，不增加额外配置项
- 若字段缺失、为空或 JSON 格式错误，启动器直接给出错误提示并退出

## Mode Selection UX

模式选择采用原生 macOS 对话框，而不是命令行交互。

原因：

- 更符合“点击即启动”的目标
- 不要求用户先切到 Terminal 手动输入
- 与 `.command` 文件的双击体验更一致

行为约束：

- 若用户选择“自动发送”，启动器传入 `WECHAT_SEND_MODE=send`
- 若用户选择“仅粘贴不发送”，启动器传入 `WECHAT_SEND_MODE=paste-only`
- 若用户取消选择，启动器应直接退出，不启动系统

## Error Handling

启动器应对以下场景给出明确错误，而不是静默失败：

- 配置文件不存在
- 配置文件 JSON 非法
- API key 缺失
- base URL 缺失
- `node` 不可用
- `ts-node` 依赖不可用
- 用户取消模式选择

错误反馈方式：

- 优先用 `osascript display dialog` 给出简洁错误提示
- 同时在 Terminal 中打印同样的错误，便于排查

## Security Notes

本次方案接受把 key 保存在本地配置文件中，因为这是用户明确选择的模式。

边界约束：

- 启动器不把 key 写回日志
- 启动器不把 key 拼进可见命令回显
- 配置文件只保存在项目本地，不做网络上传

## Testing Strategy

实现后需要覆盖三类验证：

### Automated

- 读取配置文件的解析逻辑
- 模式映射逻辑
- 启动命令拼装逻辑

### Local Manual

- 双击 `.command` 后是否弹出模式选择
- 选择“仅粘贴不发送”后能否启动系统
- 选择“自动发送”后能否启动系统
- 取消选择时是否安全退出

### End-to-End

- 通过启动器启动系统
- 收到新私聊消息后，上游生成 markdown
- 下游 dispatcher 消费任务
- 在所选模式下正确执行微信 UI 发送

## Out Of Scope

本次不做以下内容：

- 自动创建配置文件向导
- 多账号配置
- 日志窗口美化
- Dock 图标
- 菜单栏控制面板
- 后台开机自启

## Success Criteria

改造完成后，用户应能：

- 通过双击一个 `.command` 文件启动系统
- 在启动时选择“自动发送”或“仅粘贴不发送”
- 无需重新输入 API key
- 在 Terminal 中看到完整运行日志
- 像之前一样完成从上游到下游的完整消息处理流程
