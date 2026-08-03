/**
 * Human-like outbound reply delivery
 *
 * Shared across channels: typing indicator, delay ∝ reply length,
 * and splitting long replies into at most two bubbles.
 *
 * Controllers keep credentials / ORDER_DATA / image extraction;
 * this module only owns timing + bubble planning + send sequencing.
 */

import { logger } from '../../utils/logger.js';

// ==================== CONSTANTS ====================

/** Prefer a second bubble once the reply is clearly long for chat UX */
const SPLIT_MIN_CHARS = 320;

/** Soft target for the first bubble when splitting */
const FIRST_BUBBLE_SOFT_MAX = 260;

/** Never leave a tiny trailing bubble */
const MIN_SECOND_BUBBLE_CHARS = 48;

/** Typing delay: ~human read/compose feel, clamped */
const TYPING_BASE_MS = 700;
const TYPING_MS_PER_CHAR = 28;
const TYPING_MIN_MS = 1100;
const TYPING_MAX_MS = 4500;

const INTER_BUBBLE_BASE_MS = 450;
const INTER_BUBBLE_MS_PER_CHAR = 18;
const INTER_BUBBLE_MIN_MS = 550;
const INTER_BUBBLE_MAX_MS = 2200;

const POST_IMAGE_PAUSE_MS = 400;

// ==================== TYPES ====================

export interface OutboundTransport {
  /** Channel typing indicator (no-op if unsupported) */
  setTyping?(isTyping: boolean): Promise<void>;
  sendText(text: string): Promise<boolean>;
  /** Caption should be empty when delivery owns text bubbles */
  sendImage?(imageUrl: string, caption: string): Promise<boolean>;
}

export interface DeliverHumanLikeReplyParams {
  text: string;
  imageUrl?: string | null;
  transport: OutboundTransport;
  /** Optional context for logs (merchant isolation stays in transport) */
  context?: {
    merchantId?: string;
    platform?: string;
    conversationId?: string;
  };
}

export interface DeliverHumanLikeReplyResult {
  sent: boolean;
  bubbleCount: number;
  imageSent: boolean;
}

// ==================== PURE HELPERS ====================

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Keep typing indicator alive while the model generates a reply
 * (Telegram expires ~5s; Messenger ~20s). Returns a stop function.
 */
export function startTypingKeepalive(
  tick: () => Promise<void>,
  intervalMs = 4000
): () => void {
  let stopped = false;
  const run = () => {
    if (stopped) return;
    void tick().catch(() => undefined);
  };
  run();
  const id = setInterval(run, intervalMs);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}

/**
 * Typing delay proportional to content length (clamped).
 */
export function computeTypingDelayMs(
  charCount: number,
  opts?: { min?: number; max?: number; base?: number; perChar?: number }
): number {
  const base = opts?.base ?? TYPING_BASE_MS;
  const perChar = opts?.perChar ?? TYPING_MS_PER_CHAR;
  const min = opts?.min ?? TYPING_MIN_MS;
  const max = opts?.max ?? TYPING_MAX_MS;
  const raw = base + Math.max(0, charCount) * perChar;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

export function computeInterBubbleDelayMs(charCount: number): number {
  return computeTypingDelayMs(charCount, {
    base: INTER_BUBBLE_BASE_MS,
    perChar: INTER_BUBBLE_MS_PER_CHAR,
    min: INTER_BUBBLE_MIN_MS,
    max: INTER_BUBBLE_MAX_MS
  });
}

const isSentenceBoundary = (ch: string): boolean => /[.!?؟…]/.test(ch);

/**
 * Find a natural split index in [minIdx, maxIdx] preferring paragraph, then sentence, then whitespace.
 * Returns -1 if no good split.
 */
function findSplitIndex(text: string, minIdx: number, maxIdx: number): number {
  const hardMax = Math.min(text.length - MIN_SECOND_BUBBLE_CHARS, maxIdx);
  if (hardMax < minIdx) return -1;

  // Prefer last double-newline in window
  const paraWindow = text.slice(0, hardMax + 1);
  const paraIdx = paraWindow.lastIndexOf('\n\n');
  if (paraIdx >= minIdx) {
    return paraIdx + 2; // after the blank line
  }

  // Prefer last sentence boundary in window
  for (let i = hardMax; i >= minIdx; i--) {
    if (isSentenceBoundary(text[i]) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) {
      return i + 1;
    }
  }

  // Prefer last whitespace
  for (let i = hardMax; i >= minIdx; i--) {
    if (/\s/.test(text[i])) {
      return i + 1;
    }
  }

  return -1;
}

/**
 * Split a customer-facing reply into at most two bubbles.
 * Safe for Arabic/English; never splits mid-URL-ish tokens when whitespace exists.
 */
export function splitReplyIntoBubbles(text: string): string[] {
  const cleaned = (text || '').replace(/\s+$/u, '').replace(/^\s+/u, '');
  if (!cleaned) return [];

  if (cleaned.length < SPLIT_MIN_CHARS) {
    return [cleaned];
  }

  // Prefer an existing paragraph break around the soft target
  const softTarget = Math.min(FIRST_BUBBLE_SOFT_MAX, Math.floor(cleaned.length * 0.55));
  const searchMin = Math.max(80, Math.floor(cleaned.length * 0.28));
  const searchMax = Math.max(softTarget, Math.floor(cleaned.length * 0.62));

  let splitAt = findSplitIndex(cleaned, searchMin, searchMax);

  // Wider window if first pass failed
  if (splitAt < 0) {
    splitAt = findSplitIndex(
      cleaned,
      Math.max(60, Math.floor(cleaned.length * 0.2)),
      Math.floor(cleaned.length * 0.75)
    );
  }

  if (splitAt < 0) {
    return [cleaned];
  }

  const first = cleaned.slice(0, splitAt).trim();
  const second = cleaned.slice(splitAt).trim();

  if (!first || !second || second.length < MIN_SECOND_BUBBLE_CHARS) {
    return [cleaned];
  }

  return [first, second];
}

// ==================== DELIVERY ====================

async function safeTyping(transport: OutboundTransport, on: boolean): Promise<void> {
  if (!transport.setTyping) return;
  try {
    await transport.setTyping(on);
  } catch (err) {
    logger.debug('Typing indicator failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
      on
    });
  }
}

/**
 * Deliver a reply with typing + proportional delay + optional 2-bubble split.
 *
 * Image policy (resolves conflict with caption-as-second-message helpers):
 * send image with empty caption first, then text bubble(s). That way
 * FB/IG helpers that auto-send caption as a separate message do not
 * duplicate or collide with bubble splitting.
 */
export async function deliverHumanLikeReply(
  params: DeliverHumanLikeReplyParams
): Promise<DeliverHumanLikeReplyResult> {
  const { transport, context } = params;
  const text = (params.text || '').trim();
  const imageUrl =
    params.imageUrl &&
    params.imageUrl !== 'N/A' &&
    params.imageUrl.startsWith('http')
      ? params.imageUrl
      : null;

  if (!text && !imageUrl) {
    return { sent: false, bubbleCount: 0, imageSent: false };
  }

  const bubbles = text ? splitReplyIntoBubbles(text) : [];
  const planChars = text.length || 40;

  logger.info('Human-like reply delivery plan', {
    merchantId: context?.merchantId,
    platform: context?.platform,
    conversationId: context?.conversationId,
    chars: planChars,
    bubbleCount: bubbles.length,
    hasImage: !!imageUrl,
    typingMs: computeTypingDelayMs(planChars)
  });

  await safeTyping(transport, true);
  await sleep(computeTypingDelayMs(planChars));

  let imageSent = false;
  let allOk = true;

  if (imageUrl && transport.sendImage) {
    const ok = await transport.sendImage(imageUrl, '');
    imageSent = ok;
    if (!ok) {
      logger.warn('Image send failed; falling back to text bubbles', {
        merchantId: context?.merchantId,
        platform: context?.platform
      });
    } else if (bubbles.length > 0) {
      await sleep(POST_IMAGE_PAUSE_MS);
      await safeTyping(transport, true);
      await sleep(
        computeTypingDelayMs(bubbles[0].length, {
          min: 600,
          max: 2200,
          base: 400,
          perChar: 16
        })
      );
    }
  }

  if (bubbles.length === 0) {
    await safeTyping(transport, false);
    return { sent: imageSent, bubbleCount: 0, imageSent };
  }

  for (let i = 0; i < bubbles.length; i++) {
    if (i > 0) {
      await safeTyping(transport, true);
      await sleep(computeInterBubbleDelayMs(bubbles[i].length));
    }

    const ok = await transport.sendText(bubbles[i]);
    if (!ok) allOk = false;
  }

  await safeTyping(transport, false);

  return {
    sent: imageSent || allOk,
    bubbleCount: bubbles.length,
    imageSent
  };
}
