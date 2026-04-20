# Command Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a double-clickable `.command` launcher that reads local API config, prompts for launch mode, and starts the existing end-to-end WeChat system without requiring manual terminal commands.

**Architecture:** Keep the double-click entrypoint itself as a very small shell script, and move the real launcher behavior into a new `launcher.ts` module. That module will own config parsing, mode selection, error dialogs, and spawning `monitor.ts`, while the shell script only changes into the project directory and invokes `launcher.ts`.

**Tech Stack:** Node.js, TypeScript, Node built-in test runner, macOS `osascript`, zsh shell script

---

## File Structure

### Files To Modify

- Modify: `/Users/imac/Documents/CC-project/WechatCLI/package.json`
  Add a reusable launcher script entry so the `.command` wrapper and manual CLI usage both call the same Node launcher module.

### Files To Create

- Create: `/Users/imac/Documents/CC-project/WechatCLI/launcher.ts`
  Testable launcher runtime for config loading, mode mapping, AppleScript prompting, error dialogs, and spawning `monitor.ts`.
- Create: `/Users/imac/Documents/CC-project/WechatCLI/tests/launcher.test.ts`
  Focused tests for config parsing, mode mapping, and monitor process spec creation.
- Create: `/Users/imac/Documents/CC-project/WechatCLI/Start WeChat AI.command`
  Double-clickable shell entrypoint that switches into the project root and runs the launcher.
- Create: `/Users/imac/Documents/CC-project/WechatCLI/.launcher-config.json`
  Local launcher config file containing the current user-provided API key and base URL.

## Task 1: Add A Testable Launcher Runtime

**Files:**
- Create: `/Users/imac/Documents/CC-project/WechatCLI/launcher.ts`
- Create: `/Users/imac/Documents/CC-project/WechatCLI/tests/launcher.test.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/package.json`

- [ ] **Step 1: Write the failing launcher tests**

Create `/Users/imac/Documents/CC-project/WechatCLI/tests/launcher.test.ts` with:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMonitorProcessSpec,
  parseLauncherConfig,
  resolveLaunchMode,
} from '../launcher.ts';

test('parseLauncherConfig returns validated API config', () => {
  const config = parseLauncherConfig(
    JSON.stringify({
      ANTHROPIC_API_KEY: 'fk-test',
      ANTHROPIC_BASE_URL: 'https://oa.api2d.net',
    }),
  );

  assert.deepEqual(config, {
    ANTHROPIC_API_KEY: 'fk-test',
    ANTHROPIC_BASE_URL: 'https://oa.api2d.net',
  });
});

test('parseLauncherConfig rejects missing API key', () => {
  assert.throws(
    () =>
      parseLauncherConfig(
        JSON.stringify({
          ANTHROPIC_API_KEY: '',
          ANTHROPIC_BASE_URL: 'https://oa.api2d.net',
        }),
      ),
    /ANTHROPIC_API_KEY/,
  );
});

test('resolveLaunchMode maps 自动发送 to send', () => {
  assert.equal(resolveLaunchMode('自动发送'), 'send');
});

test('resolveLaunchMode maps 仅粘贴不发送 to paste-only', () => {
  assert.equal(resolveLaunchMode('仅粘贴不发送'), 'paste-only');
});

test('buildMonitorProcessSpec returns the monitor command and env', () => {
  const spec = buildMonitorProcessSpec('/tmp/wechat-project', {
    ANTHROPIC_API_KEY: 'fk-test',
    ANTHROPIC_BASE_URL: 'https://oa.api2d.net',
  }, 'send');

  assert.equal(spec.command, 'node');
  assert.deepEqual(spec.args, [
    '--no-warnings',
    '--loader',
    'ts-node/esm',
    'monitor.ts',
  ]);
  assert.equal(spec.cwd, '/tmp/wechat-project');
  assert.equal(spec.env.WECHAT_SEND_MODE, 'send');
  assert.equal(spec.env.ANTHROPIC_API_KEY, 'fk-test');
  assert.equal(spec.env.ANTHROPIC_BASE_URL, 'https://oa.api2d.net');
});
```

- [ ] **Step 2: Run the new launcher test to verify it fails**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/launcher.test.ts`

Expected: FAIL because `launcher.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal launcher module and add a package script**

Create `/Users/imac/Documents/CC-project/WechatCLI/launcher.ts` with:

```ts
import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type { WeChatSendMode } from './wechat-ui-send.ts';

const execFileAsync = promisify(execFile);

export interface LauncherConfig {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_BASE_URL: string;
}

export interface MonitorProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function resolveLauncherConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.launcher-config.json');
}

export function parseLauncherConfig(rawText: string): LauncherConfig {
  const parsed = JSON.parse(rawText) as Partial<LauncherConfig>;
  const apiKey = parsed.ANTHROPIC_API_KEY?.trim();
  const baseUrl = parsed.ANTHROPIC_BASE_URL?.trim();

  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY in .launcher-config.json');
  }

  if (!baseUrl) {
    throw new Error('Missing ANTHROPIC_BASE_URL in .launcher-config.json');
  }

  return {
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_BASE_URL: baseUrl,
  };
}

export function resolveLaunchMode(choice: string): WeChatSendMode {
  if (choice === '自动发送') return 'send';
  if (choice === '仅粘贴不发送') return 'paste-only';
  throw new Error(`Unsupported launch mode choice: ${choice}`);
}

export function buildMonitorProcessSpec(
  projectRoot: string,
  config: LauncherConfig,
  sendMode: WeChatSendMode,
): MonitorProcessSpec {
  return {
    command: 'node',
    args: ['--no-warnings', '--loader', 'ts-node/esm', 'monitor.ts'],
    cwd: projectRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY,
      ANTHROPIC_BASE_URL: config.ANTHROPIC_BASE_URL,
      WECHAT_SEND_MODE: sendMode,
    },
  };
}

async function chooseLaunchMode(): Promise<WeChatSendMode | null> {
  const { stdout } = await execFileAsync('osascript', [
    '-e',
    'set userChoice to choose from list {"自动发送", "仅粘贴不发送"} with prompt "选择启动模式" default items {"仅粘贴不发送"} OK button name "启动" cancel button name "取消"',
    '-e',
    'if userChoice is false then return "__CANCEL__"',
    '-e',
    'return item 1 of userChoice',
  ]);

  const choice = String(stdout ?? '').trim();
  if (choice === '__CANCEL__') {
    return null;
  }

  return resolveLaunchMode(choice);
}

async function displayLauncherError(message: string): Promise<void> {
  await execFileAsync('osascript', [
    '-e',
    `display dialog ${JSON.stringify(message)} buttons {"好"} default button "好" with icon stop`,
  ]).catch(() => {});
}

export async function runLauncher(projectRoot = process.cwd()): Promise<void> {
  const configPath = resolveLauncherConfigPath(projectRoot);
  const rawText = await fs.readFile(configPath, 'utf8');
  const config = parseLauncherConfig(rawText);

  const sendMode = await chooseLaunchMode();
  if (sendMode === null) {
    console.log('已取消启动。');
    return;
  }

  const spec = buildMonitorProcessSpec(projectRoot, config, sendMode);
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: 'inherit',
  });

  await new Promise<void>((resolve, reject) => {
    child.once('exit', (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`Launcher child exited with code ${code}`));
      }
    });
    child.once('error', reject);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runLauncher().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    await displayLauncherError(`启动失败：${message}`);
    process.exit(1);
  });
}
```

Update `/Users/imac/Documents/CC-project/WechatCLI/package.json` to:

```json
{
  "name": "wechat-monitor",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test --no-warnings --loader ts-node/esm tests/*.test.ts",
    "start": "node --no-warnings --loader ts-node/esm monitor.ts",
    "dev": "node --no-warnings --loader ts-node/esm monitor.ts",
    "launcher": "node --no-warnings --loader ts-node/esm launcher.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.88.0",
    "openai": "^6.34.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 4: Run the launcher test again**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && node --test --no-warnings --loader ts-node/esm tests/launcher.test.ts`

Expected: PASS

## Task 2: Add The Double-Click Launcher Entry And Local Config

**Files:**
- Create: `/Users/imac/Documents/CC-project/WechatCLI/Start WeChat AI.command`
- Create: `/Users/imac/Documents/CC-project/WechatCLI/.launcher-config.json`

- [ ] **Step 1: Create the `.command` launcher wrapper**

Create `/Users/imac/Documents/CC-project/WechatCLI/Start WeChat AI.command` with:

```zsh
#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "启动失败：未检测到 node，请先安装 Node.js。" buttons {"好"} default button "好" with icon stop'
  echo "启动失败：未检测到 node，请先安装 Node.js。"
  exit 1
fi

exec node --no-warnings --loader ts-node/esm launcher.ts
```

- [ ] **Step 2: Write the local launcher config file**

Create `/Users/imac/Documents/CC-project/WechatCLI/.launcher-config.json` as a valid JSON file with exactly these two fields:

- `ANTHROPIC_API_KEY`: use the real API key the user provided in this session
- `ANTHROPIC_BASE_URL`: `https://oa.api2d.net`

Implementation note:
Because this workspace is local and not a git repo, write the real key into the file during implementation and do not leave a placeholder value behind.

- [ ] **Step 3: Make the launcher executable**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && chmod +x "Start WeChat AI.command"`

Expected: `Start WeChat AI.command` becomes double-clickable in Finder.

- [ ] **Step 4: Run a local shell smoke check**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && ./Start\\ WeChat\\ AI.command`

Expected:

- macOS pops up the launch mode chooser
- selecting either mode starts the existing system
- cancel exits cleanly without starting `monitor.ts`

## Task 3: Verify The Launcher End To End

**Files:**
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/launcher.ts`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/tests/launcher.test.ts`
- Create: `/Users/imac/Documents/CC-project/WechatCLI/Start WeChat AI.command`
- Create: `/Users/imac/Documents/CC-project/WechatCLI/.launcher-config.json`
- Modify: `/Users/imac/Documents/CC-project/WechatCLI/package.json`

- [ ] **Step 1: Run the full automated checks**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && npm test`

Expected: PASS with `tests/output-dispatcher.test.ts`, `tests/poller.test.ts`, `tests/wechat-ui-send.test.ts`, and `tests/launcher.test.ts`

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && npx tsc --noEmit`

Expected: PASS

- [ ] **Step 2: Verify the package launcher entry**

Run: `cd /Users/imac/Documents/CC-project/WechatCLI && npm run launcher`

Expected:

- config file is read successfully
- a launch mode prompt appears
- cancel exits safely

- [ ] **Step 3: Verify the Finder-style entry**

Run: `open "/Users/imac/Documents/CC-project/WechatCLI/Start WeChat AI.command"`

Expected:

- Terminal opens
- launch mode prompt appears
- choosing `仅粘贴不发送` starts the monitor with `WECHAT_SEND_MODE=paste-only`
- choosing `自动发送` starts the monitor with `WECHAT_SEND_MODE=send`

- [ ] **Step 4: Run a guarded end-to-end smoke check through the launcher**

Use the new launcher entry, select `仅粘贴不发送`, then send one safe private WeChat message from a test contact.

Expected:

- the launcher starts the existing system successfully
- the poller generates a markdown task in `output/`
- the dispatcher consumes the task
- WeChat is activated and the generated reply is pasted into the target chat input box
- because the selected mode is `paste-only`, the reply is not auto-sent

- [ ] **Step 5: Repeat the smoke check in auto-send mode**

Use the new launcher entry again, select `自动发送`, then send one safe private WeChat message from a test contact.

Expected:

- the same end-to-end flow runs
- the generated reply is pasted and sent automatically
- the sent reply echo is skipped by the poller rather than causing a reply loop

- [ ] **Step 6: Workspace note**

This workspace is not a git repository, so there is no commit step in this plan. If the project later moves into git, add a final commit after the launcher verification passes.
