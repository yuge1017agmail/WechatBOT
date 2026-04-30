import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildMonitorProcessSpec,
  checkWechatCliAccount,
  chooseMessageRhythm,
  chooseLaunchMode,
  chooseLaunchSettings,
  ensureWechatCliAccountIsCurrent,
  findWeChatAccountDirectories,
  ensureAccessibilityPermission,
  parseLauncherConfig,
  resolveAccessibilityHostApp,
  resolveLaunchMode,
  resolveMessageRhythmSettings,
  resolveLaunchSettings,
} from '../launcher.ts';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'wechat-launcher-test-'));
}

async function writeJson(filepath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(value), 'utf8');
}

async function writeDbFile(filepath: string, mtimeMs: number): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, 'db');
  const date = new Date(mtimeMs);
  await fs.utimes(filepath, date, date);
}

test('parseLauncherConfig returns validated API config', () => {
  assert.deepEqual(
    parseLauncherConfig(
        JSON.stringify({
          ANTHROPIC_API_KEY: 'sk-test',
          ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
          MODEL_NAME: 'gpt-4.1',
        }),
      ),
    {
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      MODEL_NAME: 'gpt-4.1',
    },
  );
});

test('parseLauncherConfig keeps model optional', () => {
  assert.deepEqual(
    parseLauncherConfig(
      JSON.stringify({
        ANTHROPIC_API_KEY: 'sk-test',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      }),
    ),
    {
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    },
  );
});

test('parseLauncherConfig rejects missing API key', () => {
  assert.throws(
    () =>
      parseLauncherConfig(
        JSON.stringify({
          ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        }),
      ),
    /API key/i,
  );
});

test('resolveLaunchMode maps 自动发送 to send', () => {
  assert.equal(resolveLaunchMode('自动发送'), 'send');
});

test('resolveLaunchMode maps 仅粘贴不发送 to paste-only', () => {
  assert.equal(resolveLaunchMode('仅粘贴不发送'), 'paste-only');
});

test('chooseLaunchMode returns null when the user cancels', async () => {
  const result = await chooseLaunchMode(async () => '__CANCEL__');

  assert.equal(result, null);
});

test('chooseLaunchMode exposes osascript failures', async () => {
  await assert.rejects(
    () =>
      chooseLaunchMode(async () => {
        throw new Error('osascript failed');
      }),
    /osascript failed/,
  );
});

test('resolveMessageRhythmSettings maps rhythm presets', () => {
  assert.deepEqual(
    resolveMessageRhythmSettings('快速：5秒轮询，8秒合并，30条历史'),
    {
      pollIntervalMs: 5_000,
      messageSettleMs: 8_000,
      historyLimit: 30,
    },
  );
});

test('resolveLaunchSettings combines send mode and rhythm preset', () => {
  assert.deepEqual(resolveLaunchSettings('send', '快速：5秒轮询，8秒合并，30条历史'), {
    sendMode: 'send',
    pollIntervalMs: 5_000,
    messageSettleMs: 8_000,
    historyLimit: 30,
  });
});

test('chooseMessageRhythm returns null when the user cancels', async () => {
  const result = await chooseMessageRhythm(async () => '__CANCEL__');

  assert.equal(result, null);
});

test('chooseMessageRhythm returns rhythm settings', async () => {
  const result = await chooseMessageRhythm(
    async () => '稳妥：15秒轮询，15秒合并，50条历史',
  );

  assert.deepEqual(result, {
    pollIntervalMs: 15_000,
    messageSettleMs: 15_000,
    historyLimit: 50,
  });
});

test('chooseLaunchSettings returns null when the user cancels', async () => {
  const result = await chooseLaunchSettings(async () => '__CANCEL__');

  assert.equal(result, null);
});

test('chooseLaunchSettings returns combined launch settings', async () => {
  const choices = ['自动发送', '稳妥：15秒轮询，15秒合并，50条历史'];
  const result = await chooseLaunchSettings(
    async () => choices.shift() ?? '__CANCEL__',
  );

  assert.deepEqual(result, {
    sendMode: 'send',
    pollIntervalMs: 15_000,
    messageSettleMs: 15_000,
    historyLimit: 50,
  });
});

test('resolveAccessibilityHostApp maps Apple Terminal to Terminal', () => {
  assert.equal(
    resolveAccessibilityHostApp({ TERM_PROGRAM: 'Apple_Terminal' }),
    'Terminal',
  );
});

test('ensureAccessibilityPermission returns immediately when already granted', async () => {
  const openedUrls: string[] = [];

  await ensureAccessibilityPermission({
    env: { TERM_PROGRAM: 'Apple_Terminal' },
    openExternal: async (url: string) => {
      openedUrls.push(url);
    },
    runPermissionCheck: async () => 'granted',
    promptToContinue: async () => 'continue',
  });

  assert.deepEqual(openedUrls, []);
});

test('ensureAccessibilityPermission opens settings and succeeds after user grants access', async () => {
  const openedUrls: string[] = [];
  let checks = 0;

  await ensureAccessibilityPermission({
    env: { TERM_PROGRAM: 'Apple_Terminal' },
    openExternal: async (url: string) => {
      openedUrls.push(url);
    },
    runPermissionCheck: async () => {
      checks += 1;
      return checks === 1 ? 'denied' : 'granted';
    },
    promptToContinue: async (appName: string) => {
      assert.equal(appName, 'Terminal');
      return 'continue';
    },
  });

  assert.deepEqual(openedUrls, [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  ]);
  assert.equal(checks, 2);
});

test('ensureAccessibilityPermission fails when access is still denied after continue', async () => {
  await assert.rejects(
    () =>
      ensureAccessibilityPermission({
        env: { TERM_PROGRAM: 'Apple_Terminal' },
        openExternal: async () => {},
        runPermissionCheck: async () => 'denied',
        promptToContinue: async () => 'continue',
      }),
    /辅助功能权限仍未授予/,
  );
});

test('buildMonitorProcessSpec returns the monitor process spec', () => {
  const spec = buildMonitorProcessSpec(
    '/tmp/wechat-project',
    {
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      MODEL_NAME: 'gpt-4.1',
    },
    'send',
  );

  assert.equal(spec.command, 'node');
  assert.deepEqual(spec.args, [
    '--no-warnings',
    '--loader',
    'ts-node/esm',
    'monitor.ts',
  ]);
  assert.equal(spec.cwd, '/tmp/wechat-project');
  assert.equal(spec.env.ANTHROPIC_API_KEY, 'sk-test');
  assert.equal(spec.env.ANTHROPIC_BASE_URL, 'https://api.anthropic.com');
  assert.equal(spec.env.WECHAT_SEND_MODE, 'send');
  assert.equal(spec.env.MODEL_NAME, 'gpt-4.1');
  assert.equal(spec.env.POLL_INTERVAL_MS, '8000');
  assert.equal(spec.env.MESSAGE_SETTLE_MS, '10000');
  assert.equal(spec.env.HISTORY_LIMIT, '30');
});

test('buildMonitorProcessSpec accepts combined runtime settings', () => {
  const spec = buildMonitorProcessSpec(
    '/tmp/wechat-project',
    {
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    },
    {
      sendMode: 'paste-only',
      pollIntervalMs: 5_000,
      messageSettleMs: 8_000,
      historyLimit: 30,
    },
  );

  assert.equal(spec.env.WECHAT_SEND_MODE, 'paste-only');
  assert.equal(spec.env.POLL_INTERVAL_MS, '5000');
  assert.equal(spec.env.MESSAGE_SETTLE_MS, '8000');
  assert.equal(spec.env.HISTORY_LIMIT, '30');
});

test('findWeChatAccountDirectories sorts accounts by database activity', async () => {
  const tmp = await makeTempDir();
  const xwechatFilesDir = path.join(tmp, 'xwechat_files');
  const olderDb = path.join(xwechatFilesDir, 'wxid_old_1111', 'db_storage');
  const newerDb = path.join(xwechatFilesDir, 'wxid_new_2222', 'db_storage');

  await writeDbFile(path.join(olderDb, 'message', 'message_0.db'), 1_000);
  await writeDbFile(path.join(newerDb, 'session', 'session.db-wal'), 5_000);

  const accounts = await findWeChatAccountDirectories(xwechatFilesDir);

  assert.deepEqual(
    accounts.map((account) => account.accountName),
    ['wxid_new_2222', 'wxid_old_1111'],
  );
});

test('checkWechatCliAccount passes when configured account is active', async () => {
  const tmp = await makeTempDir();
  const configPath = path.join(tmp, '.wechat-cli', 'config.json');
  const xwechatFilesDir = path.join(tmp, 'xwechat_files');
  const dbDir = path.join(xwechatFilesDir, 'wxid_current_1111', 'db_storage');

  await writeDbFile(path.join(dbDir, 'message', 'message_0.db'), 5_000);
  await writeJson(configPath, { db_dir: dbDir });

  const result = await checkWechatCliAccount({
    homeDir: tmp,
    configPath,
    xwechatFilesDir,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'ok');
  assert.equal(result.configuredAccountName, 'wxid_current_1111');
});

test('checkWechatCliAccount reports a likely account switch', async () => {
  const tmp = await makeTempDir();
  const configPath = path.join(tmp, '.wechat-cli', 'config.json');
  const xwechatFilesDir = path.join(tmp, 'xwechat_files');
  const oldDb = path.join(xwechatFilesDir, 'wxid_old_1111', 'db_storage');
  const newDb = path.join(xwechatFilesDir, 'wxid_new_2222', 'db_storage');

  await writeDbFile(path.join(oldDb, 'message', 'message_0.db'), 1_000);
  await writeDbFile(path.join(newDb, 'message', 'message_0.db-wal'), 90_000);
  await writeJson(configPath, { db_dir: oldDb });

  const result = await checkWechatCliAccount({
    homeDir: tmp,
    configPath,
    xwechatFilesDir,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'account-switched');
  assert.equal(result.configuredAccountName, 'wxid_old_1111');
  assert.equal(result.activeAccountName, 'wxid_new_2222');
  assert.match(result.message ?? '', /wechat-cli init/);
});

test('ensureWechatCliAccountIsCurrent rejects when account changed', async () => {
  const tmp = await makeTempDir();
  const configPath = path.join(tmp, '.wechat-cli', 'config.json');
  const xwechatFilesDir = path.join(tmp, 'xwechat_files');
  const oldDb = path.join(xwechatFilesDir, 'wxid_old_1111', 'db_storage');
  const newDb = path.join(xwechatFilesDir, 'wxid_new_2222', 'db_storage');

  await writeDbFile(path.join(oldDb, 'message', 'message_0.db'), 1_000);
  await writeDbFile(path.join(newDb, 'session', 'session.db'), 90_000);
  await writeJson(configPath, { db_dir: oldDb });

  await assert.rejects(
    () =>
      ensureWechatCliAccountIsCurrent({
        homeDir: tmp,
        configPath,
        xwechatFilesDir,
      }),
    /微信账号可能已切换/,
  );
});

test('checkWechatCliAccount reports missing wechat-cli config', async () => {
  const tmp = await makeTempDir();
  const result = await checkWechatCliAccount({
    homeDir: tmp,
    configPath: path.join(tmp, '.wechat-cli', 'config.json'),
    xwechatFilesDir: path.join(tmp, 'xwechat_files'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'missing-config');
  assert.match(result.message ?? '', /wechat-cli init/);
});
