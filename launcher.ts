import { execFile, spawn } from 'node:child_process';
import type { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
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
type WeChatCliAccountCheckStatus =
  | 'ok'
  | 'missing-config'
  | 'invalid-config'
  | 'configured-db-missing'
  | 'no-wechat-data'
  | 'account-switched';

export interface LauncherConfig {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_BASE_URL: string;
  MODEL_NAME?: string;
}

export interface LaunchSettings {
  sendMode: WeChatSendMode;
  pollIntervalMs: number;
  messageSettleMs: number;
  historyLimit: number;
}

export interface MessageRhythmSettings {
  pollIntervalMs: number;
  messageSettleMs: number;
  historyLimit: number;
}

export interface MonitorProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  env: {
    ANTHROPIC_API_KEY: string;
    ANTHROPIC_BASE_URL: string;
    WECHAT_SEND_MODE: WeChatSendMode;
    MODEL_NAME?: string;
    POLL_INTERVAL_MS: string;
    MESSAGE_SETTLE_MS: string;
    HISTORY_LIMIT: string;
  };
}

export interface WeChatAccountDirectory {
  accountDir: string;
  accountName: string;
  dbDir: string;
  resolvedDbDir: string;
  newestActivityMs: number;
}

export interface WeChatCliAccountCheckResult {
  ok: boolean;
  status: WeChatCliAccountCheckStatus;
  configuredDbDir?: string;
  configuredAccountName?: string;
  activeDbDir?: string;
  activeAccountName?: string;
  message?: string;
}

export interface WeChatCliAccountCheckOptions {
  homeDir?: string;
  configPath?: string;
  xwechatFilesDir?: string;
  accountActivitySkewMs?: number;
}

export const DEFAULT_MESSAGE_RHYTHM_SETTINGS: MessageRhythmSettings = {
  pollIntervalMs: 8_000,
  messageSettleMs: 10_000,
  historyLimit: 30,
};

const DEFAULT_ACCOUNT_ACTIVITY_SKEW_MS = 30_000;
const WECHAT_CLI_CONFIG_RELATIVE_PATH = path.join('.wechat-cli', 'config.json');
const XWECHAT_FILES_RELATIVE_PATH = path.join(
  'Library',
  'Containers',
  'com.tencent.xinWeChat',
  'Data',
  'Documents',
  'xwechat_files',
);

const MESSAGE_RHYTHM_PRESETS: Array<{
  label: string;
  settings: MessageRhythmSettings;
}> = [
  {
    label: '标准：8秒轮询，10秒合并，30条历史',
    settings: DEFAULT_MESSAGE_RHYTHM_SETTINGS,
  },
  {
    label: '快速：5秒轮询，8秒合并，30条历史',
    settings: {
      pollIntervalMs: 5_000,
      messageSettleMs: 8_000,
      historyLimit: 30,
    },
  },
  {
    label: '稳妥：15秒轮询，15秒合并，50条历史',
    settings: {
      pollIntervalMs: 15_000,
      messageSettleMs: 15_000,
      historyLimit: 50,
    },
  },
];

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
  const modelName = parsed.MODEL_NAME;

  if (typeof anthropicApiKey !== 'string' || anthropicApiKey.trim() === '') {
    throw new Error('Launcher config is missing API key (ANTHROPIC_API_KEY).');
  }

  if (
    typeof anthropicBaseUrl !== 'string' ||
    anthropicBaseUrl.trim() === ''
  ) {
    throw new Error('Launcher config is missing ANTHROPIC_BASE_URL.');
  }

  const config: LauncherConfig = {
    ANTHROPIC_API_KEY: anthropicApiKey,
    ANTHROPIC_BASE_URL: anthropicBaseUrl,
  };

  if (typeof modelName === 'string' && modelName.trim() !== '') {
    config.MODEL_NAME = modelName.trim();
  }

  return config;
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

export function resolveMessageRhythmSettings(
  choice: string,
): MessageRhythmSettings {
  const preset = MESSAGE_RHYTHM_PRESETS.find((entry) => entry.label === choice);
  if (preset) {
    return { ...preset.settings };
  }

  throw new Error(`Unsupported message rhythm: ${choice}`);
}

export function resolveLaunchSettings(
  sendMode: WeChatSendMode,
  rhythmChoice: string,
): LaunchSettings {
  return {
    sendMode,
    ...resolveMessageRhythmSettings(rhythmChoice),
  };
}

export function buildMonitorProcessSpec(
  projectRoot: string,
  config: LauncherConfig,
  launchSettings: WeChatSendMode | LaunchSettings,
): MonitorProcessSpec {
  const settings =
    typeof launchSettings === 'string'
      ? { ...DEFAULT_MESSAGE_RHYTHM_SETTINGS, sendMode: launchSettings }
      : launchSettings;

  return {
    command: 'node',
    args: ['--no-warnings', '--loader', 'ts-node/esm', 'monitor.ts'],
    cwd: projectRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY,
      ANTHROPIC_BASE_URL: config.ANTHROPIC_BASE_URL,
      WECHAT_SEND_MODE: settings.sendMode,
      POLL_INTERVAL_MS: String(settings.pollIntervalMs),
      MESSAGE_SETTLE_MS: String(settings.messageSettleMs),
      HISTORY_LIMIT: String(settings.historyLimit),
      ...(config.MODEL_NAME ? { MODEL_NAME: config.MODEL_NAME } : {}),
    } as MonitorProcessSpec['env'],
  };
}

function formatHomeRelativePath(targetPath: string, homeDir = os.homedir()): string {
  const relative = path.relative(homeDir, targetPath);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return `~/${relative}`;
  }

  return targetPath;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePathForCompare(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function isSamePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function isDatabaseFile(filename: string): boolean {
  return filename.endsWith('.db') ||
    filename.endsWith('.db-wal') ||
    filename.endsWith('.db-shm');
}

async function findNewestDatabaseActivityMs(
  dbDir: string,
  maxDepth = 3,
): Promise<number> {
  let newestActivityMs = 0;
  const pending: Array<{ dir: string; depth: number }> = [{ dir: dbDir, depth: 0 }];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) {
          pending.push({ dir: entryPath, depth: current.depth + 1 });
        }
        continue;
      }

      if (!entry.isFile() || !isDatabaseFile(entry.name)) {
        continue;
      }

      try {
        const stats = await fs.stat(entryPath);
        newestActivityMs = Math.max(newestActivityMs, stats.mtimeMs);
      } catch {
        // Ignore files that move while WeChat is writing.
      }
    }
  }

  if (newestActivityMs > 0) {
    return newestActivityMs;
  }

  try {
    return (await fs.stat(dbDir)).mtimeMs;
  } catch {
    return 0;
  }
}

export async function findWeChatAccountDirectories(
  xwechatFilesDir = path.join(os.homedir(), XWECHAT_FILES_RELATIVE_PATH),
): Promise<WeChatAccountDirectory[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(xwechatFilesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const accountDirs: WeChatAccountDirectory[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const accountDir = path.join(xwechatFilesDir, entry.name);
    const dbDir = path.join(accountDir, 'db_storage');
    if (!(await pathExists(dbDir))) {
      continue;
    }

    accountDirs.push({
      accountDir,
      accountName: entry.name,
      dbDir,
      resolvedDbDir: await resolvePathForCompare(dbDir),
      newestActivityMs: await findNewestDatabaseActivityMs(dbDir),
    });
  }

  return accountDirs.sort((left, right) => right.newestActivityMs - left.newestActivityMs);
}

function accountNameFromDbDir(dbDir: string): string | undefined {
  const parent = path.basename(path.dirname(dbDir));
  return parent && parent !== '.' ? parent : undefined;
}

function readWechatCliConfig(rawConfig: string): { db_dir?: unknown } {
  const parsed: unknown = JSON.parse(rawConfig);
  if (!isRecord(parsed)) {
    throw new Error('config must be a JSON object');
  }

  return parsed;
}

function buildWechatCliAccountCheckMessage(
  result: WeChatCliAccountCheckResult,
  homeDir = os.homedir(),
): string {
  if (result.status === 'missing-config') {
    return `未找到 wechat-cli 配置文件：${formatHomeRelativePath(path.join(homeDir, WECHAT_CLI_CONFIG_RELATIVE_PATH), homeDir)}

请先确认当前微信账号已登录，然后在终端执行：
wechat-cli init`;
  }

  if (result.status === 'invalid-config') {
    return `wechat-cli 配置文件格式异常，未读取到 db_dir。

请在当前微信账号登录状态下重新执行：
wechat-cli init`;
  }

  if (result.status === 'configured-db-missing') {
    return `wechat-cli 当前绑定的微信数据库目录不存在：
${formatHomeRelativePath(result.configuredDbDir ?? '', homeDir)}

请确认当前微信账号已登录，然后重新执行：
wechat-cli init`;
  }

  if (result.status === 'no-wechat-data') {
    return `未找到微信账号数据库目录。

请先打开微信桌面版并登录当前账号，再重新启动本工具。`;
  }

  if (result.status === 'account-switched') {
    return `检测到微信账号可能已切换，已停止启动以避免漏消息或回复到错误账号。

wechat-cli 当前绑定：${result.configuredAccountName ?? '未知账号目录'}
微信最近活跃目录：${result.activeAccountName ?? '未知账号目录'}

请在当前微信账号登录状态下执行：
wechat-cli init

如果重新初始化后仍识别不到新消息，再备份并重置：
${formatHomeRelativePath(path.join(homeDir, '.wechat-cli', 'last_check.json'), homeDir)}`;
  }

  return result.message ?? 'wechat-cli 账号检查失败。';
}

export async function checkWechatCliAccount(
  options: WeChatCliAccountCheckOptions = {},
): Promise<WeChatCliAccountCheckResult> {
  const homeDir = options.homeDir ?? os.homedir();
  const configPath =
    options.configPath ?? path.join(homeDir, WECHAT_CLI_CONFIG_RELATIVE_PATH);
  const xwechatFilesDir =
    options.xwechatFilesDir ?? path.join(homeDir, XWECHAT_FILES_RELATIVE_PATH);
  const accountActivitySkewMs =
    options.accountActivitySkewMs ?? DEFAULT_ACCOUNT_ACTIVITY_SKEW_MS;

  let rawConfig: string;
  try {
    rawConfig = await fs.readFile(configPath, 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      const result: WeChatCliAccountCheckResult = {
        ok: false,
        status: 'missing-config',
      };
      return {
        ...result,
        message: buildWechatCliAccountCheckMessage(result, homeDir),
      };
    }

    throw error;
  }

  let configuredDbDir: string;
  try {
    const config = readWechatCliConfig(rawConfig);
    if (typeof config.db_dir !== 'string' || config.db_dir.trim() === '') {
      const result: WeChatCliAccountCheckResult = {
        ok: false,
        status: 'invalid-config',
      };
      return {
        ...result,
        message: buildWechatCliAccountCheckMessage(result, homeDir),
      };
    }
    configuredDbDir = config.db_dir;
  } catch {
    const result: WeChatCliAccountCheckResult = {
      ok: false,
      status: 'invalid-config',
    };
    return {
      ...result,
      message: buildWechatCliAccountCheckMessage(result, homeDir),
    };
  }

  const configuredResolvedDbDir = await resolvePathForCompare(configuredDbDir);
  if (!(await pathExists(configuredDbDir))) {
    const result: WeChatCliAccountCheckResult = {
      ok: false,
      status: 'configured-db-missing',
      configuredDbDir,
      configuredAccountName: accountNameFromDbDir(configuredDbDir),
    };
    return {
      ...result,
      message: buildWechatCliAccountCheckMessage(result, homeDir),
    };
  }

  const accountDirs = await findWeChatAccountDirectories(xwechatFilesDir);
  if (accountDirs.length === 0) {
    const result: WeChatCliAccountCheckResult = {
      ok: false,
      status: 'no-wechat-data',
      configuredDbDir,
      configuredAccountName: accountNameFromDbDir(configuredDbDir),
    };
    return {
      ...result,
      message: buildWechatCliAccountCheckMessage(result, homeDir),
    };
  }

  const configuredAccount = accountDirs.find((account) =>
    isSamePath(account.resolvedDbDir, configuredResolvedDbDir),
  );
  const activeAccount = accountDirs[0];
  const activeDiffersFromConfigured = !isSamePath(
    activeAccount.resolvedDbDir,
    configuredResolvedDbDir,
  );
  const activeClearlyNewer =
    !configuredAccount ||
    activeAccount.newestActivityMs >
      configuredAccount.newestActivityMs + accountActivitySkewMs;

  if (activeDiffersFromConfigured && activeClearlyNewer) {
    const result: WeChatCliAccountCheckResult = {
      ok: false,
      status: 'account-switched',
      configuredDbDir,
      configuredAccountName:
        configuredAccount?.accountName ?? accountNameFromDbDir(configuredDbDir),
      activeDbDir: activeAccount.dbDir,
      activeAccountName: activeAccount.accountName,
    };
    return {
      ...result,
      message: buildWechatCliAccountCheckMessage(result, homeDir),
    };
  }

  return {
    ok: true,
    status: 'ok',
    configuredDbDir,
    configuredAccountName:
      configuredAccount?.accountName ?? accountNameFromDbDir(configuredDbDir),
    activeDbDir: activeAccount.dbDir,
    activeAccountName: activeAccount.accountName,
  };
}

export async function ensureWechatCliAccountIsCurrent(
  options: WeChatCliAccountCheckOptions = {},
): Promise<void> {
  const result = await checkWechatCliAccount(options);
  if (!result.ok) {
    throw new Error(result.message ?? buildWechatCliAccountCheckMessage(result));
  }
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

export async function chooseMessageRhythm(
  runScript: RunOsascriptFn = runOsascript,
): Promise<MessageRhythmSettings | null> {
  const choices = MESSAGE_RHYTHM_PRESETS
    .map((preset) => `"${escapeAppleScriptString(preset.label)}"`)
    .join(', ');
  const defaultChoice = escapeAppleScriptString(MESSAGE_RHYTHM_PRESETS[0].label);
  const choice = (
    await runScript(
      `set userChoice to choose from list {${choices}} with prompt "选择消息节奏：" default items {"${defaultChoice}"}\nif userChoice is false then return "__CANCEL__"\nreturn item 1 of userChoice`,
    )
  ).trim();

  if (choice === '__CANCEL__') {
    return null;
  }

  return resolveMessageRhythmSettings(choice);
}

export async function chooseLaunchSettings(
  runScript: RunOsascriptFn = runOsascript,
): Promise<LaunchSettings | null> {
  const sendMode = await chooseLaunchMode(runScript);

  if (sendMode === null) {
    return null;
  }

  const rhythmSettings = await chooseMessageRhythm(runScript);

  if (rhythmSettings === null) {
    return null;
  }

  return {
    sendMode,
    ...rhythmSettings,
  };
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
  await ensureWechatCliAccountIsCurrent();
  const launchChoice = await chooseLaunchSettings();

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
