# Output Dispatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `wechat-cli -> generate reply -> write markdown -> send` monitor with a downstream-only dispatcher that watches `output/*.md`, processes tasks one at a time, and archives each task into `processing/`, `sent/`, `failed/`, or `manual_review/`.

**Architecture:** Keep `monitor.ts` as a thin startup file and move all real work into a new `dispatcher.ts` pipeline. The dispatcher bootstraps state directories, rescues abandoned `processing/` files into `manual_review/`, watches `output/` for new `.md` tasks, parses them into a typed task object, then runs a single in-memory queue that calls the existing WeChat UI sender and archives the result with logs and screenshots.

**Tech Stack:** Node.js, TypeScript, Node built-in test runner, `fs/promises`, `fs.watch`, existing AppleScript/OCR sender in `wechat-ui-send.ts`

---

## File Structure

### Files To Modify

- Modify: `/Users/imac/Documents/CC-project/WechatCLI/monitor.ts`
  Thin CLI entrypoint that boots the dispatcher and prints runtime status.
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`
  Add a way to preserve the OCR validation screenshot so the dispatcher can archive evidence.
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/package.json`
  Expand the test script so all `tests/*.test.ts` files run.
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tsconfig.json`
  Include `tests/**/*.ts` and new root `.ts` modules in `tsc --noEmit`.

### Files To Create

- Create: `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts`
  Core bootstrap, watcher, queue, recovery, and task execution orchestration.
- Create: `/Users/imac/Documents/CC-project/WechatCLI/task-parser.ts`
  Parse front matter and reply body from a markdown task file.
- Create: `/Users/imac/Documents/CC-project/WechatCLI/dispatcher-archiver.ts`
  Move task files between state directories and write result JSON logs.
- Create: `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`
  Tests for directory bootstrap, parser behavior, task classification, and queue-side file movement.

## Task 1: Bootstrap The Dispatcher Runtime And Replace The Old Monitor

**Files:**
- Create: `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/monitor.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/package.json`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tsconfig.json`
- Create: `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`

- [ ] **Step 1: Write the failing directory-bootstrap and recovery tests**

Add these tests to `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  ensureDispatcherDirectories,
  recoverProcessingTasks,
} from '../dispatcher.ts';

test('ensureDispatcherDirectories creates all state directories under output/', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));

  const dirs = await ensureDispatcherDirectories(root);

  await Promise.all([
    fs.access(path.join(root, 'processing')),
    fs.access(path.join(root, 'sent')),
    fs.access(path.join(root, 'failed')),
    fs.access(path.join(root, 'manual_review')),
    fs.access(path.join(root, 'logs')),
    fs.access(path.join(root, 'screenshots')),
  ]);

  assert.equal(dirs.outputDir, root);
  assert.equal(dirs.processingDir, path.join(root, 'processing'));
});

test('recoverProcessingTasks moves abandoned processing files to manual_review', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));
  await fs.mkdir(path.join(root, 'processing'), { recursive: true });
  await fs.mkdir(path.join(root, 'manual_review'), { recursive: true });
  await fs.writeFile(path.join(root, 'processing', 'task.md'), '---\\nchat: \"A\"\\n---\\n回复内容：B\\n');

  await recoverProcessingTasks({
    processingDir: path.join(root, 'processing'),
    manualReviewDir: path.join(root, 'manual_review'),
  });

  await fs.access(path.join(root, 'manual_review', 'task.md'));
  await assert.rejects(() => fs.access(path.join(root, 'processing', 'task.md')));
});
```

- [ ] **Step 2: Run the new test file to verify it fails**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/output-dispatcher.test.ts
```

Expected: FAIL because `dispatcher.ts` and its exports do not exist yet.

- [ ] **Step 3: Implement the dispatcher bootstrap and the thin monitor entrypoint**

Create `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts` with the directory helper and recovery helper:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface DispatcherDirectories {
  outputDir: string;
  processingDir: string;
  sentDir: string;
  failedDir: string;
  manualReviewDir: string;
  logsDir: string;
  screenshotsDir: string;
}

export async function ensureDispatcherDirectories(outputDir: string): Promise<DispatcherDirectories> {
  const dirs: DispatcherDirectories = {
    outputDir,
    processingDir: path.join(outputDir, 'processing'),
    sentDir: path.join(outputDir, 'sent'),
    failedDir: path.join(outputDir, 'failed'),
    manualReviewDir: path.join(outputDir, 'manual_review'),
    logsDir: path.join(outputDir, 'logs'),
    screenshotsDir: path.join(outputDir, 'screenshots'),
  };

  await Promise.all(Object.values(dirs).map((dir) => fs.mkdir(dir, { recursive: true })));
  return dirs;
}

export async function recoverProcessingTasks(input: {
  processingDir: string;
  manualReviewDir: string;
}): Promise<void> {
  const names = await fs.readdir(input.processingDir).catch(() => []);
  for (const name of names.filter((entry) => entry.endsWith('.md'))) {
    await fs.rename(
      path.join(input.processingDir, name),
      path.join(input.manualReviewDir, name),
    );
  }
}
```

Replace `/Users/imac/Documents/CC-project/WechatCLI/monitor.ts` with a thin startup wrapper:

```ts
import * as path from 'node:path';
import { startDispatcher } from './dispatcher.ts';

const OUTPUT_DIR = path.join(process.cwd(), 'output');

await startDispatcher({
  outputDir: OUTPUT_DIR,
  sendMode: process.env.WECHAT_SEND_MODE === 'paste-only' ? 'paste-only' : 'send',
});
```

Update `/Users/imac/Documents/CC-project/WechatCLI/package.json`:

```json
{
  "scripts": {
    "test": "node --test --no-warnings --loader ts-node/esm tests/*.test.ts",
    "start": "node --no-warnings --loader ts-node/esm monitor.ts",
    "dev": "node --no-warnings --loader ts-node/esm monitor.ts"
  }
}
```

Update `/Users/imac/Documents/CC-project/WechatCLI/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "esModuleInterop": true,
    "strict": true,
    "noEmit": true,
    "outDir": "./dist",
    "skipLibCheck": true
  },
  "include": ["*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Run the test again to verify it passes**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/output-dispatcher.test.ts
```

Expected: PASS for the two new tests.

## Task 2: Parse Markdown Tasks And Detect Stable Files In `output/`

**Files:**
- Create: `/Users/imac/Documents/CC-project/WechatCLI/task-parser.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`

- [ ] **Step 1: Write the failing parser and file-stability tests**

Add these tests to `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`:

```ts
import {
  parseDispatchTask,
  waitForStableFile,
} from '../task-parser.ts';

test('parseDispatchTask reads front matter and reply body', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));
  const filePath = path.join(root, 'task.md');
  await fs.writeFile(
    filePath,
    [
      '---',
      'chat: "照烧鳗鱼"',
      'username: "wxid_piely0ql732922"',
      'is_group: false',
      'last_message: "你们有沙发卖吗"',
      'sender: ""',
      'timestamp: 1776149999',
      '---',
      '回复内容：有的呀，我们这边有沙发可以看。',
      '',
    ].join('\\n'),
  );

  const task = await parseDispatchTask(filePath);

  assert.equal(task.chat, '照烧鳗鱼');
  assert.equal(task.username, 'wxid_piely0ql732922');
  assert.equal(task.isGroup, false);
  assert.equal(task.lastMessage, '你们有沙发卖吗');
  assert.equal(task.replyText, '有的呀，我们这边有沙发可以看。');
});

test('waitForStableFile resolves after file size stops changing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));
  const filePath = path.join(root, 'task.md');
  await fs.writeFile(filePath, 'a');

  const pending = waitForStableFile(filePath, { intervalMs: 50, stableTicks: 2 });
  await fs.appendFile(filePath, 'b');

  await assert.doesNotReject(() => pending);
});
```

- [ ] **Step 2: Run the parser test file to verify it fails**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/output-dispatcher.test.ts
```

Expected: FAIL because `task-parser.ts` does not exist yet.

- [ ] **Step 3: Implement task parsing and stable-file waiting**

Create `/Users/imac/Documents/CC-project/WechatCLI/task-parser.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface DispatchTask {
  taskId: string;
  filename: string;
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

export async function waitForStableFile(
  filePath: string,
  options: { intervalMs?: number; stableTicks?: number } = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? 500;
  const stableTicks = options.stableTicks ?? 2;
  let stableCount = 0;
  let previousSize = -1;

  while (stableCount < stableTicks) {
    const stat = await fs.stat(filePath);
    if (stat.size === previousSize) {
      stableCount += 1;
    } else {
      stableCount = 0;
      previousSize = stat.size;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function parseDispatchTask(filePath: string): Promise<DispatchTask> {
  const raw = await fs.readFile(filePath, 'utf8');
  const match = raw.match(/^---\\n([\\s\\S]*?)\\n---\\n([\\s\\S]*)$/);
  if (!match) throw new Error('task parse failed: missing YAML front matter');

  const frontMatter = Object.fromEntries(
    match[1]
      .split('\\n')
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf(':');
        const key = line.slice(0, index).trim();
        const value = JSON.parse(line.slice(index + 1).trim());
        return [key, value];
      }),
  );

  const body = match[2].trim();
  const replyPrefix = '回复内容：';
  if (!body.startsWith(replyPrefix)) {
    throw new Error('task parse failed: missing 回复内容 prefix');
  }

  return {
    taskId: path.basename(filePath, '.md'),
    filename: path.basename(filePath),
    sourcePath: filePath,
    currentPath: filePath,
    chat: String(frontMatter.chat ?? ''),
    username: String(frontMatter.username ?? ''),
    isGroup: Boolean(frontMatter.is_group),
    sender: String(frontMatter.sender ?? ''),
    lastMessage: String(frontMatter.last_message ?? ''),
    replyText: body.slice(replyPrefix.length).trim(),
    msgType: frontMatter.msg_type ? String(frontMatter.msg_type) : undefined,
    timestamp: typeof frontMatter.timestamp === 'number' ? frontMatter.timestamp : undefined,
    time: frontMatter.time ? String(frontMatter.time) : undefined,
  };
}
```

Add to `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts` a helper that lists only top-level `.md` files and ignores subdirectories:

```ts
export async function listPendingTaskPaths(outputDir: string): Promise<string[]> {
  const names = await fs.readdir(outputDir, { withFileTypes: true });
  return names
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(outputDir, entry.name))
    .sort();
}
```

- [ ] **Step 4: Run the parser test file again**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/output-dispatcher.test.ts
```

Expected: PASS for directory bootstrap, recovery, parser, and stable-file tests.

## Task 3: Build The Single-Queue Scheduler And Result Archiver

**Files:**
- Create: `/Users/imac/Documents/CC-project/WechatCLI/dispatcher-archiver.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`

- [ ] **Step 1: Write the failing classification and archiving tests**

Add these tests to `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`:

```ts
import {
  archiveTaskResult,
  classifyDispatchError,
} from '../dispatcher-archiver.ts';

test('classifyDispatchError sends OCR mismatch to manual_review', () => {
  const error = new Error('OCR validation failed: recognized text did not include chat "照烧鳗鱼"');
  assert.equal(classifyDispatchError(error), 'manual_review');
});

test('archiveTaskResult moves a task into sent and writes a log file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));
  await fs.mkdir(path.join(root, 'processing'), { recursive: true });
  await fs.mkdir(path.join(root, 'sent'), { recursive: true });
  await fs.mkdir(path.join(root, 'logs'), { recursive: true });
  const taskPath = path.join(root, 'processing', 'task.md');
  await fs.writeFile(taskPath, '---\\nchat: \"A\"\\n---\\n回复内容：B\\n');

  const finalPath = await archiveTaskResult({
    currentPath: taskPath,
    taskId: 'task',
    chat: 'A',
    username: 'wxid_a',
    status: 'sent',
    destinationDir: path.join(root, 'sent'),
    logsDir: path.join(root, 'logs'),
    screenshotPaths: ['/tmp/proof.png'],
    startedAt: '2026-04-14T08:00:00.000Z',
    finishedAt: '2026-04-14T08:00:01.000Z',
  });

  await fs.access(finalPath);
  await fs.access(path.join(root, 'logs', 'task.json'));
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/output-dispatcher.test.ts
```

Expected: FAIL because the archiver module does not exist yet.

- [ ] **Step 3: Implement task archiving, error classification, and the in-memory queue**

Create `/Users/imac/Documents/CC-project/WechatCLI/dispatcher-archiver.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type DispatchStatus = 'sent' | 'failed' | 'manual_review';

export function classifyDispatchError(error: unknown): DispatchStatus {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('OCR validation failed')) {
    return 'manual_review';
  }
  return 'failed';
}

export async function archiveTaskResult(input: {
  currentPath: string;
  taskId: string;
  chat: string;
  username: string;
  status: DispatchStatus;
  destinationDir: string;
  logsDir: string;
  screenshotPaths: string[];
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
}): Promise<string> {
  const filename = path.basename(input.currentPath);
  const finalPath = path.join(input.destinationDir, filename);
  await fs.rename(input.currentPath, finalPath);
  await fs.writeFile(
    path.join(input.logsDir, `${input.taskId}.json`),
    JSON.stringify(
      {
        task_id: input.taskId,
        filename,
        chat: input.chat,
        username: input.username,
        started_at: input.startedAt ?? null,
        finished_at: input.finishedAt ?? new Date().toISOString(),
        status: input.status,
        error_message: input.errorMessage ?? null,
        screenshot_paths: input.screenshotPaths,
      },
      null,
      2,
    ),
  );
  return finalPath;
}
```

In `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts`, add the queue and processing move:

```ts
const queuedPaths = new Set<string>();
const queue: string[] = [];
let active = false;

export async function claimTaskFile(filePath: string, processingDir: string): Promise<string> {
  const destination = path.join(processingDir, path.basename(filePath));
  await fs.rename(filePath, destination);
  return destination;
}

export async function enqueueTask(filePath: string): Promise<void> {
  if (queuedPaths.has(filePath)) return;
  queuedPaths.add(filePath);
  queue.push(filePath);
}

async function drainQueue(dirs: DispatcherDirectories, sendMode: WeChatSendMode): Promise<void> {
  if (active) return;
  active = true;
  try {
    while (queue.length > 0) {
      const nextPath = queue.shift()!;
      queuedPaths.delete(nextPath);
      await processTaskFile(nextPath, dirs, { sendMode });
    }
  } finally {
    active = false;
  }
}
```

- [ ] **Step 4: Run the test file again**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/output-dispatcher.test.ts
```

Expected: PASS for classification and archiving tests.

## Task 4: Integrate The Existing WeChat Sender, Preserve Screenshots, And Start Watching `output/`

**Files:**
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/wechat-ui-send.test.ts`

- [ ] **Step 1: Write the failing screenshot-retention and task-processing tests**

Add to `/Users/imac/Documents/CC-project/WechatCLI/tests/wechat-ui-send.test.ts`:

```ts
test('sendViaWeChat keeps the validation screenshot when cleanupScreenshot is false', async () => {
  const screenshotPath = path.join(os.tmpdir(), `wechat-proof-${Date.now()}.png`);
  let delivered = false;

  await sendViaWeChat(
    {
      chat: '照烧鳗鱼',
      username: 'wxid_piely0ql732922',
      is_group: false,
      last_message: '你们有沙发卖吗',
      sender: '',
    },
    '有的呀，我们这边有多款沙发可选。',
    {
      captureScreen: async () => {
        await fs.writeFile(screenshotPath, 'proof');
        return screenshotPath;
      },
      runOcr: async () => '照烧鳗鱼 你们有沙发卖吗',
      deliverWeChatMessage: async () => {
        delivered = true;
      },
      cleanupScreenshot: false,
    },
  );

  assert.equal(delivered, true);
  await fs.access(screenshotPath);
  await fs.unlink(screenshotPath);
});
```

Add to `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`:

```ts
import { processTaskFile } from '../dispatcher.ts';

test('processTaskFile moves a successful task into sent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));
  const outputDir = root;
  const dirs = await ensureDispatcherDirectories(outputDir);
  const taskPath = path.join(outputDir, 'task.md');
  await fs.writeFile(
    taskPath,
    '---\\nchat: \"照烧鳗鱼\"\\nusername: \"wxid_a\"\\nis_group: false\\nlast_message: \"你们有沙发卖吗\"\\nsender: \"\"\\n---\\n回复内容：好的\\n',
  );

  await processTaskFile(taskPath, dirs, {
    sendTask: async () => ['/tmp/proof.png'],
  });

  await fs.access(path.join(dirs.sentDir, 'task.md'));
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/wechat-ui-send.test.ts tests/output-dispatcher.test.ts
```

Expected: FAIL because `cleanupScreenshot` and `processTaskFile(...)` do not exist yet.

- [ ] **Step 3: Implement sender integration and watcher startup**

In `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`, extend the options type:

```ts
export interface SendViaWeChatOptions {
  projectRoot?: string;
  sendMode?: WeChatSendMode;
  captureScreen?: () => Promise<string>;
  cleanupScreenshot?: boolean;
  // existing injected seams stay in place
}
```

Then change the cleanup block:

```ts
const cleanupScreenshot = options.cleanupScreenshot ?? true;

try {
  const recognizedText = await ocr(screenshotPath);
  await validate(context, recognizedText);
} finally {
  if (cleanupScreenshot) {
    await fs.unlink(screenshotPath).catch(() => {});
  }
}
```

In `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts`, add the real task processor:

```ts
import * as fsSync from 'node:fs';
import { archiveTaskResult, classifyDispatchError } from './dispatcher-archiver.ts';
import { parseDispatchTask, waitForStableFile, type DispatchTask } from './task-parser.ts';
import { sendViaWeChat, type WeChatSendMode } from './wechat-ui-send.ts';

export async function processTaskFile(
  filePath: string,
  dirs: DispatcherDirectories,
  deps: {
    sendMode?: WeChatSendMode;
    sendTask?: (task: DispatchTask) => Promise<string[]>;
  } = {},
): Promise<void> {
  const startedAt = new Date().toISOString();
  await waitForStableFile(filePath);
  const processingPath = await claimTaskFile(filePath, dirs.processingDir);
  const task = await parseDispatchTask(processingPath);
  task.currentPath = processingPath;

  try {
    const screenshotPaths =
      (await deps.sendTask?.(task)) ??
      (await sendTaskViaWeChat(task, dirs.screenshotsDir, deps.sendMode ?? 'send'));

    await archiveTaskResult({
      currentPath: processingPath,
      taskId: task.taskId,
      chat: task.chat,
      username: task.username,
      status: 'sent',
      destinationDir: dirs.sentDir,
      logsDir: dirs.logsDir,
      screenshotPaths,
      startedAt,
    });
  } catch (error) {
    const status = classifyDispatchError(error);
    await archiveTaskResult({
      currentPath: processingPath,
      taskId: task.taskId,
      chat: task.chat,
      username: task.username,
      status,
      destinationDir: status === 'manual_review' ? dirs.manualReviewDir : dirs.failedDir,
      logsDir: dirs.logsDir,
      screenshotPaths: [],
      startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

async function sendTaskViaWeChat(
  task: DispatchTask,
  screenshotsDir: string,
  sendMode: WeChatSendMode,
): Promise<string[]> {
  const screenshotPath = path.join(screenshotsDir, `${task.taskId}-validation.png`);
  await sendViaWeChat(
    {
      chat: task.chat,
      username: task.username,
      is_group: task.isGroup,
      last_message: task.lastMessage,
      sender: task.sender,
    },
    task.replyText,
    {
      sendMode,
      captureScreen: async () => {
        await execFileAsync('screencapture', ['-x', '-t', 'png', screenshotPath]);
        return screenshotPath;
      },
      cleanupScreenshot: false,
    },
  );
  return [screenshotPath];
}

export async function startDispatcher(input: {
  outputDir: string;
  sendMode: WeChatSendMode;
}): Promise<void> {
  const dirs = await ensureDispatcherDirectories(input.outputDir);
  await recoverProcessingTasks({
    processingDir: dirs.processingDir,
    manualReviewDir: dirs.manualReviewDir,
  });

  for (const taskPath of await listPendingTaskPaths(dirs.outputDir)) {
    await enqueueTask(taskPath);
  }

  const schedulePath = async (taskPath: string): Promise<void> => {
    await enqueueTask(taskPath);
    await drainQueue(dirs, input.sendMode);
  };

  fsSync.watch(dirs.outputDir, (_eventType, filename) => {
    if (!filename || !filename.endsWith('.md')) return;
    void schedulePath(path.join(dirs.outputDir, filename));
  });

  setInterval(() => {
    void listPendingTaskPaths(dirs.outputDir).then(async (taskPaths) => {
      for (const taskPath of taskPaths) {
        await enqueueTask(taskPath);
      }
      await drainQueue(dirs, input.sendMode);
    });
  }, 10_000);

  await drainQueue(dirs, input.sendMode);
}
```

- [ ] **Step 4: Run the focused tests again**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/wechat-ui-send.test.ts tests/output-dispatcher.test.ts
```

Expected: PASS, including screenshot retention and successful task archiving.

## Task 5: Final Verification And Runtime Smoke Check

**Files:**
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/monitor.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/task-parser.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/dispatcher-archiver.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/wechat-ui-send.test.ts`

- [ ] **Step 1: Run the full automated checks**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npm test
```

Expected: PASS, all test files green.

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npx tsc --noEmit
```

Expected: PASS

- [ ] **Step 2: Run a dispatcher bootstrap smoke check**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && WECHAT_SEND_MODE=paste-only node --no-warnings --loader ts-node/esm monitor.ts
```

Expected:

- process starts cleanly
- logs show `output/`, `processing/`, `sent/`, `failed/`, `manual_review/`, `logs/`, and `screenshots/` are ready
- no `wechat-cli` / `ANTHROPIC_API_KEY` requirement remains

- [ ] **Step 3: Run a guarded local task-file smoke check**

Create a sample task file:

```bash
cat > /Users/imac/Documents/CC-project/WechatCLI/output/2099-01-01_00-00-00_测试联系人.md <<'EOF'
---
chat: "照烧鳗鱼"
username: "wxid_piely0ql732922"
is_group: false
last_message: "你们有沙发卖吗"
sender: ""
timestamp: 1776149999
---
回复内容：这是一条 paste-only 冒烟测试消息。
EOF
```

Expected:

- file first appears in `output/`
- dispatcher moves it into `processing/`
- after send path completes, it lands in `sent/` or, if OCR mismatch is triggered intentionally, `manual_review/`
- a JSON log appears in `output/logs/`
- at least one validation screenshot appears in `output/screenshots/`

- [ ] **Step 4: Commit**

```bash
cd /Users/imac/Documents/CC-project/WechatCLI
git add monitor.ts dispatcher.ts task-parser.ts dispatcher-archiver.ts wechat-ui-send.ts package.json tsconfig.json tests/output-dispatcher.test.ts tests/wechat-ui-send.test.ts docs/superpowers/specs/2026-04-14-output-dispatcher-design.md docs/superpowers/plans/2026-04-14-output-dispatcher.md
git commit -m "refactor: add output-driven wechat dispatcher"
```
