import * as path from 'path';

import { startDispatcher } from './dispatcher.ts';
import { resolvePollerRuntimeOptions, startPoller } from './poller.ts';
import type { WeChatSendMode } from './wechat-ui-send.ts';

const OUTPUT_DIR = path.join(process.cwd(), 'output');
const SEND_MODE: WeChatSendMode =
  process.env.WECHAT_SEND_MODE === 'send' ? 'send' : 'paste-only';
const RUNTIME_OPTIONS = resolvePollerRuntimeOptions();

console.log('=== WeChat AI 监控器 ===');
console.log(`输出目录：${OUTPUT_DIR}`);
console.log(`发送模式：${SEND_MODE === 'send' ? '自动发送' : '仅粘贴不发送'}`);
console.log(
  `消息节奏：${RUNTIME_OPTIONS.pollIntervalMs / 1000}s 轮询，` +
    `${RUNTIME_OPTIONS.messageSettleMs / 1000}s 合并等待，` +
    `${RUNTIME_OPTIONS.historyLimit} 条历史`,
);

await startPoller(OUTPUT_DIR);

await startDispatcher({
  outputDir: OUTPUT_DIR,
  sendMode: SEND_MODE,
});
