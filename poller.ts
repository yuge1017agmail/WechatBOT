import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NewMessageEntry {
  chat: string;
  username: string;
  is_group: boolean;
  last_message: string;
  msg_type?: string;
  sender?: string;
  time?: string;
  timestamp?: number;
}

interface ChatHistory {
  messages: string[];
}

// ─── WeChat CLI ──────────────────────────────────────────────────────────────

async function runWechatCLI(args: string[]): Promise<unknown> {
  const cmd = `wechat-cli ${args.join(' ')}`;
  try {
    const { stdout } = await execAsync(cmd);
    return JSON.parse(stdout);
  } catch (err: any) {
    if (err.stdout) {
      try { return JSON.parse(err.stdout); } catch { /* fall through */ }
    }
    throw new Error(`wechat-cli failed: ${err.message}`);
  }
}

async function getNewMessages(): Promise<NewMessageEntry[]> {
  const data = await runWechatCLI(['new-messages', '--format', 'json']) as any;
  const msgs = data?.messages ?? data;
  if (!Array.isArray(msgs)) return [];
  return msgs as NewMessageEntry[];
}

async function getChatHistory(chatName: string, limit = 20): Promise<string[]> {
  const data = await runWechatCLI([
    'history', `"${chatName}"`, '--limit', String(limit), '--format', 'json',
  ]);
  return ((data as ChatHistory)?.messages) ?? [];
}

// ─── AI Reply ────────────────────────────────────────────────────────────────

const API_KEY = process.env.ANTHROPIC_API_KEY!;
const API_BASE_URL = (process.env.ANTHROPIC_BASE_URL ?? 'https://openai.api2d.net').replace(/\/$/, '');

const SYSTEM_PROMPT = `你是一位专业、热情的销售顾问助手，帮助销售人员分析微信聊天记录并生成恰当的回复。

你的任务：
1. 分析客户的最新消息和聊天历史，理解客户需求和当前对话阶段
2. 生成一条自然、专业、有温度的回复，适合直接发送到微信

回复要求：
- 语气亲切自然，符合微信聊天风格，避免过于正式
- 内容简洁有针对性，不超过 200 字
- 根据对话阶段（了解需求/产品介绍/促成成交/售后跟进）采用合适的策略
- 如有必要，适当提问以进一步了解客户需求
- 直接给出回复内容，不需要任何解释或前言

只输出回复正文，不要加任何标签或前缀。`;

async function generateReply(entry: NewMessageEntry, history: string[]): Promise<string> {
  const historyText = history.length > 0 ? history.join('\n') : '（暂无历史记录）';
  const userPrompt = `【聊天对象】${entry.chat}
【最近聊天记录】
${historyText}
【最新收到的消息】
${entry.last_message || '（无内容）'}
请根据以上内容，生成一条合适的回复。`;

  const res = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);

  const data = await res.json() as any;
  const text: string = data?.content?.[0]?.text ?? data?.choices?.[0]?.message?.content ?? '';
  return text.trim();
}

// ─── Markdown output ─────────────────────────────────────────────────────────

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, '_');
}

async function writeMarkdown(entry: NewMessageEntry, reply: string, outputDir: string): Promise<string> {
  const now = new Date();
  const filename = `${formatTimestamp(now)}_${sanitizeFilename(entry.chat)}.md`;
  const filepath = path.join(outputDir, filename);

  const yamlLines = Object.entries(entry)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');

  const content = `---\n${yamlLines}\n---\n回复内容：${reply}\n`;
  await fs.writeFile(filepath, content, 'utf-8');
  return filepath;
}

// ─── Poller ──────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;
const processedKeys = new Set<string>();
const OUTGOING_REPLY_PREFIX = 'reply:';

export function buildProcessedKey(entry: Pick<NewMessageEntry, 'username' | 'last_message' | 'timestamp'>): string {
  return `${entry.username}:${entry.timestamp ?? entry.last_message}`;
}

function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function shouldSkipEntry(
  knownProcessedKeys: ReadonlySet<string>,
  entry: Pick<NewMessageEntry, 'username' | 'last_message' | 'timestamp'>,
): boolean {
  if (knownProcessedKeys.has(buildProcessedKey(entry))) {
    return true;
  }

  const normalizedMessage = normalizeMessageText(entry.last_message);
  for (const key of knownProcessedKeys) {
    if (!key.startsWith(`${OUTGOING_REPLY_PREFIX}${entry.username}:`)) {
      continue;
    }

    const rememberedReply = key.slice(
      `${OUTGOING_REPLY_PREFIX}${entry.username}:`.length,
    );
    if (rememberedReply.startsWith(normalizedMessage)) {
      return true;
    }
  }

  return false;
}

export function markOutgoingReplyAsProcessed(
  knownProcessedKeys: Set<string>,
  sourceEntry: Pick<NewMessageEntry, 'username'>,
  reply: string,
): void {
  knownProcessedKeys.add(
    `${OUTGOING_REPLY_PREFIX}${sourceEntry.username}:${normalizeMessageText(reply)}`,
  );
}

async function poll(outputDir: string): Promise<void> {
  console.log(`[${new Date().toLocaleTimeString('zh-CN')}] 检查新消息...`);

  let newMessages: NewMessageEntry[];
  try {
    newMessages = await getNewMessages();
  } catch (err) {
    console.error('获取新消息失败:', err);
    return;
  }

  const privateMessages = newMessages.filter(e => !e.username.endsWith('@chatroom'));

  if (privateMessages.length === 0) {
    console.log('  → 没有新消息');
    return;
  }

  console.log(`  → 发现 ${privateMessages.length} 个私聊有新消息`);

  for (const entry of privateMessages) {
    if (shouldSkipEntry(processedKeys, entry)) {
      console.log(`  跳过：${entry.chat}（已处理）`);
      continue;
    }
    processedKeys.add(buildProcessedKey(entry));
    console.log(`  处理：${entry.chat} — ${entry.last_message}`);

    let history: string[] = [];
    try {
      history = await getChatHistory(entry.chat, 20);
    } catch (err) {
      console.warn(`  获取历史失败，继续:`, err);
    }

    let reply: string;
    try {
      reply = await generateReply(entry, history);
    } catch (err) {
      console.error(`  生成回复失败 [${entry.chat}]:`, err);
      continue;
    }

    try {
      const filepath = await writeMarkdown(entry, reply, outputDir);
      markOutgoingReplyAsProcessed(processedKeys, entry, reply);
      console.log(`  ✓ 已写入：${path.relative(process.cwd(), filepath)}`);
    } catch (err) {
      console.error(`  写入失败:`, err);
    }
  }
}

async function seedProcessedKeys(): Promise<void> {
  console.log('  初始化：标记启动前的未读消息，跳过不处理...');
  try {
    const existing = await getNewMessages();
    const privateOnes = existing.filter(e => !e.username.endsWith('@chatroom'));
    for (const entry of privateOnes) {
      processedKeys.add(buildProcessedKey(entry));
    }
    if (privateOnes.length > 0) {
      console.log(`  已跳过 ${privateOnes.length} 条启动前的未读私信（${privateOnes.map(e => e.chat).join('、')}）`);
    }
  } catch (err) {
    console.warn('  初始化快照失败，继续:', err);
  }
}

export async function startPoller(outputDir: string): Promise<{ stop(): void }> {
  let stopped = false;

  await seedProcessedKeys();

  const run = async () => {
    if (stopped) return;
    await poll(outputDir);
    if (!stopped) setTimeout(run, POLL_INTERVAL_MS);
  };

  void run();
  return { stop() { stopped = true; } };
}
