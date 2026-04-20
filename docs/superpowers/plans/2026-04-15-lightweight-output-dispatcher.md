# Lightweight Output Dispatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current mixed monitor with a lightweight downstream-only dispatcher that watches `output/*.md`, sends one task at a time, and archives each task into `processing/`, `sent/`, or `failed/`.

**Architecture:** Keep `monitor.ts` as a thin startup file, move runtime orchestration into `dispatcher.ts`, parse markdown tasks in `task-parser.ts`, and simplify `wechat-ui-send.ts` so it only performs WeChat UI prepare + deliver without OCR. Default send mode is `paste-only`, with `send` available via environment variable.

**Tech Stack:** Node.js, TypeScript, Node built-in test runner, `fs/promises`, `fs.watch`, AppleScript, macOS `osascript`

---

## File Structure

### Files To Modify

- Modify: `/Users/imac/Documents/CC-project/WechatCLI/monitor.ts`
  Replace the old polling / model / markdown-writing flow with a thin dispatcher entrypoint.
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`
  Remove OCR, screenshot, and validation logic so the module only opens a chat and pastes or sends a reply.
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/wechat-ui-send.test.ts`
  Rewrite tests to match the simplified send orchestration.
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/package.json`
  Run every test file under `tests/*.test.ts`.
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tsconfig.json`
  Include `tests/**/*.ts` and new root modules in `tsc --noEmit`.

### Files To Create

- Create: `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts`
  Bootstrap directories, recover abandoned processing files, watch `output/`, manage the serial queue, and archive tasks.
- Create: `/Users/imac/Documents/CC-project/WechatCLI/task-parser.ts`
  Parse front matter and `回复内容：...` into a typed task object and provide a lightweight file-stability helper.
- Create: `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`
  Cover directory bootstrapping, parser behavior, task claiming, task archiving, and lightweight runtime helpers.

## Task 1: Bootstrap The Lightweight Dispatcher Runtime

**Files:**
- Create: `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/monitor.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/package.json`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tsconfig.json`
- Create: `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`

- [ ] **Step 1: Write the failing bootstrap tests**

Create `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts` with:

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

test('ensureDispatcherDirectories creates processing, sent, and failed directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));

  const dirs = await ensureDispatcherDirectories(root);

  await Promise.all([
    fs.access(path.join(root, 'processing')),
    fs.access(path.join(root, 'sent')),
    fs.access(path.join(root, 'failed')),
  ]);

  assert.equal(dirs.outputDir, root);
  assert.equal(dirs.processingDir, path.join(root, 'processing'));
  assert.equal(dirs.sentDir, path.join(root, 'sent'));
  assert.equal(dirs.failedDir, path.join(root, 'failed'));
});

test('recoverProcessingTasks moves abandoned processing tasks into failed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));
  await fs.mkdir(path.join(root, 'processing'), { recursive: true });
  await fs.mkdir(path.join(root, 'failed'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'processing', 'task.md'),
    '---\\nchat: \"A\"\\n---\\n回复内容：B\\n',
  );

  await recoverProcessingTasks({
    processingDir: path.join(root, 'processing'),
    failedDir: path.join(root, 'failed'),
  });

  await fs.access(path.join(root, 'failed', 'task.md'));
  await assert.rejects(() => fs.access(path.join(root, 'processing', 'task.md')));
});
```

- [ ] **Step 2: Run the new bootstrap test to verify it fails**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/output-dispatcher.test.ts`

Expected: FAIL because `dispatcher.ts` and its exports do not exist yet.

- [ ] **Step 3: Implement the dispatcher bootstrap, thin monitor entrypoint, and test configuration**

Create `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts` with:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';

import type { WeChatSendMode } from './wechat-ui-send.ts';

export interface DispatcherDirectories {
  outputDir: string;
  processingDir: string;
  sentDir: string;
  failedDir: string;
}

export interface StartDispatcherOptions {
  outputDir: string;
  sendMode?: WeChatSendMode;
  logger?: Pick<Console, 'info' | 'error'>;
}

export async function ensureDispatcherDirectories(outputDir: string): Promise<DispatcherDirectories> {
  const dirs: DispatcherDirectories = {
    outputDir,
    processingDir: path.join(outputDir, 'processing'),
    sentDir: path.join(outputDir, 'sent'),
    failedDir: path.join(outputDir, 'failed'),
  };

  await Promise.all(Object.values(dirs).map((dir) => fs.mkdir(dir, { recursive: true })));
  return dirs;
}

export async function recoverProcessingTasks(input: {
  processingDir: string;
  failedDir: string;
}): Promise<void> {
  const names = await fs.readdir(input.processingDir).catch(() => []);

  for (const name of names.filter((entry) => entry.endsWith('.md'))) {
    await fs.rename(
      path.join(input.processingDir, name),
      path.join(input.failedDir, name),
    );
  }
}

export async function startDispatcher(options: StartDispatcherOptions): Promise<{ close(): void }> {
  const dirs = await ensureDispatcherDirectories(options.outputDir);
  await recoverProcessingTasks({
    processingDir: dirs.processingDir,
    failedDir: dirs.failedDir,
  });

  const watcher: FSWatcher = watch(dirs.outputDir, () => {});
  return {
    close() {
      watcher.close();
    },
  };
}
```

Replace `/Users/imac/Documents/CC-project/WechatCLI/monitor.ts` with:

```ts
import * as path from 'node:path';

import { startDispatcher } from './dispatcher.ts';
import type { WeChatSendMode } from './wechat-ui-send.ts';

const OUTPUT_DIR = path.join(process.cwd(), 'output');
const SEND_MODE: WeChatSendMode =
  process.env.WECHAT_SEND_MODE === 'send' ? 'send' : 'paste-only';

console.log('=== WeChat Output Dispatcher ===');
console.log(`任务目录：${OUTPUT_DIR}`);
console.log(`发送模式：${SEND_MODE === 'send' ? '自动发送' : '仅粘贴不发送'}`);

await startDispatcher({
  outputDir: OUTPUT_DIR,
  sendMode: SEND_MODE,
});
```

Update `/Users/imac/Documents/CC-project/WechatCLI/package.json` to:

```json
{
  "name": "wechat-monitor",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test --no-warnings --loader ts-node/esm tests/*.test.ts",
    "start": "node --no-warnings --loader ts-node/esm monitor.ts",
    "dev": "node --no-warnings --loader ts-node/esm monitor.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.88.0",
    "openai": "^6.34.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.0.0"
  }
}
```

Update `/Users/imac/Documents/CC-project/WechatCLI/tsconfig.json` to:

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

- [ ] **Step 4: Run the bootstrap test to verify it passes**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/output-dispatcher.test.ts`

Expected: PASS for both bootstrap tests.

## Task 2: Parse Markdown Tasks And Wait For Stable Files

**Files:**
- Create: `/Users/imac/Documents/CC-project/WechatCLI/task-parser.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`

- [ ] **Step 1: Add the failing parser and stable-file tests**

Append these tests to `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`:

```ts
import {
  parseDispatchTask,
  waitForStableFile,
} from '../task-parser.ts';

test('parseDispatchTask reads front matter and reply body from markdown task files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));
  const filePath = path.join(root, 'task.md');
  await fs.writeFile(
    filePath,
    [
      '---',
      'chat: \"照烧鳗鱼\"',
      'username: \"wxid_piely0ql732922\"',
      'is_group: false',
      'last_message: \"你们有沙发卖吗\"',
      'sender: \"\"',
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
  assert.equal(task.sender, '');
  assert.equal(task.replyText, '有的呀，我们这边有沙发可以看。');
});

test('waitForStableFile resolves after a file stops changing size', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));
  const filePath = path.join(root, 'task.md');

  await fs.writeFile(filePath, 'a');

  const pending = waitForStableFile(filePath, {
    intervalMs: 30,
    stableTicks: 2,
    maxChecks: 10,
  });

  await fs.appendFile(filePath, 'b');
  await pending;

  const finalContent = await fs.readFile(filePath, 'utf8');
  assert.equal(finalContent, 'ab');
});
```

- [ ] **Step 2: Run the parser test file to verify it fails**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/output-dispatcher.test.ts`

Expected: FAIL because `task-parser.ts` and its exports do not exist yet.

- [ ] **Step 3: Implement the markdown parser and stability helper**

Create `/Users/imac/Documents/CC-project/WechatCLI/task-parser.ts` with:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface DispatchTask {
  taskId: string;
  sourcePath: string;
  currentPath: string;
  chat: string;
  username: string;
  isGroup: boolean;
  lastMessage: string;
  sender: string;
  replyText: string;
  msgType?: string;
  timestamp?: number;
  time?: string;
}

export interface WaitForStableFileOptions {
  intervalMs?: number;
  stableTicks?: number;
  maxChecks?: number;
}

function parseScalar(rawValue: string): unknown {
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

export async function parseDispatchTask(filePath: string): Promise<DispatchTask> {
  const content = await fs.readFile(filePath, 'utf8');
  const match = content.match(/^---\\n([\\s\\S]*?)\\n---\\n([\\s\\S]*)$/);

  if (!match) {
    throw new Error(`Invalid task file: missing front matter in ${filePath}`);
  }

  const [, frontMatterText, bodyText] = match;
  const frontMatter: Record<string, unknown> = {};

  for (const line of frontMatterText.split('\\n')) {
    if (!line.trim()) continue;
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      throw new Error(`Invalid front matter line: ${line}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    frontMatter[key] = parseScalar(value);
  }

  const replyText = bodyText.replace(/^回复内容：/, '').trim();
  if (!frontMatter.chat || !replyText) {
    throw new Error(`Invalid task file: missing chat or replyText in ${filePath}`);
  }

  return {
    taskId: path.basename(filePath, '.md'),
    sourcePath: filePath,
    currentPath: filePath,
    chat: String(frontMatter.chat),
    username: String(frontMatter.username ?? ''),
    isGroup: Boolean(frontMatter.is_group),
    lastMessage: String(frontMatter.last_message ?? ''),
    sender: String(frontMatter.sender ?? ''),
    replyText,
    msgType: frontMatter.msg_type ? String(frontMatter.msg_type) : undefined,
    timestamp:
      typeof frontMatter.timestamp === 'number' ? frontMatter.timestamp : undefined,
    time: frontMatter.time ? String(frontMatter.time) : undefined,
  };
}

export async function waitForStableFile(
  filePath: string,
  options: WaitForStableFileOptions = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? 300;
  const stableTicks = options.stableTicks ?? 2;
  const maxChecks = options.maxChecks ?? 8;
  let lastSize = -1;
  let stableCount = 0;

  for (let check = 0; check < maxChecks; check += 1) {
    const stat = await fs.stat(filePath);

    if (stat.size === lastSize) {
      stableCount += 1;
      if (stableCount >= stableTicks) {
        return;
      }
    } else {
      lastSize = stat.size;
      stableCount = 0;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
```

- [ ] **Step 4: Run the parser test file again**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/output-dispatcher.test.ts`

Expected: PASS for the bootstrap tests and the new parser tests.

## Task 3: Remove OCR And Simplify The WeChat Send Layer

**Files:**
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/wechat-ui-send.test.ts`

- [ ] **Step 1: Rewrite the send-layer tests to describe the new non-OCR flow**

Replace `/Users/imac/Documents/CC-project/WechatCLI/tests/wechat-ui-send.test.ts` with:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReplyPreview,
  resolveDeliverScriptPath,
  resolvePrepareScriptPath,
  sendViaWeChat,
} from '../wechat-ui-send.ts';

test('resolvePrepareScriptPath points to the prepare AppleScript file', () => {
  assert.equal(
    resolvePrepareScriptPath('/tmp/wechat-project'),
    '/tmp/wechat-project/scripts/prepare_wechat_chat.applescript',
  );
});

test('resolveDeliverScriptPath points to the deliver AppleScript file', () => {
  assert.equal(
    resolveDeliverScriptPath('/tmp/wechat-project'),
    '/tmp/wechat-project/scripts/deliver_wechat_message.applescript',
  );
});

test('buildReplyPreview includes the chat name and outgoing body', () => {
  assert.match(buildReplyPreview('王总', '今天下午 3 点方便电话沟通吗？'), /王总/);
  assert.match(buildReplyPreview('王总', '今天下午 3 点方便电话沟通吗？'), /今天下午 3 点方便电话沟通吗？/);
});

test('sendViaWeChat executes prepare and deliver in order', async () => {
  const calls: string[] = [];

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
      sendMode: 'paste-only',
      prepareWeChatChat: async (chatName) => {
        calls.push(`prepare:${chatName}`);
      },
      deliverWeChatMessage: async (_reply, sendMode) => {
        calls.push(`deliver:${sendMode}`);
      },
    },
  );

  assert.deepEqual(calls, [
    'prepare:照烧鳗鱼',
    'deliver:paste-only',
  ]);
});
```

- [ ] **Step 2: Run the send-layer tests to verify they fail**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/wechat-ui-send.test.ts`

Expected: FAIL because `wechat-ui-send.ts` still exports OCR helpers and still expects prepare -> OCR -> deliver orchestration.

- [ ] **Step 3: Implement the simplified UI send module**

Replace `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts` with:

```ts
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type WeChatSendMode = 'send' | 'paste-only';

export interface WeChatMessageContext {
  chat: string;
  username: string;
  is_group: boolean;
  last_message: string;
  sender?: string;
}

export interface SendViaWeChatOptions {
  projectRoot?: string;
  sendMode?: WeChatSendMode;
  prepareWeChatChat?: (chatName: string) => Promise<void>;
  deliverWeChatMessage?: (
    reply: string,
    sendMode: WeChatSendMode,
  ) => Promise<void>;
}

export function resolvePrepareScriptPath(projectRoot: string): string {
  return path.join(projectRoot, 'scripts', 'prepare_wechat_chat.applescript');
}

export function resolveDeliverScriptPath(projectRoot: string): string {
  return path.join(projectRoot, 'scripts', 'deliver_wechat_message.applescript');
}

export function buildReplyPreview(chatName: string, reply: string): string {
  const bodyLines = reply.split('\\n').map((line) => `    ${line}`);
  return [
    '  准备发送自动回复：',
    `  会话：${chatName}`,
    '  内容：',
    ...bodyLines,
  ].join('\\n');
}

async function runScript(scriptPath: string, args: string[]): Promise<void> {
  try {
    await execFileAsync('osascript', ['-s', 'o', scriptPath, ...args]);
  } catch (err: any) {
    const detail =
      err?.stderr?.trim() ||
      err?.stdout?.trim() ||
      err?.message ||
      'unknown osascript error';
    throw new Error(`wechat ui automation failed: ${detail}`);
  }
}

async function prepareWeChatChat(chatName: string, projectRoot: string): Promise<void> {
  await runScript(resolvePrepareScriptPath(projectRoot), [chatName]);
}

async function deliverWeChatMessage(
  reply: string,
  sendMode: WeChatSendMode,
  projectRoot: string,
): Promise<void> {
  await runScript(resolveDeliverScriptPath(projectRoot), [reply, sendMode]);
}

export async function sendViaWeChat(
  context: WeChatMessageContext,
  reply: string,
  options: SendViaWeChatOptions = {},
): Promise<void> {
  const sendMode = options.sendMode ?? 'paste-only';
  const projectRoot = options.projectRoot ?? process.cwd();
  const prepare =
    options.prepareWeChatChat ??
    ((chatName: string) => prepareWeChatChat(chatName, projectRoot));
  const deliver =
    options.deliverWeChatMessage ??
    ((replyText: string, mode: WeChatSendMode) =>
      deliverWeChatMessage(replyText, mode, projectRoot));

  await prepare(context.chat);
  await deliver(reply, sendMode);
}
```

- [ ] **Step 4: Run the send-layer tests again**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/wechat-ui-send.test.ts`

Expected: PASS

## Task 4: Implement Task Claiming, Serial Processing, And Archiving

**Files:**
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`

- [ ] **Step 1: Add failing tests for pending-task discovery and success/failure archiving**

Append these tests to `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`:

```ts
import {
  listPendingTaskFiles,
  processTaskFile,
  type DispatcherDirectories,
} from '../dispatcher.ts';

test('listPendingTaskFiles only returns markdown files in the output root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));
  const dirs = await ensureDispatcherDirectories(root);

  await fs.writeFile(path.join(root, 'a.md'), '---\\nchat: \"A\"\\n---\\n回复内容：B\\n');
  await fs.writeFile(path.join(root, 'note.txt'), 'ignore me');
  await fs.writeFile(path.join(dirs.processingDir, 'b.md'), '---\\nchat: \"B\"\\n---\\n回复内容：C\\n');

  const pendingFiles = await listPendingTaskFiles(root);

  assert.deepEqual(pendingFiles.map((filePath) => path.basename(filePath)), ['a.md']);
});

test('processTaskFile moves a successfully sent task into sent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));
  const dirs = await ensureDispatcherDirectories(root);
  const taskPath = path.join(root, 'task.md');

  await fs.writeFile(taskPath, '---\\nchat: \"照烧鳗鱼\"\\n---\\n回复内容：你好\\n');

  const result = await processTaskFile(taskPath, {
    dirs,
    sendMode: 'paste-only',
    waitForStableFileFn: async () => {},
    parseDispatchTaskFn: async (currentPath) => ({
      taskId: 'task',
      sourcePath: currentPath,
      currentPath,
      chat: '照烧鳗鱼',
      username: 'wxid_demo',
      isGroup: false,
      lastMessage: '',
      sender: '',
      replyText: '你好',
    }),
    sendViaWeChatFn: async () => {},
  });

  assert.equal(result.status, 'sent');
  await fs.access(path.join(dirs.sentDir, 'task.md'));
  await assert.rejects(() => fs.access(taskPath));
});

test('processTaskFile moves a failed task into failed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));
  const dirs = await ensureDispatcherDirectories(root);
  const taskPath = path.join(root, 'task.md');

  await fs.writeFile(taskPath, '---\\nchat: \"照烧鳗鱼\"\\n---\\n回复内容：你好\\n');

  const result = await processTaskFile(taskPath, {
    dirs,
    sendMode: 'paste-only',
    waitForStableFileFn: async () => {},
    parseDispatchTaskFn: async (currentPath) => ({
      taskId: 'task',
      sourcePath: currentPath,
      currentPath,
      chat: '照烧鳗鱼',
      username: 'wxid_demo',
      isGroup: false,
      lastMessage: '',
      sender: '',
      replyText: '你好',
    }),
    sendViaWeChatFn: async () => {
      throw new Error('send failed');
    },
  });

  assert.equal(result.status, 'failed');
  await fs.access(path.join(dirs.failedDir, 'task.md'));
  await assert.rejects(() => fs.access(taskPath));
});
```

- [ ] **Step 2: Run the dispatcher test file to verify it fails**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/output-dispatcher.test.ts`

Expected: FAIL because `listPendingTaskFiles` and `processTaskFile` are not implemented yet.

- [ ] **Step 3: Implement pending-task discovery, task processing, and runtime queueing**

Update `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts` to:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';

import {
  parseDispatchTask,
  waitForStableFile,
  type DispatchTask,
} from './task-parser.ts';
import { sendViaWeChat, type WeChatSendMode } from './wechat-ui-send.ts';

export interface DispatcherDirectories {
  outputDir: string;
  processingDir: string;
  sentDir: string;
  failedDir: string;
}

export interface ProcessTaskFileOptions {
  dirs: DispatcherDirectories;
  sendMode: WeChatSendMode;
  waitForStableFileFn?: typeof waitForStableFile;
  parseDispatchTaskFn?: (filePath: string) => Promise<DispatchTask>;
  sendViaWeChatFn?: typeof sendViaWeChat;
}

export interface StartDispatcherOptions {
  outputDir: string;
  sendMode?: WeChatSendMode;
  logger?: Pick<Console, 'info' | 'error'>;
  watchFactory?: typeof watch;
}

export interface ProcessTaskResult {
  status: 'sent' | 'failed';
  finalPath: string;
  error?: Error;
}

export async function ensureDispatcherDirectories(outputDir: string): Promise<DispatcherDirectories> {
  const dirs: DispatcherDirectories = {
    outputDir,
    processingDir: path.join(outputDir, 'processing'),
    sentDir: path.join(outputDir, 'sent'),
    failedDir: path.join(outputDir, 'failed'),
  };

  await Promise.all(Object.values(dirs).map((dir) => fs.mkdir(dir, { recursive: true })));
  return dirs;
}

export async function recoverProcessingTasks(input: {
  processingDir: string;
  failedDir: string;
}): Promise<void> {
  const names = await fs.readdir(input.processingDir).catch(() => []);

  for (const name of names.filter((entry) => entry.endsWith('.md'))) {
    await fs.rename(
      path.join(input.processingDir, name),
      path.join(input.failedDir, name),
    );
  }
}

export async function listPendingTaskFiles(outputDir: string): Promise<string[]> {
  const entries = await fs.readdir(outputDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(outputDir, entry.name))
    .sort();
}

export async function processTaskFile(
  taskPath: string,
  options: ProcessTaskFileOptions,
): Promise<ProcessTaskResult> {
  const waitForStable = options.waitForStableFileFn ?? waitForStableFile;
  const parseTask = options.parseDispatchTaskFn ?? parseDispatchTask;
  const sendTask = options.sendViaWeChatFn ?? sendViaWeChat;

  await waitForStable(taskPath);

  const processingPath = path.join(options.dirs.processingDir, path.basename(taskPath));
  await fs.rename(taskPath, processingPath);

  try {
    const task = await parseTask(processingPath);

    await sendTask(
      {
        chat: task.chat,
        username: task.username,
        is_group: task.isGroup,
        last_message: task.lastMessage,
        sender: task.sender,
      },
      task.replyText,
      { sendMode: options.sendMode },
    );

    const sentPath = path.join(options.dirs.sentDir, path.basename(processingPath));
    await fs.rename(processingPath, sentPath);
    return { status: 'sent', finalPath: sentPath };
  } catch (error) {
    const failedPath = path.join(options.dirs.failedDir, path.basename(processingPath));
    await fs.rename(processingPath, failedPath);
    return {
      status: 'failed',
      finalPath: failedPath,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function createSerialQueue(handler: (taskPath: string) => Promise<void>) {
  const queued = new Set<string>();
  const pending: string[] = [];
  let running = false;
  let activeTask: string | null = null;

  async function runNext(): Promise<void> {
    if (running) return;
    const next = pending.shift();
    if (!next) return;

    running = true;
    activeTask = next;
    try {
      await handler(next);
    } finally {
      queued.delete(next);
      activeTask = null;
      running = false;
      void runNext();
    }
  }

  return {
    add(taskPath: string) {
      if (queued.has(taskPath) || activeTask === taskPath) return;
      queued.add(taskPath);
      pending.push(taskPath);
      void runNext();
    },
  };
}

export async function startDispatcher(options: StartDispatcherOptions): Promise<{ close(): void }> {
  const logger = options.logger ?? console;
  const sendMode = options.sendMode ?? 'paste-only';
  const dirs = await ensureDispatcherDirectories(options.outputDir);
  await recoverProcessingTasks({
    processingDir: dirs.processingDir,
    failedDir: dirs.failedDir,
  });

  const queue = createSerialQueue(async (taskPath) => {
    const result = await processTaskFile(taskPath, { dirs, sendMode });
    if (result.status === 'sent') {
      logger.info(`任务已发送：${path.basename(result.finalPath)}`);
    } else {
      logger.error(`任务发送失败：${path.basename(result.finalPath)}${result.error ? ` - ${result.error.message}` : ''}`);
    }
  });

  for (const taskPath of await listPendingTaskFiles(dirs.outputDir)) {
    queue.add(taskPath);
  }

  const watchFactory = options.watchFactory ?? watch;
  const watcher: FSWatcher = watchFactory(dirs.outputDir, (_eventType, fileName) => {
    if (typeof fileName !== 'string' || !fileName.endsWith('.md')) {
      return;
    }

    const candidatePath = path.join(dirs.outputDir, fileName);
    void fs.stat(candidatePath).then(
      (stat) => {
        if (stat.isFile()) {
          queue.add(candidatePath);
        }
      },
      () => {},
    );
  });

  return {
    close() {
      watcher.close();
    },
  };
}
```

- [ ] **Step 4: Run the dispatcher test file again**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/output-dispatcher.test.ts`

Expected: PASS

## Task 5: Verify The Full Lightweight Dispatcher

**Files:**
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/monitor.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/dispatcher.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/task-parser.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/wechat-ui-send.test.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/output-dispatcher.test.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/package.json`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tsconfig.json`

- [ ] **Step 1: Run the full automated checks**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && npm test`

Expected: PASS with both `tests/wechat-ui-send.test.ts` and `tests/output-dispatcher.test.ts`

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && npx tsc --noEmit`

Expected: PASS

- [ ] **Step 2: Run a startup smoke check**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && node --no-warnings --loader ts-node/esm -e "setTimeout(() => process.exit(0), 1000); import('./monitor.ts').catch((err) => { console.error(err); process.exit(1); });"`

Expected: The dispatcher prints startup information and exits cleanly after the injected timeout.

- [ ] **Step 3: Run a guarded local task-file smoke check**

Prepare a safe task file:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI
cat > output/zz_smoke_test.md <<'EOF'
---
chat: "文件传输助手"
username: "filehelper"
is_group: false
last_message: ""
sender: ""
---
回复内容：这是一条 dispatcher 冒烟测试消息，请忽略。
EOF
```

Then run the dispatcher in default mode:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && node --no-warnings --loader ts-node/esm monitor.ts
```

Expected:

- dispatcher 发现 `output/zz_smoke_test.md`
- 任务先移动到 `output/processing/`
- 微信被打开并定位到 `文件传输助手`
- 文本被粘贴到输入框
- 因为默认是 `paste-only`，不会自动发送
- 成功后任务移动到 `output/sent/`

- [ ] **Step 4: Verify auto-send mode deliberately**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && WECHAT_SEND_MODE=send node --no-warnings --loader ts-node/esm monitor.ts
```

Expected:

- dispatcher 启动时显示“自动发送”
- 只有在用户明确选择该模式时才会回车发送

- [ ] **Step 5: Workspace note**

This workspace is currently not a git repository, so there is no commit step in this plan. If the project is later moved into a git repo, add a final commit after verification passes.
