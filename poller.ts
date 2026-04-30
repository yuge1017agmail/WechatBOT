import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
  formatKnowledgeResults,
  searchKnowledgeBase,
} from './knowledge-search.ts';

const execFileAsync = promisify(execFile);

const DEFAULT_MODEL_NAME = 'claude-opus-4-6';
const DEFAULT_POLL_INTERVAL_MS = 8_000;
const DEFAULT_MESSAGE_SETTLE_MS = 10_000;
const DEFAULT_HISTORY_LIMIT = 30;
const PERSONA_FILENAME = '人设.md';

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

export interface PendingConversation {
  key: string;
  entry: NewMessageEntry;
  entries: NewMessageEntry[];
  updatedAt: number;
}

export interface PollerRuntimeOptions {
  pollIntervalMs: number;
  messageSettleMs: number;
  historyLimit: number;
}

// ─── WeChat CLI ──────────────────────────────────────────────────────────────

async function runWechatCLI(args: string[]): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync('wechat-cli', args);
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
    'history', chatName, '--limit', String(limit), '--format', 'json',
  ]);
  return parseChatHistoryMessages(data);
}

export function parseChatHistoryMessages(data: unknown): string[] {
  const messages = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as ChatHistory).messages)
      ? (data as ChatHistory).messages
      : [];

  return messages
    .map((message) => {
      if (typeof message === 'string') {
        return message.trim();
      }

      if (typeof message === 'object' && message !== null) {
        const record = message as Record<string, unknown>;
        const sender = typeof record.sender === 'string' ? record.sender : '';
        const content =
          typeof record.content === 'string'
            ? record.content
            : typeof record.message === 'string'
              ? record.message
              : typeof record.text === 'string'
                ? record.text
                : '';
        return [sender, content].filter(Boolean).join('：').trim();
      }

      return '';
    })
    .filter(Boolean);
}

// ─── AI Reply ────────────────────────────────────────────────────────────────

const API_KEY = process.env.ANTHROPIC_API_KEY!;
const API_BASE_URL = (process.env.ANTHROPIC_BASE_URL ?? 'https://openai.api2d.net').replace(/\/$/, '');
const MODEL_NAME = process.env.MODEL_NAME?.trim() || DEFAULT_MODEL_NAME;
const CHAT_COMPLETIONS_URL = resolveChatCompletionsUrl(API_BASE_URL);

export function resolveChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  const url = new URL(trimmed);
  const pathname = url.pathname.replace(/\/+$/, '');

  if (pathname.endsWith('/chat/completions')) {
    return url.toString().replace(/\/+$/, '');
  }

  if (url.hostname === 'api.deepseek.com') {
    const openAiPath = pathname.replace(/\/anthropic$/i, '');
    return `${url.origin}${openAiPath}/chat/completions`;
  }

  if (pathname.endsWith('/v1')) {
    return `${trimmed}/chat/completions`;
  }

  return `${trimmed}/v1/chat/completions`;
}

const BASE_SYSTEM_PROMPT = `你是一位专业、热情的销售顾问助手，帮助销售人员分析微信聊天记录并生成恰当的回复。

你的任务：
1. 分析客户的最新消息和聊天历史，理解客户需求和当前对话阶段
2. 结合知识库资料生成一条自然、专业、有温度的回复，适合直接发送到微信

回复要求：
- 语气亲切自然，符合微信聊天风格，避免过于正式
- 内容简洁有针对性，不超过 200 字
- 根据对话阶段（了解需求/产品介绍/促成成交/售后跟进）采用合适的策略
- 如有必要，适当提问以进一步了解客户需求
- 专业问题优先依据知识库资料回答；如果知识库没有相关信息，不要编造细节，应该自然说明“我确认下再回你”
- 不要编造价格、库存、材质、优惠、交期、售后政策等事实
- 直接给出回复内容，不需要任何解释或前言

只输出回复正文，不要加任何标签或前缀。`;

export function resolvePersonaPath(projectRoot = process.cwd()): string {
  return path.join(projectRoot, PERSONA_FILENAME);
}

export async function readPersonaPrompt(
  personaPath = resolvePersonaPath(),
): Promise<string> {
  try {
    return (await fs.readFile(personaPath, 'utf8')).trim();
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

export function buildSystemPrompt(personaPrompt: string): string {
  const trimmedPersona = personaPrompt.trim();

  if (!trimmedPersona) {
    return BASE_SYSTEM_PROMPT;
  }

  return `${BASE_SYSTEM_PROMPT}

以下是用户指定的人设和表达风格，请优先遵循：

${trimmedPersona}`;
}

async function generateReply(entry: NewMessageEntry, history: string[]): Promise<string> {
  const historyText = history.length > 0 ? history.join('\n') : '（暂无历史记录）';
  const personaPrompt = await readPersonaPrompt();
  const knowledgeResults = await searchKnowledgeBase(
    [
      entry.chat,
      entry.last_message,
      history.slice(-8).join('\n'),
    ].join('\n'),
  );
  const knowledgeText = formatKnowledgeResults(knowledgeResults);

  if (knowledgeResults.length > 0) {
    const sources = [...new Set(knowledgeResults.map((result) => result.relativePath))];
    console.log(`  知识库命中：${sources.join('、')}`);
  } else {
    console.log('  知识库未命中相关资料');
  }

  const userPrompt = `【聊天对象】${entry.chat}
【最近聊天记录】
${historyText}
【最新收到的消息】
${entry.last_message || '（无内容）'}
【检索到的知识库资料】
${knowledgeText}
请根据以上内容，生成一条合适的回复。若知识库没有相关资料，不要编造专业细节，可以自然地说我确认下再回你。`;

  const res = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: buildSystemPrompt(personaPrompt) },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `API ${res.status} at ${CHAT_COMPLETIONS_URL} (model: ${MODEL_NAME}): ${detail}`,
    );
  }

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

const processedKeys = new Set<string>();
const OUTGOING_REPLY_PREFIX = 'reply:';
const IGNORED_SERVICE_USERNAMES = new Set([
  'brandservicesessionholder',
  'brandsessionholder',
  'notifymessage',
  'mphelper',
]);
const IGNORED_SERVICE_CHAT_NAMES = new Set([
  '服务号',
  '订阅号',
]);

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolvePollerRuntimeOptions(
  env: NodeJS.ProcessEnv = process.env,
): PollerRuntimeOptions {
  return {
    pollIntervalMs: parsePositiveInteger(env.POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS),
    messageSettleMs: parsePositiveInteger(env.MESSAGE_SETTLE_MS, DEFAULT_MESSAGE_SETTLE_MS),
    historyLimit: parsePositiveInteger(env.HISTORY_LIMIT, DEFAULT_HISTORY_LIMIT),
  };
}

export function buildProcessedKey(entry: Pick<NewMessageEntry, 'username' | 'last_message' | 'timestamp'>): string {
  return `${entry.username}:${entry.timestamp ?? entry.last_message}`;
}

function normalizeIdentifier(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function isReplyCandidate(entry: Pick<NewMessageEntry, 'username' | 'chat' | 'is_group'>): boolean {
  if (entry.is_group || entry.username?.endsWith('@chatroom')) {
    return false;
  }

  const username = normalizeIdentifier(entry.username);
  const chat = (entry.chat ?? '').trim();

  if (!username) {
    return false;
  }

  if (IGNORED_SERVICE_USERNAMES.has(username)) {
    return false;
  }

  if (username.startsWith('gh_')) {
    return false;
  }

  if (username.includes('brandservice')) {
    return false;
  }

  if (IGNORED_SERVICE_CHAT_NAMES.has(chat)) {
    return false;
  }

  return true;
}

function buildConversationKey(entry: Pick<NewMessageEntry, 'username' | 'chat'>): string {
  return entry.username || entry.chat;
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

function mergeLastMessages(entries: NewMessageEntry[]): string {
  const merged = entries
    .map((entry) => normalizeMessageText(entry.last_message))
    .filter(Boolean)
    .filter((message, index, all) => all.indexOf(message) === index);

  return merged.join('\n');
}

export function mergePendingConversation(
  existing: PendingConversation | undefined,
  entry: NewMessageEntry,
  now: number,
): PendingConversation {
  const entries = [...(existing?.entries ?? []), entry];
  return {
    key: buildConversationKey(entry),
    entry: {
      ...entry,
      last_message: mergeLastMessages(entries) || entry.last_message,
    },
    entries,
    updatedAt: now,
  };
}

export function findReadyConversation(
  pending: Iterable<PendingConversation>,
  now: number,
  messageSettleMs: number,
): PendingConversation | null {
  for (const conversation of pending) {
    if (now - conversation.updatedAt >= messageSettleMs) {
      return conversation;
    }
  }

  return null;
}

function getNextReadyDelay(
  pending: Iterable<PendingConversation>,
  now: number,
  messageSettleMs: number,
): number | null {
  let delay: number | null = null;

  for (const conversation of pending) {
    const remaining = Math.max(0, messageSettleMs - (now - conversation.updatedAt));
    delay = delay === null ? remaining : Math.min(delay, remaining);
  }

  return delay;
}

async function processConversation(
  conversation: PendingConversation,
  outputDir: string,
  runtimeOptions: PollerRuntimeOptions,
): Promise<void> {
  const entry = conversation.entry;
  console.log(
    `  处理：${entry.chat} — 已合并 ${conversation.entries.length} 条新消息`,
  );

  let history: string[] = [];
  try {
    history = await getChatHistory(entry.chat, runtimeOptions.historyLimit);
  } catch (err) {
    console.warn(`  获取历史失败，继续:`, err);
  }

  let reply: string;
  try {
    reply = await generateReply(entry, history);
  } catch (err) {
    console.error(`  生成回复失败 [${entry.chat}]:`, err);
    return;
  }

  try {
    const filepath = await writeMarkdown(entry, reply, outputDir);
    markOutgoingReplyAsProcessed(processedKeys, entry, reply);
    console.log(`  ✓ 已写入：${path.relative(process.cwd(), filepath)}`);
  } catch (err) {
    console.error(`  写入失败:`, err);
  }
}

async function seedProcessedKeys(): Promise<void> {
  console.log('  初始化：标记启动前的未读消息，跳过不处理...');
  try {
    const existing = await getNewMessages();
    const privateOnes = existing.filter(isReplyCandidate);
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
  let processing = false;
  let pollTimer: NodeJS.Timeout | null = null;
  let readyTimer: NodeJS.Timeout | null = null;
  const pendingConversations = new Map<string, PendingConversation>();
  const runtimeOptions = resolvePollerRuntimeOptions();

  await seedProcessedKeys();

  const scheduleReadyCheck = () => {
    if (stopped || processing) {
      return;
    }

    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }

    const delay = getNextReadyDelay(
      pendingConversations.values(),
      Date.now(),
      runtimeOptions.messageSettleMs,
    );

    if (delay === null) {
      return;
    }

    readyTimer = setTimeout(() => {
      readyTimer = null;
      void processNextReadyConversation();
    }, delay);
  };

  const processNextReadyConversation = async () => {
    if (stopped || processing) {
      return;
    }

    const ready = findReadyConversation(
      pendingConversations.values(),
      Date.now(),
      runtimeOptions.messageSettleMs,
    );

    if (!ready) {
      scheduleReadyCheck();
      return;
    }

    pendingConversations.delete(ready.key);
    processing = true;
    try {
      await processConversation(ready, outputDir, runtimeOptions);
    } finally {
      processing = false;
      scheduleReadyCheck();
    }
  };

  const poll = async () => {
    console.log(`[${new Date().toLocaleTimeString('zh-CN')}] 检查新消息...`);

    let newMessages: NewMessageEntry[];
    try {
      newMessages = await getNewMessages();
    } catch (err) {
      console.error('获取新消息失败:', err);
      return;
    }

    const privateMessages = newMessages.filter(isReplyCandidate);
    const ignoredMessages = newMessages.length - privateMessages.length;

    if (privateMessages.length === 0) {
      console.log(
        ignoredMessages > 0
          ? `  → 没有需要回复的新私聊（已忽略 ${ignoredMessages} 条群聊/服务号消息）`
          : '  → 没有新消息',
      );
      return;
    }

    console.log(
      `  → 发现 ${privateMessages.length} 个私聊有新消息` +
        (ignoredMessages > 0 ? `，已忽略 ${ignoredMessages} 条群聊/服务号消息` : ''),
    );

    for (const entry of privateMessages) {
      if (shouldSkipEntry(processedKeys, entry)) {
        console.log(`  跳过：${entry.chat}（已处理）`);
        continue;
      }

      processedKeys.add(buildProcessedKey(entry));
      const key = buildConversationKey(entry);
      pendingConversations.set(
        key,
        mergePendingConversation(pendingConversations.get(key), entry, Date.now()),
      );
      console.log(`  已加入待回复队列：${entry.chat} — ${entry.last_message}`);
    }

    scheduleReadyCheck();
  };

  const run = async () => {
    if (stopped) return;
    await poll();
    if (!stopped) {
      pollTimer = setTimeout(run, runtimeOptions.pollIntervalMs);
    }
  };

  void run();
  return {
    stop() {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
      if (readyTimer) {
        clearTimeout(readyTimer);
      }
    },
  };
}
