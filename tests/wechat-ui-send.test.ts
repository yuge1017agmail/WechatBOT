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

  assert.deepEqual(calls, ['prepare:照烧鳗鱼', 'deliver:paste-only']);
});
