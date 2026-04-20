import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProcessedKey,
  markOutgoingReplyAsProcessed,
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
