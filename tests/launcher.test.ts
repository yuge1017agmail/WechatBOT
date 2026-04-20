import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMonitorProcessSpec,
  chooseLaunchMode,
  ensureAccessibilityPermission,
  parseLauncherConfig,
  resolveAccessibilityHostApp,
  resolveLaunchMode,
} from '../launcher.ts';

test('parseLauncherConfig returns validated API config', () => {
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
});
