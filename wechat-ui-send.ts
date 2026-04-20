import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type WeChatSendMode = 'send' | 'paste-only';

export interface WeChatMessageContext {
  chat: string;
  username: string;
  is_group: boolean;
  last_message: string;
  sender?: string;
}

export interface SendViaWeChatOptions {
  projectRoot?: string;
  sendMode?: WeChatSendMode;
  prepareWeChatChat?: (chatName: string) => Promise<void>;
  deliverWeChatMessage?: (
    reply: string,
    sendMode: WeChatSendMode,
  ) => Promise<void>;
}

export function resolvePrepareScriptPath(projectRoot: string): string {
  return path.join(projectRoot, 'scripts', 'prepare_wechat_chat.applescript');
}

export function resolveDeliverScriptPath(projectRoot: string): string {
  return path.join(projectRoot, 'scripts', 'deliver_wechat_message.applescript');
}

export function buildReplyPreview(chatName: string, reply: string): string {
  const bodyLines = reply.split('\n').map((line) => `    ${line}`);
  return [
    '  准备发送自动回复：',
    `  会话：${chatName}`,
    '  内容：',
    ...bodyLines,
  ].join('\n');
}

async function runScript(scriptPath: string, args: string[]): Promise<void> {
  try {
    await execFileAsync('osascript', ['-s', 'o', scriptPath, ...args]);
  } catch (err: any) {
    const detail =
      err?.stderr?.trim() ||
      err?.stdout?.trim() ||
      err?.message ||
      'unknown osascript error';
    throw new Error(`wechat ui automation failed: ${detail}`);
  }
}

async function prepareWeChatChat(
  chatName: string,
  projectRoot: string,
): Promise<void> {
  await runScript(resolvePrepareScriptPath(projectRoot), [chatName]);
}

async function deliverWeChatMessage(
  reply: string,
  sendMode: WeChatSendMode,
  projectRoot: string,
): Promise<void> {
  await runScript(resolveDeliverScriptPath(projectRoot), [reply, sendMode]);
}

export async function sendViaWeChat(
  context: WeChatMessageContext,
  reply: string,
  options: SendViaWeChatOptions = {},
): Promise<void> {
  const sendMode = options.sendMode ?? 'paste-only';
  const projectRoot = options.projectRoot ?? process.cwd();
  const prepare =
    options.prepareWeChatChat ??
    ((chatName: string) => prepareWeChatChat(chatName, projectRoot));
  const deliver =
    options.deliverWeChatMessage ??
    ((replyText: string, mode: WeChatSendMode) =>
      deliverWeChatMessage(replyText, mode, projectRoot));

  await prepare(context.chat);
  await deliver(reply, sendMode);
}
