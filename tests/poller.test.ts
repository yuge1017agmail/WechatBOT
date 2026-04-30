import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildProcessedKey,
  buildSystemPrompt,
  findReadyConversation,
  isReplyCandidate,
  markOutgoingReplyAsProcessed,
  mergePendingConversation,
  parseChatHistoryMessages,
  readPersonaPrompt,
  resolveChatCompletionsUrl,
  resolvePersonaPath,
  resolvePollerRuntimeOptions,
  shouldSkipEntry,
  type NewMessageEntry,
} from '../poller.ts';

test('buildProcessedKey prefers timestamp when present', () => {
  const entry: NewMessageEntry = {
    chat: '照烧鳗鱼',
    username: 'wxid_demo',
    is_group: false,
    last_message: '你好，在吗',
    timestamp: 1776392127,
  };

  assert.equal(buildProcessedKey(entry), 'wxid_demo:1776392127');
});

test('isReplyCandidate ignores groups and service account messages', () => {
  assert.equal(
    isReplyCandidate({
      chat: '客户A',
      username: 'wxid_demo',
      is_group: false,
    }),
    true,
  );
  assert.equal(
    isReplyCandidate({
      chat: '客户群',
      username: '123@chatroom',
      is_group: true,
    }),
    false,
  );
  assert.equal(
    isReplyCandidate({
      chat: '服务号',
      username: 'brandservicesessionholder',
      is_group: false,
    }),
    false,
  );
  assert.equal(
    isReplyCandidate({
      chat: '元空AI',
      username: 'gh_fd5c77640abc',
      is_group: false,
    }),
    false,
  );
});

test('resolveChatCompletionsUrl keeps generic OpenAI-compatible defaults', () => {
  assert.equal(
    resolveChatCompletionsUrl('https://example.com'),
    'https://example.com/v1/chat/completions',
  );
  assert.equal(
    resolveChatCompletionsUrl('https://example.com/v1'),
    'https://example.com/v1/chat/completions',
  );
});

test('resolveChatCompletionsUrl maps DeepSeek OpenAI and Anthropic base URLs', () => {
  assert.equal(
    resolveChatCompletionsUrl('https://api.deepseek.com'),
    'https://api.deepseek.com/chat/completions',
  );
  assert.equal(
    resolveChatCompletionsUrl('https://api.deepseek.com/anthropic'),
    'https://api.deepseek.com/chat/completions',
  );
});

test('resolvePollerRuntimeOptions reads startup timing settings', () => {
  assert.deepEqual(
    resolvePollerRuntimeOptions({
      POLL_INTERVAL_MS: '5000',
      MESSAGE_SETTLE_MS: '8000',
      HISTORY_LIMIT: '30',
    }),
    {
      pollIntervalMs: 5_000,
      messageSettleMs: 8_000,
      historyLimit: 30,
    },
  );
});

test('parseChatHistoryMessages supports object and array roots', () => {
  assert.deepEqual(
    parseChatHistoryMessages({
      messages: ['客户：第一句', '客户：第二句'],
    }),
    ['客户：第一句', '客户：第二句'],
  );
  assert.deepEqual(
    parseChatHistoryMessages([
      { sender: '客户', content: '第一句' },
      { sender: '销售', text: '回复' },
    ]),
    ['客户：第一句', '销售：回复'],
  );
});

test('resolvePersonaPath points to root persona file', () => {
  assert.equal(
    resolvePersonaPath('/tmp/wechat-project'),
    '/tmp/wechat-project/人设.md',
  );
});

test('readPersonaPrompt returns empty text when persona file is missing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-persona-'));

  assert.equal(await readPersonaPrompt(path.join(root, 'missing.md')), '');
});

test('buildSystemPrompt includes persona instructions when present', () => {
  const prompt = buildSystemPrompt('语气要像微信真人短消息。');

  assert.match(prompt, /销售顾问助手/);
  assert.match(prompt, /语气要像微信真人短消息。/);
});

test('mergePendingConversation combines rapid messages from the same user', () => {
  const first: NewMessageEntry = {
    chat: '张三',
    username: 'wxid_demo',
    is_group: false,
    last_message: '第一句',
    timestamp: 1,
  };
  const second: NewMessageEntry = {
    chat: '张三',
    username: 'wxid_demo',
    is_group: false,
    last_message: '第二句',
    timestamp: 2,
  };

  const pending = mergePendingConversation(
    mergePendingConversation(undefined, first, 1_000),
    second,
    2_000,
  );

  assert.equal(pending.key, 'wxid_demo');
  assert.equal(pending.entry.last_message, '第一句\n第二句');
  assert.equal(pending.entries.length, 2);
  assert.equal(pending.updatedAt, 2_000);
});

test('findReadyConversation waits for the settle window', () => {
  const pending = mergePendingConversation(
    undefined,
    {
      chat: '张三',
      username: 'wxid_demo',
      is_group: false,
      last_message: '第一句',
    },
    1_000,
  );

  assert.equal(findReadyConversation([pending], 10_000, 10_000), null);
  assert.equal(findReadyConversation([pending], 11_000, 10_000), pending);
});

test('markOutgoingReplyAsProcessed prevents the poller from reprocessing its own sent reply', () => {
  const processedKeys = new Set<string>();
  const sourceEntry: NewMessageEntry = {
    chat: '照烧鳗鱼',
    username: 'wxid_demo',
    is_group: false,
    last_message: '你好，在吗',
    timestamp: 1776392127,
  };

  markOutgoingReplyAsProcessed(processedKeys, sourceEntry, '在的在的，我在。');

  const echoedReplyEntry: NewMessageEntry = {
    chat: '照烧鳗鱼',
    username: 'wxid_demo',
    is_group: false,
    last_message: '在的在的，我在。',
  };

  assert.equal(shouldSkipEntry(processedKeys, echoedReplyEntry), true);
});

test('markOutgoingReplyAsProcessed skips a timestamped truncated echo of the sent reply', () => {
  const processedKeys = new Set<string>();
  const sourceEntry: NewMessageEntry = {
    chat: '照烧鳗鱼',
    username: 'wxid_demo',
    is_group: false,
    last_message: '花瓣沙发有吗？多少钱',
    timestamp: 1776392409,
  };

  markOutgoingReplyAsProcessed(
    processedKeys,
    sourceEntry,
    [
      '有的呢！花瓣沙发我们这边现货有几个款，价格要看你选的尺寸和面料哈～',
      '',
      '常规款布艺的话大概在几千到小几万不等，皮质的会贵一些。你方便告诉我：',
      '1. 是单人的还是多人位的？',
    ].join('\n'),
  );

  const echoedReplyEntry: NewMessageEntry = {
    chat: '照烧鳗鱼',
    username: 'wxid_demo',
    is_group: false,
    last_message: '有的呢！花瓣沙发我们这边现货有几个款，价格要看你选的尺寸和面料哈～\n\n常规款布艺的话大概在几千到小几万不等，皮质的会贵一些。你方便告诉我',
    timestamp: 1776392434,
  };

  assert.equal(shouldSkipEntry(processedKeys, echoedReplyEntry), true);
});

test('markOutgoingReplyAsProcessed does not block a different follow-up message', () => {
  const processedKeys = new Set<string>();
  const sourceEntry: NewMessageEntry = {
    chat: '照烧鳗鱼',
    username: 'wxid_demo',
    is_group: false,
    last_message: '你好，在吗',
    timestamp: 1776392127,
  };

  markOutgoingReplyAsProcessed(processedKeys, sourceEntry, '在的在的，我在。');

  const followUpEntry: NewMessageEntry = {
    chat: '照烧鳗鱼',
    username: 'wxid_demo',
    is_group: false,
    last_message: '好的，那我晚点发尺寸给你',
  };

  assert.equal(shouldSkipEntry(processedKeys, followUpEntry), false);
});
