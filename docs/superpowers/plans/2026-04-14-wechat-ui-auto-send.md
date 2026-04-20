# WeChat UI Auto Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AppleScript-driven WeChat UI auto-send after reply generation while still logging and saving every generated reply.

**Architecture:** Keep monitoring and reply generation in `monitor.ts`, add a small AppleScript file for UI automation, and invoke it through `osascript` with explicit arguments. Failures in UI automation must not stop the polling loop.

**Tech Stack:** Node.js, TypeScript, AppleScript, macOS `osascript`

---

### Task 1: Add a testable AppleScript invocation seam

**Files:**
- Modify: `monitor.ts`

- [ ] **Step 1: Write the failing testable assertion path**

Add a small pure helper in `monitor.ts` for script path resolution and argument packaging, then run TypeScript compilation expecting failures because the helper is not implemented yet.

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && npx tsc --noEmit`
Expected: FAIL referencing missing helper usage after the first wiring pass.

- [ ] **Step 2: Implement minimal helper and wiring**

Create helper functions that:
- resolve the AppleScript file path from the project root
- print the outgoing reply preview
- call `osascript` with `chatName`, `reply`, and mode

- [ ] **Step 3: Run compilation again**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && npx tsc --noEmit`
Expected: PASS

### Task 2: Add AppleScript UI automation

**Files:**
- Create: `scripts/send_wechat_message.applescript`

- [ ] **Step 1: Write the script with argument handling**

Implement AppleScript to:
- accept `chatName`, `messageText`, and `sendMode`
- activate WeChat
- search by `chatName`
- paste `messageText` through clipboard
- press Return only when `sendMode` is `send`

- [ ] **Step 2: Perform a syntax-only validation**

Run: `osascript -s o /Users/imac/Documents/CC-project/WechatCLI/scripts/send_wechat_message.applescript "测试联系人" "测试消息" "paste-only"`
Expected: Script executes far enough to validate syntax; if UI permissions block execution, syntax errors must still be absent.

### Task 3: Integrate into polling flow and keep failures non-fatal

**Files:**
- Modify: `monitor.ts`

- [ ] **Step 1: Wire send after markdown generation**

Update the polling loop so that after `writeMarkdown()` succeeds, the monitor:
- prints a clear preview block with chat name and reply
- calls the AppleScript sender
- logs success or failure without aborting the loop

- [ ] **Step 2: Run compilation and a local dry execution check**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && npx tsc --noEmit`
Expected: PASS

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && ANTHROPIC_API_KEY=dummy node --no-warnings --loader ts-node/esm -e "import('./monitor.ts').catch(err => { console.error(err); process.exit(1); })"`
Expected: Process starts or reaches runtime checks cleanly; no TypeScript/module errors.

### Task 4: Final verification

**Files:**
- Modify: `monitor.ts`
- Create: `scripts/send_wechat_message.applescript`

- [ ] **Step 1: Re-run the final checks**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && npx tsc --noEmit`
Expected: PASS

Run: `osascript -s o /Users/imac/Documents/CC-project/WechatCLI/scripts/send_wechat_message.applescript "测试联系人" "测试消息" "paste-only"`
Expected: No AppleScript syntax errors.

- [ ] **Step 2: Manually confirm system requirements**

Confirm:
- WeChat desktop is installed and logged in
- Terminal or Codex app has Accessibility permission
- User understands that same-name contacts may still need later hardening
