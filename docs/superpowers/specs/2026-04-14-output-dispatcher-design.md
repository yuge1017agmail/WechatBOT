# Output Dispatcher Design

## Goal

把当前“生成回复并立即发送”的下游逻辑，重构为一个只消费 `output/` 目录中 `.md` 任务文件的串行发送器。

上游职责保持最小假设：

- 上游已经把回复好的 markdown 文件写入 `output/`
- 下游不再调用 `wechat-cli new-messages`
- 下游不再生成回复
- 下游只负责发现任务、解析任务、发送消息、归档结果

## Directory Model

`output/` 本身就是新的任务入口，相当于原提议里的 `pending/`。

最终目录结构：

```text
output/
  *.md              # 新任务入口
processing/         # 正在处理
sent/               # 已发送
failed/             # 执行失败
manual_review/      # 需人工处理
logs/               # 结构化结果日志
screenshots/        # 发送过程截图
```

说明：

- 不新增 `pending/`
- 只有根目录 `output/*.md` 会被 watcher 视为待处理任务
- 一旦任务被领取，会立即移动到 `processing/`
- 处理结束后，不再回到 `output/`

## Scope

本次只改下游发送器。

包括：

- 把 `monitor.ts` 改成下游 dispatcher 入口
- 监听 `output/` 中新增的 `.md`
- 串行消费任务
- 调用现有 WeChat UI 自动化链路发送
- 归档到 `processing/sent/failed/manual_review`
- 记录日志与截图

不包括：

- 上游生成回复逻辑
- 上游写 `.tmp -> .md` 的原子落盘
- 对 `wechat-cli` 轮询新消息的保留兼容

## Task Lifecycle

单个任务的状态流：

```text
output/*.md
  -> processing/*.md
  -> sent/*.md
  -> failed/*.md
  -> manual_review/*.md
```

规则：

1. watcher 发现 `output/*.md`
2. scheduler 领取任务并原子移动到 `processing/`
3. parser 从 `processing/*.md` 解析元数据和回复正文
4. sender 调用会话定位与发送链路
5. 根据结果移动到最终目录
6. reporter 写对应日志，并保存截图路径

## Components

### `monitor.ts`

变成一个很薄的启动入口：

- 初始化目录
- 启动 watcher
- 启动 scheduler
- 打印运行状态

它不再：

- 调 `wechat-cli new-messages`
- 获取历史记录
- 调模型生成回复
- 在根目录 `output/` 写 markdown

### `dispatcher.ts`

新增核心调度模块，负责：

- 监听 `output/`
- 扫描遗漏任务
- 管理单队列串行执行
- 领取任务并搬移状态
- 调 parser / sender / archiver

### `task-parser.ts`

只负责把 markdown 解析成统一任务对象，例如：

```ts
interface DispatchTask {
  taskId: string;
  sourcePath: string;
  currentPath: string;
  chat: string;
  username: string;
  isGroup: boolean;
  sender: string;
  lastMessage: string;
  replyText: string;
  msgType?: string;
  timestamp?: number;
  time?: string;
}
```

解析职责只有两件事：

- 读 YAML front matter
- 读 `回复内容：...` 正文

不掺杂任何 UI 自动化判断。

### `task-watcher.ts`

负责发现新任务：

- 监听 `output/` 根目录
- 只关注新增或变更的 `.md`
- 忽略子目录
- 在处理前等待文件稳定

文件稳定策略：

- 连续两次读取文件大小一致
- 间隔 500ms
- 最多等待约 2 秒

目的：

- 避免读到仍在写入中的文件

### `task-scheduler.ts`

负责串行执行：

- 单进程
- 单队列
- 同一时间只处理一个任务

职责：

- 去重同一路径任务
- 控制顺序
- 避免多个任务同时争抢微信窗口
- 控制重试次数

重试策略：

- 默认不做自动重试发送
- 一个任务单次执行失败后直接归档到对应目录
- 后续是否支持重试由人工重新移动文件触发

这样最安全，避免重复发给真实联系人。

### `dispatcher-archiver.ts`

负责归档和结果记录：

- 移动任务文件
- 写结构化日志 JSON
- 保存过程截图路径
- 记录错误原因

日志最少包含：

- `task_id`
- `filename`
- `chat`
- `username`
- `started_at`
- `finished_at`
- `status`
- `error_message`
- `screenshot_paths`

## Conversation Resolution

仍然复用现有的 WeChat UI 发送链路：

1. 激活微信
2. 用搜索框搜索 `chat`
3. 尝试进入候选会话
4. 截图
5. OCR 校验当前页面包含：
   - `chat`
   - `last_message`
   - 群聊时可选 `sender`
6. 校验通过后粘贴并发送

这里仍然保留当前限制：

- 会话定位主要依赖 `display name`
- 不是通过 `username` 直接打开聊天

## Final State Rules

### `sent/`

进入条件：

- 会话定位成功
- OCR 校验通过
- 粘贴/发送执行成功

### `failed/`

进入条件：

- AppleScript 执行失败
- 截图失败
- OCR helper 编译或运行失败
- 文件解析失败
- 文件搬移失败

这类问题通常是“执行层错误”，不是会话歧义。

### `manual_review/`

进入条件：

- OCR 校验失败
- 无法确认当前会话是否正确
- 会话定位结果看起来不唯一

这类问题说明“自动发送风险过高”，应交人工处理。

## Recovery Behavior

程序启动时需要扫描以下目录：

- `output/`
- `processing/`

恢复规则：

- `output/*.md` 视为待处理新任务，加入队列
- `processing/*.md` 不自动继续发送，直接移入 `manual_review/`

这样可以避免：

- 程序上次已经发出消息，但崩溃在归档前
- 本次重启后再次自动发送，造成重复触达

## Logging And Evidence

每次任务执行至少保留一张截图证据：

- 发送前校验截图

可选保留：

- 发送后截图

截图文件放在：

```text
output/screenshots/
```

命名建议包含：

- 时间戳
- task id
- 阶段名

结构化日志放在：

```text
output/logs/
```

每个任务一份 JSON，便于后续复盘。

## Compatibility

已有平铺在 `output/` 根目录的历史 `.md` 默认不自动处理。

运行前由操作者自行保证：

- `output/` 根目录只放“准备发送的新任务”
- 历史任务已整理到别处，或暂不启动下游发送器

如果后续需要兼容历史平铺文件，再增加“启动时跳过早于进程启动时间的 `.md`”规则。

## Success Criteria

- 下游发送器只监听 `output/*.md`
- 新任务会先移动到 `processing/`
- 同一时间只处理一个任务
- 成功发送后任务进入 `sent/`
- 会话校验失败的任务进入 `manual_review/`
- 执行错误的任务进入 `failed/`
- 每个任务都有日志记录
- 程序重启后不会自动重复发送 `processing/` 中的旧任务
