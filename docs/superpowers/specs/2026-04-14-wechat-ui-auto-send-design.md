# WeChat UI Auto Send Design

## Goal

在现有 `monitor.ts` 的消息监控流程里，增加一段 macOS AppleScript UI 自动化：在生成回复并写入 markdown 之后，自动唤起微信、按联系人名称打开会话、粘贴回复并发送。

## Chosen Approach

采用“独立 AppleScript 文件 + Node 传参调用”的方案。

- `monitor.ts` 继续负责消息检测、回复生成、日志输出和错误处理。
- 新增独立 AppleScript 文件，专门负责微信 UI 操作。
- Node 通过 `osascript` 传入 `chatName`、`reply` 和 `sendMode`，避免把大段 AppleScript 内联在 TypeScript 里。

## Why This Approach

- UI 自动化逻辑和业务逻辑解耦，后续调延时、搜索方式、发送动作时更容易维护。
- 通过参数传递而不是字符串拼接，可减少转义和中文内容处理问题。
- 保留 markdown 输出和终端日志，用户可以在监控器里实时看到即将发送的内容。

## Runtime Flow

1. `getNewMessages()` 检测到新消息。
2. `generateReply()` 生成回复。
3. `writeMarkdown()` 保存回复 markdown。
4. 终端打印联系人名、回复正文和保存路径。
5. `sendViaWeChat(chatName, reply)` 调用 AppleScript。
6. AppleScript 激活微信，搜索联系人，进入会话，写入剪贴板，粘贴，回车发送。
7. 若发送失败，仅记录错误，不中断监控循环。

## Safety And UX Rules

- 默认自动发送。
- 在自动发送前，监控器必须打印本次将发送的内容，方便用户观察和及时干预。
- 保留一个简单的发送模式开关，方便后续切换为“只粘贴不发送”。
- 当缺少辅助功能权限、微信未运行或 UI 自动化失败时，给出清晰报错。

## Constraints

- AppleScript 的 `keystroke` 不适合直接输入中文，统一走剪贴板粘贴。
- 微信 UI 响应存在延迟，需要在关键步骤之间加入 `delay`。
- 依赖 macOS 的“辅助功能”授权给运行监控器的终端。
- 同名联系人或搜索结果排序不稳定时，可能误入错误会话；第一版先采用搜索首项策略，失败时输出错误并保留扩展点。

## Planned Files

- Modify: `monitor.ts`
- Create: `scripts/send_wechat_message.applescript`
- Create: `docs/superpowers/plans/2026-04-14-wechat-ui-auto-send.md`

## Out Of Scope

- 不在第一版实现 UI 元素级别校验。
- 不在第一版实现多联系人重名消歧。
- 不新增完整测试框架，只补当前项目可承受的最小回归校验。
