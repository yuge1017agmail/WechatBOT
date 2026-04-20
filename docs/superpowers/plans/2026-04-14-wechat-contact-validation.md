# WeChat Contact Validation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent WeChat UI auto-send from sending into the wrong chat by validating the opened conversation against the current message metadata before any paste or send action.

**Architecture:** Keep `monitor.ts` as the source of truth for the current message entry and generated reply, extend `wechat-ui-send.ts` to accept a structured validation context, and upgrade the AppleScript to validate the visible WeChat conversation before sending. Validation failure must stop sending immediately and return a clear error without fallback.

**Tech Stack:** Node.js, TypeScript, AppleScript, macOS `osascript`, Node built-in test runner

---

### Task 1: Define structured validation context and test the AppleScript argument seam

**Files:**
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/wechat-ui-send.test.ts`

- [ ] **Step 1: Write the failing test for structured send context**

Update `/Users/imac/Documents/CC-project/WechatCLI/tests/wechat-ui-send.test.ts` so `sendViaWeChat(...)` is called with a structured context object instead of raw `chatName`, and assert that the generated `osascript` arguments include:
- `chat`
- `reply`
- `sendMode`
- `last_message`
- `is_group`
- `sender`

Add this new failing test:

```ts
test('sendViaWeChat passes validation context to AppleScript in a stable order', async () => {
  const calls: string[][] = [];

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
      projectRoot: '/tmp/wechat-project',
      sendMode: 'send',
      runAppleScript: async (args) => {
        calls.push(args);
      },
    },
  );

  assert.deepEqual(calls, [[
    '-s',
    'o',
    '/tmp/wechat-project/scripts/send_wechat_message.applescript',
    '照烧鳗鱼',
    '有的呀，我们这边有多款沙发可选。',
    'send',
    '你们有沙发卖吗',
    'false',
    '',
  ]]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npm test
```

Expected: FAIL because `sendViaWeChat(...)` and `buildOsaScriptArgs(...)` do not yet accept the structured validation context.

- [ ] **Step 3: Implement the minimal TypeScript changes**

In `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`:
- add a `WeChatMessageContext` type with `chat`, `username`, `is_group`, `last_message`, and optional `sender`
- update `buildOsaScriptArgs(...)` to append validation arguments in this exact order:

```ts
[
  '-s',
  'o',
  scriptPath,
  context.chat,
  reply,
  sendMode,
  context.last_message,
  String(context.is_group),
  context.sender ?? '',
]
```

- update `sendViaWeChat(...)` to accept `(context, reply, options)` and forward the context to `buildOsaScriptArgs(...)`

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npm test
```

Expected: PASS with the new validation-context test green.

### Task 2: Upgrade AppleScript to validate the opened conversation before sending

**Files:**
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/scripts/send_wechat_message.applescript`

- [ ] **Step 1: Write the failing AppleScript contract expectation**

Document the new AppleScript argument contract in comments at the top of `/Users/imac/Documents/CC-project/WechatCLI/scripts/send_wechat_message.applescript`:

```applescript
-- argv:
-- 1 chatName
-- 2 messageText
-- 3 sendMode
-- 4 lastMessage
-- 5 isGroup ("true"/"false")
-- 6 sender
```

Then compile-check after referencing the new args to confirm the current script is incomplete.

- [ ] **Step 2: Run compile validation to see the contract is not yet fully implemented**

Run:

```bash
osacompile -o /tmp/send_wechat_message.scpt /Users/imac/Documents/CC-project/WechatCLI/scripts/send_wechat_message.applescript
```

Expected: PASS or FAIL is acceptable at this step; the key is that the script is the next thing being changed after the TypeScript seam.

- [ ] **Step 3: Implement the minimal validation logic**

Update `/Users/imac/Documents/CC-project/WechatCLI/scripts/send_wechat_message.applescript` so it:
- reads `lastMessage`, `isGroup`, and `sender` from `argv`
- opens WeChat and searches by `chatName`
- captures visible UI text from the front WeChat window
- validates:
  - visible text contains `chatName`
  - visible text contains `lastMessage`
  - if `isGroup` is `"true"` and `sender` is not empty, visible text contains `sender`
- raises an AppleScript error when any check fails
- only after validation pastes `messageText`
- only presses Return when `sendMode` is `"send"`

Use this helper pattern inside the script:

```applescript
set windowText to (entire contents of front window) as string

if windowText does not contain chatName then error "会话标题校验失败: " & chatName
if windowText does not contain lastMessage then error "最近消息校验失败: " & lastMessage
if isGroup is "true" and sender is not "" then
  if windowText does not contain sender then error "群聊发送人校验失败: " & sender
end if
```

- [ ] **Step 4: Run AppleScript compile validation**

Run:

```bash
osacompile -o /tmp/send_wechat_message.scpt /Users/imac/Documents/CC-project/WechatCLI/scripts/send_wechat_message.applescript
```

Expected: PASS

### Task 3: Pass the current message context from the monitor into the send layer

**Files:**
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/monitor.ts`

- [ ] **Step 1: Write the failing integration update**

Update the send call site in `/Users/imac/Documents/CC-project/WechatCLI/monitor.ts` from:

```ts
await sendViaWeChat(entry.chat, reply, { sendMode: WECHAT_SEND_MODE });
```

to the desired call shape:

```ts
await sendViaWeChat(entry, reply, { sendMode: WECHAT_SEND_MODE });
```

Run compilation before implementing the helper type changes so TypeScript fails on the mismatched signature.

- [ ] **Step 2: Run TypeScript compilation to verify it fails**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npx tsc --noEmit
```

Expected: FAIL because `sendViaWeChat(...)` still expects the old signature before Task 1 implementation lands.

- [ ] **Step 3: Implement the minimal monitor integration**

Keep `writeMarkdown(...)` and the front matter output as-is, and update only the send call plus any type imports needed so the current `entry` object becomes the validation context for sending.

- [ ] **Step 4: Run compilation to verify it passes**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npx tsc --noEmit
```

Expected: PASS

### Task 4: Verify end-to-end safety behavior

**Files:**
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/wechat-ui-send.test.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/scripts/send_wechat_message.applescript`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/monitor.ts`

- [ ] **Step 1: Run the automated checks**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npm test
```

Expected: PASS

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npx tsc --noEmit
```

Expected: PASS

Run:

```bash
osacompile -o /tmp/send_wechat_message.scpt /Users/imac/Documents/CC-project/WechatCLI/scripts/send_wechat_message.applescript
```

Expected: PASS

- [ ] **Step 2: Run a guarded manual UI test**

Run a real send attempt against a safe chat such as `文件传输助手` using a known context object whose `last_message` matches the current visible conversation.

Expected:
- when the visible conversation matches the context, send succeeds
- when the visible conversation does not match, the script aborts before pasting or sending

- [ ] **Step 3: Confirm safety logging**

Verify the monitor prints a clear error message when validation fails, and a success message only after the AppleScript call returns successfully.
