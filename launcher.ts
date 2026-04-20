import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type { WeChatSendMode } from './wechat-ui-send.ts';

const execFileAsync = promisify(execFile);
const ACCESSIBILITY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

type RunOsascriptFn = (script: string) => Promise<string>;
type OpenExternalFn = (target: string) => Promise<void>;
type AccessibilityPermissionStatus = 'granted' | 'denied';
type AccessibilityPromptResult = 'continue' | 'cancel';

export interface LauncherConfig {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_BASE_URL: string;
}

export interface MonitorProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  env: {
    ANTHROPIC_API_KEY: string;
    ANTHROPIC_BASE_URL: string;
    WECHAT_SEND_MODE: WeChatSendMode;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseLauncherConfig(rawText: string): LauncherConfig {
  const parsed: unknown = JSON.parse(rawText);

  if (!isRecord(parsed)) {
    throw new Error('Launcher config must be a JSON object.');
  }

  const anthropicApiKey = parsed.ANTHROPIC_API_KEY;
  const anthropicBaseUrl = parsed.ANTHROPIC_BASE_URL;

  if (typeof anthropicApiKey !== 'string' || anthropicApiKey.trim() === '') {
    throw new Error('Launcher config is missing API key (ANTHROPIC_API_KEY).');
  }

  if (
    typeof anthropicBaseUrl !== 'string' ||
    anthropicBaseUrl.trim() === ''
  ) {
    throw new Error('Launcher config is missing ANTHROPIC_BASE_URL.');
  }

  return {
    ANTHROPIC_API_KEY: anthropicApiKey,
    ANTHROPIC_BASE_URL: anthropicBaseUrl,
  };
}

export function resolveLaunchMode(choice: string): WeChatSendMode {
  if (choice === '自动发送') {
    return 'send';
  }

  if (choice === '仅粘贴不发送') {
    return 'paste-only';
  }

  throw new Error(`Unsupported launch mode: ${choice}`);
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
    } as MonitorProcessSpec['env'],
  };
}

export function resolveLauncherConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.launcher-config.json');
}

async function runOsascript(script: string): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', script]);
  return stdout.trim();
}

async function openExternal(target: string): Promise<void> {
  await execFileAsync('open', [target]);
}

export async function chooseLaunchMode(
  runScript: RunOsascriptFn = runOsascript,
): Promise<WeChatSendMode | null> {
  const choice = (
    await runScript(
      'set userChoice to choose from list {"自动发送", "仅粘贴不发送"} with prompt "选择启动模式：" default items {"仅粘贴不发送"}\nif userChoice is false then return "__CANCEL__"\nreturn item 1 of userChoice',
    )
  ).trim();

  if (choice === '__CANCEL__') {
    return null;
  }

  return resolveLaunchMode(choice);
}

export function resolveAccessibilityHostApp(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const termProgram = env.TERM_PROGRAM?.trim();

  if (!termProgram || termProgram === 'Apple_Terminal') {
    return 'Terminal';
  }

  if (termProgram === 'iTerm.app' || termProgram === 'iTerm2') {
    return 'iTerm';
  }

  return termProgram.replace(/\.app$/i, '');
}

async function checkAccessibilityPermission(
  runScript: RunOsascriptFn = runOsascript,
): Promise<AccessibilityPermissionStatus> {
  const result = await runScript(
    'try\n' +
      'tell application "System Events"\n' +
      'if UI elements enabled then return "__GRANTED__"\n' +
      'return "__DENIED__"\n' +
      'end tell\n' +
      'on error errMsg number errNum\n' +
      'return "__ERROR__:" & errNum & ":" & errMsg\n' +
      'end try',
  );

  if (result === '__GRANTED__') {
    return 'granted';
  }

  if (result === '__DENIED__') {
    return 'denied';
  }

  if (result.startsWith('__ERROR__:')) {
    throw new Error(`辅助功能权限检查失败：${result.slice('__ERROR__:'.length)}`);
  }

  throw new Error(`Unexpected accessibility check result: ${result}`);
}

async function promptToContinueAfterAccessibilityGrant(
  appName: string,
  runScript: RunOsascriptFn = runOsascript,
): Promise<AccessibilityPromptResult> {
  const result = await runScript(
    'try\n' +
      `display dialog "WeChatCLI 需要辅助功能权限才能自动激活微信并发送消息。系统设置已打开，请在“隐私与安全性 > 辅助功能”中允许 ${escapeAppleScriptString(appName)}，然后点击“已授权，继续”。" with title "WeChatCLI 需要辅助功能权限" buttons {"取消", "已授权，继续"} default button "已授权，继续"\n` +
      'return button returned of result\n' +
      'on error number -128\n' +
      'return "__CANCEL__"\n' +
      'end try',
  );

  if (result === '__CANCEL__' || result === '取消') {
    return 'cancel';
  }

  if (result === '已授权，继续') {
    return 'continue';
  }

  throw new Error(`Unexpected accessibility prompt result: ${result}`);
}

export async function ensureAccessibilityPermission(options: {
  env?: NodeJS.ProcessEnv;
  openExternal?: OpenExternalFn;
  runPermissionCheck?: () => Promise<AccessibilityPermissionStatus>;
  promptToContinue?: (appName: string) => Promise<AccessibilityPromptResult>;
} = {}): Promise<boolean> {
  const appName = resolveAccessibilityHostApp(options.env);
  const runPermissionCheck =
    options.runPermissionCheck ?? (() => checkAccessibilityPermission());
  const promptToContinue =
    options.promptToContinue ??
    ((currentAppName: string) =>
      promptToContinueAfterAccessibilityGrant(currentAppName));
  const openSettings = options.openExternal ?? openExternal;

  if ((await runPermissionCheck()) === 'granted') {
    return true;
  }

  await openSettings(ACCESSIBILITY_SETTINGS_URL).catch(() => {});

  if ((await promptToContinue(appName)) === 'cancel') {
    return false;
  }

  if ((await runPermissionCheck()) === 'granted') {
    return true;
  }

  throw new Error(
    `辅助功能权限仍未授予，请在“系统设置 > 隐私与安全性 > 辅助功能”中允许 ${appName}。`,
  );
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export async function displayLauncherError(message: string): Promise<void> {
  const escapedMessage = escapeAppleScriptString(message);
  const escapedTitle = escapeAppleScriptString('WeChatCLI 启动失败');
  await runOsascript(
    `display dialog "${escapedMessage}" with title "${escapedTitle}" buttons {"好"} default button "好"`,
  ).catch(() => {});
}

export async function runLauncher(
  projectRoot = process.cwd(),
): Promise<void> {
  const configPath = resolveLauncherConfigPath(projectRoot);
  const rawConfig = await fs.readFile(configPath, 'utf8');
  const config = parseLauncherConfig(rawConfig);
  const launchChoice = await chooseLaunchMode();

  if (launchChoice === null) {
    console.log('已取消启动。');
    return;
  }

  if (!(await ensureAccessibilityPermission())) {
    console.log('已取消启动。');
    return;
  }

  const spec = buildMonitorProcessSpec(projectRoot, config, launchChoice);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `monitor exited due to signal ${signal}`
            : `monitor exited with code ${code ?? 'unknown'}`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  try {
    await runLauncher();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    await displayLauncherError(message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
