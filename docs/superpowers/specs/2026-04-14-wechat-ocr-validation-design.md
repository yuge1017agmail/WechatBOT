# WeChat OCR Validation Design

## Goal

在现有 WeChat 自动发送流程中，用截图 OCR 替代不可用的 Accessibility 文本读取，在发送前确认当前打开的会话确实匹配目标联系人和最新消息，从而降低误发风险。

## Why The Previous Design Failed

真实运行环境中的 WeChat 4.1.8 没有通过 `System Events` 暴露出可用的会话标题和聊天正文：

- `name of front window` 只能拿到固定窗口名“微信”
- `entire contents of front window` 返回空文本
- 可访问性树中没有可读的 `static text` 或聊天正文节点

这意味着“AppleScript 直接读取 UI 文本后校验”的方案在本机不可落地，必须切换到能读取真实像素内容的校验方式。

## Chosen Approach

采用“AppleScript 控制 + 全屏截图 + 原生 Vision OCR + Node 校验 + AppleScript 发送”的方案。

流程拆成三个阶段：

1. AppleScript 只负责打开候选会话
2. Node 截图并调用本机 OCR 工具识别屏幕文字
3. Node 校验 `chat` / `last_message` / `sender`，通过后再调用 AppleScript 粘贴并发送

## Runtime Flow

1. `monitor.ts` 检测新消息并生成回复
2. `monitor.ts` 继续写入带 front matter 的 markdown 文件
3. `sendViaWeChat(context, reply)` 调用 `prepare_wechat_chat.applescript`
4. `prepare_wechat_chat.applescript` 激活 WeChat，搜索 `chat`，进入候选会话
5. Node 执行 `screencapture` 生成临时截图
6. Node 调用本地 OCR helper，从截图中提取文字
7. Node 校验：
   - OCR 文本包含 `chat`
   - OCR 文本包含 `last_message`
   - 如果 `is_group=true` 且 `sender` 非空，OCR 文本还必须包含 `sender`
8. 校验通过后，Node 调用 `deliver_wechat_message.applescript`
9. `deliver_wechat_message.applescript` 负责粘贴回复并按模式决定是否发送
10. 校验失败时直接中止，不执行粘贴和发送

## Components

### `monitor.ts`

- 继续负责轮询、回复生成、markdown 输出、日志
- 传递完整消息上下文到发送层

### `wechat-ui-send.ts`

- 作为发送编排层
- 调用“打开候选会话” AppleScript
- 触发截图和 OCR
- 基于 OCR 结果执行发送前校验
- 仅在校验通过后调用“粘贴并发送” AppleScript

### `scripts/prepare_wechat_chat.applescript`

- 激活 WeChat
- 打开搜索
- 输入 `chat`
- 进入候选会话
- 不负责粘贴或发送

### `scripts/deliver_wechat_message.applescript`

- 将回复文本写入剪贴板
- 粘贴到当前输入框
- 依据 `sendMode` 决定是否发送

### `scripts/wechat_ocr.m`

- 使用 macOS 原生 `Vision.framework`
- 读取截图文件并输出识别到的文本
- 不负责任何 UI 操作

## Validation Rules

### Private Chat

发送前必须满足：

1. OCR 文本包含 `chat`
2. OCR 文本包含 `last_message`

### Group Chat

发送前必须满足：

1. OCR 文本包含 `chat`
2. OCR 文本包含 `last_message`
3. 当 `sender` 非空时，OCR 文本包含 `sender`

## Failure Policy

校验失败时：

- 不发送
- 不自动 fallback 到别的联系人
- 不自动进行第二次盲搜
- 在终端输出明确错误：
  - OCR 未识别到会话名
  - OCR 未识别到最近消息
  - OCR 未识别到群聊发送人

## Screenshot Strategy

第一版使用全屏截图，而不是窗口裁剪截图。

原因：

- 本机 `screencapture -R` 与 WeChat 辅助功能窗口坐标存在不稳定现象
- 全屏截图已经验证可稳定产出图像
- OCR 只需要识别“是否包含目标文本”，不要求像素级精确定位

后续如果需要提升速度，可以再升级为窗口裁剪或局部裁剪。

## Local Validation Evidence

在本机已经验证：

- `screencapture /tmp/wechat_full.png` 能成功产出截图
- 使用 Objective-C + `Vision.framework` 的本地 OCR helper，能从该截图识别出 WeChat 界面中的“文件传输助手”等文本

因此 OCR 路线具备实现可行性。

## Tradeoffs

### Benefits

- 不依赖 WeChat 的 Accessibility 文本暴露
- 发送前校验仍然存在，安全性高于“搜索后直接发送”
- 使用本机原生 Vision，无需第三方 OCR 服务

### Costs

- 第一次运行可能需要编译 OCR helper
- OCR 识别速度比纯 AppleScript 文本读取稍慢
- 全屏截图会引入额外噪声，需要 Node 侧做包含式校验

## Out Of Scope

- 不在本次实现中研究 WeChat deep link 直达会话
- 不在本次实现中引入第三方 OCR 库
- 不在本次实现中做局部截图优化
- 不在本次实现中做 OCR 置信度排序或 fuzzy matching

## Success Criteria

- 能稳定打开候选会话
- 能稳定生成全屏截图并提取 OCR 文本
- OCR 校验失败时，消息不会被发送
- OCR 校验通过时，消息能够自动发送
- 日志能明确区分“打开会话成功”“OCR 校验失败”“已发送”
