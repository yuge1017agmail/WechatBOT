import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
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
  validateConversation?: (chatName: string) => Promise<OcrValidationResult>;
  deliverWeChatMessage?: (
    reply: string,
    sendMode: WeChatSendMode,
  ) => Promise<void>;
  /** 关闭 OCR 校验，仅用于本地调试或测试。生产路径上不要打开。 */
  skipOcrValidation?: boolean;
  logger?: Pick<Console, 'info' | 'warn'>;
}

export interface OcrValidationResult {
  ok: boolean;
  recognizedText: string;
  reason?: string;
}

export function resolvePrepareScriptPath(projectRoot: string): string {
  return path.join(projectRoot, 'scripts', 'prepare_wechat_chat.applescript');
}

export function resolveDeliverScriptPath(projectRoot: string): string {
  return path.join(projectRoot, 'scripts', 'deliver_wechat_message.applescript');
}

export function resolveOcrBinaryPath(projectRoot: string): string {
  return path.join(projectRoot, 'bin', 'wechat_ocr');
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

// ─── OCR 校验：截顶部 50px → Vision OCR → 归一化包含匹配 ─────────────────────

const TITLE_BAND_HEIGHT = 50;

/**
 * 字符归一化：把 OCR 文本和原始联系人名压扁到同一种形式再比较。
 * 处理：全角↔半角、破折号家族、大小写、所有空白字符。
 *
 * 注意"完全去空格"是有意为之：OCR 在标点前后加视觉空格的行为非常常见，
 * 而我们只截顶部 50px 标题条，同一时刻只显示一个会话名，
 * 子串误匹配（"张三" 是 "张三丰" 的子串）在标题条单一会话名场景下不会发生。
 */
function normalizeForOcrComparison(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    .replace(/[\u2010-\u2015\u2212\uFF0D]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, '');
}

interface WeChatWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function getWeChatWindowRect(): Promise<WeChatWindowRect> {
  const script = [
    'tell application "System Events"',
    '  tell process "WeChat"',
    '    set windowPos to position of window 1',
    '    set windowSize to size of window 1',
    '    set output to ""',
    '    set output to output & (item 1 of windowPos as integer) & linefeed',
    '    set output to output & (item 2 of windowPos as integer) & linefeed',
    '    set output to output & (item 1 of windowSize as integer) & linefeed',
    '    set output to output & (item 2 of windowSize as integer)',
    '    return output',
    '  end tell',
    'end tell',
  ].join('\n');

  const { stdout } = await execFileAsync('osascript', ['-e', script]);
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 4) {
    throw new Error(`cannot read WeChat window rect, got: ${JSON.stringify(stdout)}`);
  }

  const [x, y, width, height] = lines.slice(0, 4).map((value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error(`window rect has non-integer value: ${value}`);
    }
    return parsed;
  });

  return { x, y, width, height };
}

/**
 * 截图微信窗口顶部 50px，OCR，做归一化包含匹配。
 * 这是核心安全闸门——挡住"会话身份不对就发送"。
 *
 * 用途有两个：
 *   1. prepare 之前调用：判断"当前是否已经是目标会话"，如果是就跳过 prepare
 *   2. prepare 之后调用：校验切换是否真的成功
 */
export async function validateConversationByOCR(
  chatName: string,
  projectRoot: string,
): Promise<OcrValidationResult> {
  const ocrBinary = resolveOcrBinaryPath(projectRoot);
  try {
    await fs.access(ocrBinary, fs.constants.X_OK);
  } catch {
    return {
      ok: false,
      recognizedText: '',
      reason: `OCR helper 不存在或不可执行: ${ocrBinary}（请先跑 npm run build:ocr）`,
    };
  }

  let rect: WeChatWindowRect;
  try {
    rect = await getWeChatWindowRect();
  } catch (err) {
    return {
      ok: false,
      recognizedText: '',
      reason: `无法读取微信窗口位置：${(err as Error).message}`,
    };
  }

  const screenshotPath = path.join(
    os.tmpdir(),
    `wechat-validate-${Date.now()}-${process.pid}.png`,
  );

  try {
    await execFileAsync('screencapture', [
      '-R',
      `${rect.x},${rect.y},${rect.width},${TITLE_BAND_HEIGHT}`,
      '-x',
      screenshotPath,
    ]);

    const { stdout } = await execFileAsync(ocrBinary, [screenshotPath]);
    const recognizedText = stdout.trim();

    const normalizedRecognized = normalizeForOcrComparison(recognizedText);
    const normalizedTarget = normalizeForOcrComparison(chatName);

    if (normalizedTarget.length < 2) {
      return {
        ok: false,
        recognizedText,
        reason:
          `OCR 校验：联系人名「${chatName}」归一化后只剩 ${normalizedTarget.length} 个字符，` +
          `太短无法可靠校验。建议在微信里给该联系人设置一个稳定的备注名。`,
      };
    }

    if (normalizedRecognized.includes(normalizedTarget)) {
      return { ok: true, recognizedText };
    }

    return {
      ok: false,
      recognizedText,
      reason:
        `OCR 校验：屏幕顶部未识别到「${chatName}」。` +
        `OCR 原文：${recognizedText.replace(/\n/g, ' | ')}。` +
        `归一化后目标：「${normalizedTarget}」、` +
        `归一化后识别：「${normalizedRecognized}」。`,
    };
  } catch (err) {
    return {
      ok: false,
      recognizedText: '',
      reason: `OCR 执行异常：${(err as Error).message}`,
    };
  } finally {
    void fs.unlink(screenshotPath).catch(() => {});
  }
}

// ─── 编排层：smart prepare → validate → deliver ───────────────────────────────

export async function sendViaWeChat(
  context: WeChatMessageContext,
  reply: string,
  options: SendViaWeChatOptions = {},
): Promise<void> {
  const sendMode = options.sendMode ?? 'paste-only';
  const projectRoot = options.projectRoot ?? process.cwd();
  const logger = options.logger ?? console;

  const prepare =
    options.prepareWeChatChat ??
    ((chatName: string) => prepareWeChatChat(chatName, projectRoot));

  const validate =
    options.validateConversation ??
    ((chatName: string) => validateConversationByOCR(chatName, projectRoot));

  const deliver =
    options.deliverWeChatMessage ??
    ((replyText: string, mode: WeChatSendMode) =>
      deliverWeChatMessage(replyText, mode, projectRoot));

  // ─── Stage 1: 先 OCR 看当前会话是不是已经是目标人 ───────────────────────────
  // 这一步把"情况 2"（焦点已在目标会话）自然变成 prepare 跳过分支：
  //   - 如果当前打开的就是目标人 → 不动 Cmd+F、不动搜索框，直接 deliver
  //   - 如果不是 → 走完整的 prepare 流程

  if (!options.skipOcrValidation) {
    logger.info(`  [验证 1/2] OCR 检查当前会话是否已是「${context.chat}」...`);
    const preCheck = await validate(context.chat);
    if (preCheck.ok) {
      logger.info('  [验证 1/2] ✓ 已在目标会话，跳过 prepare 直接进入 deliver');
      // 直接发送，不做 prepare
      await deliver(reply, sendMode);
      return;
    }
    logger.info(`  [验证 1/2] 当前不是目标会话，需要切换`);
  }

  // ─── Stage 2: 切换会话 ─────────────────────────────────────────────────────
  await prepare(context.chat);

  // ─── Stage 3: OCR 校验切换是否真的成功 ────────────────────────────────────
  if (!options.skipOcrValidation) {
    logger.info(`  [验证 2/2] OCR 校验切换后会话是否正确...`);
    const postCheck = await validate(context.chat);
    if (!postCheck.ok) {
      throw new Error(
        postCheck.reason ?? `OCR 校验失败：切换后未识别到「${context.chat}」`,
      );
    }
    logger.info(`  [验证 2/2] ✓ 切换成功`);
  }

  // ─── Stage 4: 发送 ────────────────────────────────────────────────────────
  await deliver(reply, sendMode);
}
