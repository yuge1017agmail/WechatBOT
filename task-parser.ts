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
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    throw new Error(`Invalid task file: missing front matter in ${filePath}`);
  }

  const [, frontMatterText, bodyText] = match;
  const frontMatter: Record<string, unknown> = {};

  for (const line of frontMatterText.split('\n')) {
    if (!line.trim()) {
      continue;
    }

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
