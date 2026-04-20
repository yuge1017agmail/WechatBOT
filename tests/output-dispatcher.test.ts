import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  ensureDispatcherDirectories,
  listPendingTaskFiles,
  processTaskFile,
  recoverProcessingTasks,
} from '../dispatcher.ts';
import {
  parseDispatchTask,
  waitForStableFile,
} from '../task-parser.ts';

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
    '---\nchat: "A"\n---\n回复内容：B\n',
  );

  await recoverProcessingTasks({
    processingDir: path.join(root, 'processing'),
    failedDir: path.join(root, 'failed'),
  });

  await fs.access(path.join(root, 'failed', 'task.md'));
  await assert.rejects(() => fs.access(path.join(root, 'processing', 'task.md')));
});

test('parseDispatchTask reads front matter and reply body from markdown task files', async () => {
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
    ].join('\n'),
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

test('listPendingTaskFiles only returns markdown files in the output root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));
  const dirs = await ensureDispatcherDirectories(root);

  await fs.writeFile(path.join(root, 'a.md'), '---\nchat: "A"\n---\n回复内容：B\n');
  await fs.writeFile(path.join(root, 'note.txt'), 'ignore me');
  await fs.writeFile(
    path.join(dirs.processingDir, 'b.md'),
    '---\nchat: "B"\n---\n回复内容：C\n',
  );

  const pendingFiles = await listPendingTaskFiles(root);

  assert.deepEqual(
    pendingFiles.map((filePath) => path.basename(filePath)),
    ['a.md'],
  );
});

test('processTaskFile moves a successfully sent task into sent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-dispatcher-'));
  const dirs = await ensureDispatcherDirectories(root);
  const taskPath = path.join(root, 'task.md');

  await fs.writeFile(taskPath, '---\nchat: "照烧鳗鱼"\n---\n回复内容：你好\n');

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

  await fs.writeFile(taskPath, '---\nchat: "照烧鳗鱼"\n---\n回复内容：你好\n');

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
