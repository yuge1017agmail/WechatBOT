import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';

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

test('deliver script focuses and verifies the WeChat input before reporting success', async () => {
  const script = await fs.readFile(resolveDeliverScriptPath(process.cwd()), 'utf8');

  assert.match(script, /focusInputAreaByKeyboard/);
  assert.match(script, /verifyFocusBySentinel/);
  assert.match(script, /__WCBOT_SENTINEL_/);
  assert.match(script, /key code 51/);
  assert.match(script, /焦点校验失败/);
});

test('prepare script opens search with keyboard and clears search state', async () => {
  const script = await fs.readFile(resolvePrepareScriptPath(process.cwd()), 'utf8');

  assert.match(script, /ensureWeChatFrontmost/);
  assert.match(script, /keystroke "f" using command down/);
  assert.match(script, /key code 36/);
  assert.match(script, /key code 53/);
  assert.match(script, /OCR 校验/);
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
      validateConversation: async () => {
        calls.push('validate');
        return calls.filter((call) => call === 'validate').length === 1
          ? { ok: false, recognizedText: '' }
          : { ok: true, recognizedText: '照烧鳗鱼' };
      },
      deliverWeChatMessage: async (_reply, sendMode) => {
        calls.push(`deliver:${sendMode}`);
      },
    },
  );

  assert.deepEqual(calls, [
    'validate',
    'prepare:照烧鳗鱼',
    'validate',
    'deliver:paste-only',
  ]);
});

test('sendViaWeChat skips prepare when OCR already sees the target chat', async () => {
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
      validateConversation: async () => {
        calls.push('validate');
        return { ok: true, recognizedText: '照烧鳗鱼' };
      },
      deliverWeChatMessage: async (_reply, sendMode) => {
        calls.push(`deliver:${sendMode}`);
      },
    },
  );

  assert.deepEqual(calls, ['validate', 'deliver:paste-only']);
});
