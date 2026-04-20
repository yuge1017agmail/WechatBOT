# WeChat Contact Validation Hardening Design

## Goal

在现有 WeChat UI 自动发送流程里，加入发送前联系人校验，避免因为微信搜索结果歧义导致消息误发到错误会话。

## Problem Statement

当前流程只使用 `chat` 显示名通过微信 UI 搜索联系人，然后直接进入候选会话并发送消息。真实端到端测试已经证明：

- AppleScript 发送链路本身可用
- 但 `Cmd+F` 搜索后直接回车，可能进入错误会话
- 一旦进入错误会话，自动发送会造成真实误发

因此，当前问题不是“不能发”，而是“发之前缺少足够严格的会话校验”。

## Available Data

用户已经把 `output/*.md` 文件升级为带 YAML front matter 的格式。当前样本包含：

- `chat`
- `username`
- `is_group`
- `last_message`
- `msg_type`
- `sender`
- `time`
- `timestamp`

这些字段已经足够支持发送前校验，不需要额外依赖从 `output` 目录反查最新文件来驱动发送。

## Chosen Approach

采用“搜索 + UI 校验 + 通过后才发送”的保守方案。

- `monitor.ts` 继续在生成回复后把消息元数据写入 markdown 文件。
- `monitor.ts` 同时把当前消息元数据直接传给发送层，不依赖再次读取 `output` 文件决定发给谁。
- `wechat-ui-send.ts` 扩展为接收完整的消息上下文，而不只接收 `chatName` 和 `reply`。
- AppleScript 在粘贴回复之前，必须先确认当前微信窗口中的会话就是目标会话。

## Validation Rules

### Private Chat

对于私聊，必须同时满足：

1. 当前微信窗口顶部标题等于 front matter 中的 `chat`
2. 当前聊天窗口的可见文本中包含 `last_message`

只有全部满足，才允许粘贴并发送。

### Group Chat

对于群聊，必须同时满足：

1. 当前微信窗口顶部标题等于 front matter 中的 `chat`
2. 当前聊天窗口的可见文本中包含 `last_message`
3. 若 `sender` 非空，当前聊天窗口的可见文本中还必须包含 `sender`

只有全部满足，才允许粘贴并发送。

## Failure Policy

校验失败时：

- 不发送消息
- 不自动 fallback 到其他搜索策略
- 不尝试第二次盲目搜索
- 在终端中打印明确错误原因，例如：
  - 标题不匹配
  - 未找到最近消息文本
  - 群聊发送人不匹配

这样做会牺牲一部分自动化成功率，但可以显著降低误发风险。

## Data Flow

1. `getNewMessages()` 返回当前新消息对象
2. `generateReply()` 生成回复
3. `writeMarkdown()` 将消息元数据和回复写入 `output/*.md`
4. `sendViaWeChat(context, reply)` 接收当前消息对象
5. AppleScript 搜索 `chat`
6. AppleScript 读取当前微信窗口可见 UI 文本
7. 根据 `chat` / `last_message` / `sender` 执行校验
8. 校验通过才发送；否则返回错误

## File Responsibilities

- `monitor.ts`
  - 继续负责消息轮询、回复生成、front matter 输出、日志记录
  - 将完整消息元数据传给发送层

- `wechat-ui-send.ts`
  - 定义发送校验上下文类型
  - 构造 AppleScript 参数
  - 封装 `osascript` 调用和错误处理

- `scripts/send_wechat_message.applescript`
  - 执行微信 UI 搜索
  - 采集当前窗口可见文本
  - 执行发送前校验
  - 仅在校验通过时粘贴和发送

- `tests/wechat-ui-send.test.ts`
  - 校验参数拼装
  - 校验发送上下文是否正确传递到 AppleScript 调用层

## Tradeoffs

### Rejected Option 1: Only Validate Window Title

仅校验顶部标题实现简单，但对重名联系人不够安全，因此拒绝。

### Rejected Option 2: Send First, Verify with `wechat-cli` Afterward

这种方式只能在误发之后发现错误，不适合真实业务场景，因此拒绝。

### Accepted Tradeoff

发送前做多条件校验会让 AppleScript 更复杂，也可能出现“本该能发但因为 UI 文本读取不稳定而中止”的情况，但这是可以接受的，因为安全性优先于发送成功率。

## Out Of Scope

- 不在本次实现中加入多轮 fallback 搜索策略
- 不在本次实现中支持通过 `username` 直接驱动微信 UI 搜索
- 不在本次实现中做 OCR 或截图识别
- 不在本次实现中回退到“校验失败时自动转为仅粘贴不发送”

## Success Criteria

- 发送前必须进行目标会话校验
- 误定位时不允许继续发送
- 正确定位时仍可完成自动发送
- 终端日志能明确说明发送成功或校验失败原因
