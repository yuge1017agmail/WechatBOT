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

export async function ensureDispatcherDirectories(
  outputDir: string,
): Promise<DispatcherDirectories> {
  const dirs: DispatcherDirectories = {
    outputDir,
    processingDir: path.join(outputDir, 'processing'),
    sentDir: path.join(outputDir, 'sent'),
    failedDir: path.join(outputDir, 'failed'),
  };

  await Promise.all(
    Object.values(dirs).map((dir) => fs.mkdir(dir, { recursive: true })),
  );
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
    if (running) {
      return;
    }

    const next = pending.shift();
    if (!next) {
      return;
    }

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
      if (queued.has(taskPath) || activeTask === taskPath) {
        return;
      }

      queued.add(taskPath);
      pending.push(taskPath);
      void runNext();
    },
  };
}

export async function startDispatcher(
  options: StartDispatcherOptions,
): Promise<{ close(): void }> {
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
      return;
    }

    logger.error(
      `任务发送失败：${path.basename(result.finalPath)}${
        result.error ? ` - ${result.error.message}` : ''
      }`,
    );
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
