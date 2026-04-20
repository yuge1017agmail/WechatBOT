# WeChat OCR Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the failed Accessibility-text validation with screenshot OCR validation so WeChat auto-send verifies the target chat before pasting or sending.

**Architecture:** Split WeChat UI work into two AppleScript phases: one script opens the candidate chat and another script pastes/sends only after Node validates OCR output from a local Vision-based helper. `wechat-ui-send.ts` becomes the orchestration layer for prepare → screenshot → OCR → validate → deliver.

**Tech Stack:** Node.js, TypeScript, AppleScript, Objective-C, macOS `Vision.framework`, `screencapture`, Node built-in test runner

---

### Task 1: Add OCR helper and lock its text-output contract

**Files:**
- Create: `/Users/imac/Documents/CC-project/WechatCLI/scripts/wechat_ocr.m`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/wechat-ui-send.test.ts`

- [ ] **Step 1: Write the failing helper-path test**

Add a new failing test that asserts the OCR helper path resolves inside `scripts/`:

```ts
test('resolveOcrSourcePath points to the Objective-C OCR helper source', () => {
  assert.equal(
    resolveOcrSourcePath('/tmp/wechat-project'),
    '/tmp/wechat-project/scripts/wechat_ocr.m',
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npm test
```

Expected: FAIL because `resolveOcrSourcePath(...)` does not exist yet.

- [ ] **Step 3: Implement the OCR helper source and path resolver**

Create `/Users/imac/Documents/CC-project/WechatCLI/scripts/wechat_ocr.m` with a minimal Objective-C CLI that:
- accepts one image path argument
- runs `VNRecognizeTextRequest`
- prints one recognized line per line

Add `resolveOcrSourcePath(projectRoot)` to `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts` so the test seam can import it directly.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npm test
```

Expected: PASS

### Task 2: Refactor send orchestration around prepare / OCR / deliver

**Files:**
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/wechat-ui-send.test.ts`
- Create: `/Users/imac/Documents/CC-project/WechatCLI/scripts/prepare_wechat_chat.applescript`
- Create: `/Users/imac/Documents/CC-project/WechatCLI/scripts/deliver_wechat_message.applescript`

- [ ] **Step 1: Write the failing orchestration test**

Add a test that verifies `sendViaWeChat(...)` executes three phases in order:

1. prepare script
2. OCR validation command
3. deliver script

Use injected fakes and assert a call trace like:

```ts
[
  'prepare:照烧鳗鱼',
  'ocr:/tmp/wechat-shot.png',
  'deliver:send',
]
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npm test
```

Expected: FAIL because `sendViaWeChat(...)` still directly invokes the old single AppleScript path.

- [ ] **Step 3: Implement the minimal orchestration**

In `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`:
- replace the single-script flow with:
  - `prepareWeChatChat(context.chat)`
  - `captureScreen()` returning a temp PNG path
  - `runOcr(imagePath)` returning recognized text
  - `validateRecognizedText(context, recognizedText)`
  - `deliverWeChatMessage(reply, sendMode)`
- keep `buildReplyPreview(...)`
- compile the OCR helper lazily on first use, for example to `/tmp/wechat_ocr`
- delete temp screenshots after OCR

Create `/Users/imac/Documents/CC-project/WechatCLI/scripts/prepare_wechat_chat.applescript` to:
- activate WeChat
- search by chat name
- enter the candidate chat

Create `/Users/imac/Documents/CC-project/WechatCLI/scripts/deliver_wechat_message.applescript` to:
- write reply text to clipboard
- paste into the active input box
- press Return only when mode is `send`

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npm test
```

Expected: PASS

### Task 3: Add OCR-based validation rules

**Files:**
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/wechat-ui-send.test.ts`

- [ ] **Step 1: Write the failing validation tests**

Add tests for:
- private chat passes when OCR text contains `chat` and `last_message`
- private chat fails when OCR text misses `last_message`
- group chat fails when OCR text misses `sender`

Use minimal examples like:

```ts
assert.doesNotThrow(() =>
  validateRecognizedText(
    {
      chat: '文件传输助手',
      username: 'filehelper',
      is_group: false,
      last_message: '你们有沙发卖吗',
      sender: '',
    },
    '文件传输助手 你们有沙发卖吗',
  ),
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npm test
```

Expected: FAIL because OCR validation logic does not exist yet.

- [ ] **Step 3: Implement the minimal validation logic**

In `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`, add `validateRecognizedText(context, recognizedText)` that:
- throws when `recognizedText` does not contain `context.chat`
- throws when `recognizedText` does not contain `context.last_message`
- throws when `context.is_group === true` and `context.sender` is non-empty but missing from `recognizedText`

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd /Users/imac/Documents/CC-project/WechatCLI && npm test
```

Expected: PASS

### Task 4: End-to-end OCR verification

**Files:**
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/wechat-ui-send.ts`
- Create: `/Users/imac/Documents/CC-project/WechatCLI/scripts/prepare_wechat_chat.applescript`
- Create: `/Users/imac/Documents/CC-project/WechatCLI/scripts/deliver_wechat_message.applescript`
- Create: `/Users/imac/Documents/CC-project/WechatCLI/scripts/wechat_ocr.m`

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
clang -fobjc-arc -framework Foundation -framework Vision -framework ImageIO -framework CoreGraphics /Users/imac/Documents/CC-project/WechatCLI/scripts/wechat_ocr.m -o /tmp/wechat_ocr
```

Expected: PASS

- [ ] **Step 2: Run a negative guarded manual test**

Open `文件传输助手`, then invoke the new OCR validation flow with an intentionally wrong `last_message`.

Expected:
- candidate chat opens
- screenshot OCR runs
- validation fails before delivery
- no message is pasted or sent

- [ ] **Step 3: Run a positive guarded manual test**

Invoke the new OCR validation flow against `文件传输助手` with a real visible `last_message` from `wechat-cli history`.

Expected:
- candidate chat opens
- OCR output contains the target chat and message
- validation passes
- reply is pasted and sent
- `wechat-cli search` or `history` can find the sent marker text
