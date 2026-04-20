# Lightweight Output Dispatcher Design

## Goal

把当前项目重构为一个只消费 `output/*.md` 任务文件的轻量发送器。

它不再负责监听微信新消息、读取聊天历史或生成回复，只负责发现任务、串行发送、并把任务归档到明确的状态目录。

## Design Principles

- 简单易用：启动后持续监听 `output/`，上游只需要往这个目录写入 markdown 文件。
- 轻量维护：移除 OCR、截图、结构化日志、复杂状态流，只保留最必要的运行模块。
- 明确状态：每个任务在任意时刻都只处于 `output/`、`processing/`、`sent/`、`failed/` 之一。
- 安全优先：默认 `paste-only`，只有显式切换时才自动发送。
- 单线程串行：同一时间只处理一个任务，避免多个任务同时争抢微信窗口。

## Scope

本次改造只覆盖下游发送链路。

包括：

- 把 `monitor.ts` 改成 dispatcher 启动入口
- 监听 `output/` 根目录中的 `.md` 任务文件
- 解析 front matter 和回复正文
- 串行调用 WeChat UI 自动化发送
- 根据结果归档到 `processing/`、`sent/`、`failed/`

不包括：

- 监听微信新消息
- 拉取聊天历史
- 调模型生成回复
- OCR、截图、Vision 编译、发送前文本识别
- `manual_review/`、`logs/`、`screenshots/` 等扩展目录

## Directory Model

最终目录结构保持最小化：

```text
output/
  *.md
  processing/
  sent/
  failed/
```

说明：

- `output/*.md` 是唯一待处理入口
- 任务被领取后立即移动到 `processing/`
- 成功后移动到 `sent/`
- 任意失败都移动到 `failed/`

## Task Format

dispatcher 继续消费当前项目已经在使用的 markdown 任务格式：

```md
---
chat: "照烧鳗鱼"
username: "wxid_piely0ql732922"
is_group: false
last_message: "你好，我想咨询花瓣沙发"
msg_type: "文本"
sender: ""
time: "16:55:53"
timestamp: 1776156953
---
回复内容：你好呀，我们这边有的……
```

发送链路依赖的最小字段：

- `chat`
- `username`
- `is_group`
- `last_message`
- `sender`
- `replyText`（从 `回复内容：...` 解析）

其中真正用于 UI 会话定位和发送的核心字段只有：

- `chat`
- `replyText`

其余字段保留在任务对象中，主要用于兼容现有 front matter 结构以及后续扩展。

## Components

### `monitor.ts`

极薄启动入口，只负责：

- 解析运行目录
- 读取发送模式
- 启动 dispatcher
- 打印当前状态

它不再包含任何消息拉取、历史读取或回复生成逻辑。

### `dispatcher.ts`

核心运行模块，负责：

- 初始化 `processing/`、`sent/`、`failed/`
- 启动时扫描 `output/` 根目录已有任务
- 回收 `processing/` 中的遗留任务到 `failed/`
- 监听 `output/` 根目录新增 `.md`
- 在单队列中串行处理任务
- 根据处理结果移动文件

### `task-parser.ts`

只负责把 markdown 文件解析成统一的任务对象。

职责限定为：

- 读取 YAML front matter
- 读取 `回复内容：...` 正文
- 做最小字段校验

它不负责目录移动、队列调度或任何 UI 自动化。

### `wechat-ui-send.ts`

发送编排层，精简为纯 UI 自动化：

- 打开目标会话
- 粘贴回复内容
- 按模式决定是否发送

该文件将移除以下逻辑：

- OCR helper 路径解析
- 截图逻辑
- OCR 编译与执行
- 发送前 OCR 校验

## Runtime Flow

运行时流程保持简单：

1. `monitor.ts` 启动 dispatcher
2. dispatcher 初始化目录
3. dispatcher 把 `processing/` 中遗留的 `.md` 移到 `failed/`
4. dispatcher 扫描 `output/` 根目录中的现有 `.md`
5. watcher 继续监听后续新增 `.md`
6. 单队列依次领取任务，并在真正处理前等待文件稳定
7. 任务移动到 `processing/`
8. parser 解析 markdown 得到任务对象
9. sender 调用微信 UI 自动化脚本执行粘贴/发送
10. 成功则移动到 `sent/`，失败则移动到 `failed/`

## File Stability Rule

为避免读取上游仍在写入中的文件，dispatcher 在处理前做一个轻量稳定性检查：

- 连续两次读取文件大小一致，视为稳定
- 默认检查间隔 300-500ms
- 超时后仍继续按当前文件处理，由后续解析或发送步骤决定是否失败

这个策略足够轻量，也能覆盖大多数“文件刚写完但 watcher 已触发”的场景。

## Send Modes

保留两种模式：

- `paste-only`
- `send`

默认行为：

- 未设置环境变量时，使用 `paste-only`
- 只有显式设置环境变量时才切到 `send`

这样可以把默认风险降到最低，同时保留一键切换自动发送的能力。

## Failure Handling

失败策略刻意保持保守：

- 不自动重试
- 不自动重新搜索联系人
- 不额外拆分“人工审核”状态
- 任意异常统一进入 `failed/`

失败来源包括但不限于：

- markdown 解析失败
- 缺少必要字段
- AppleScript 执行失败
- WeChat 未启动或无辅助功能权限
- 文件移动失败

统一失败归档的好处是：

- 状态模型简单
- 不会因为自动重试导致重复发送
- 故障排查只需要看终端输出和 `failed/` 目录

## Non-Goals

本次不做以下内容：

- 通过 `username` 精确打开微信会话
- 会话正确性二次校验
- OCR 或其他视觉识别方案
- 数据库存储
- Web UI 或管理面板
- 自动补偿和自动重试

## Success Criteria

当改造完成时，项目应满足：

- 启动后可以持续监听 `output/*.md`
- 新任务会被串行处理，不会并发争抢微信窗口
- 默认只粘贴不发送
- 切换模式后可以自动发送
- 成功和失败任务会进入明确目录
- 核心代码职责清晰，后续维护时不需要再理解 OCR 相关逻辑
