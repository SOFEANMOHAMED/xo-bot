/**
 * Human-like reply helpers for the bot playground UI.
 * Mirrors backend/src/services/channels/replyDelivery.ts algorithms
 * (kept in sync intentionally — frontend and backend do not share TS modules).
 */

const SPLIT_MIN_CHARS = 320;
const FIRST_BUBBLE_SOFT_MAX = 260;
const MIN_SECOND_BUBBLE_CHARS = 48;

const TYPING_BASE_MS = 700;
const TYPING_MS_PER_CHAR = 28;
const TYPING_MIN_MS = 1100;
const TYPING_MAX_MS = 4500;

const INTER_BUBBLE_BASE_MS = 450;
const INTER_BUBBLE_MS_PER_CHAR = 18;
const INTER_BUBBLE_MIN_MS = 550;
const INTER_BUBBLE_MAX_MS = 2200;

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function findSplitIndex(text: string, minIdx: number, maxIdx: number): number {
  const hardMax = Math.min(text.length - MIN_SECOND_BUBBLE_CHARS, maxIdx);
  if (hardMax < minIdx) return -1;

  const paraWindow = text.slice(0, hardMax + 1);
  const paraIdx = paraWindow.lastIndexOf('\n\n');
  if (paraIdx >= minIdx) return paraIdx + 2;

  for (let i = hardMax; i >= minIdx; i--) {
    if (isSentenceBoundary(text[i]) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) {
      return i + 1;
    }
  }

  for (let i = hardMax; i >= minIdx; i--) {
    if (/\s/.test(text[i])) return i + 1;
  }

  return -1;
}

export function splitReplyIntoBubbles(text: string): string[] {
  const cleaned = (text || '').replace(/\s+$/u, '').replace(/^\s+/u, '');
  if (!cleaned) return [];
  if (cleaned.length < SPLIT_MIN_CHARS) return [cleaned];

  const softTarget = Math.min(FIRST_BUBBLE_SOFT_MAX, Math.floor(cleaned.length * 0.55));
  const searchMin = Math.max(80, Math.floor(cleaned.length * 0.28));
  const searchMax = Math.max(softTarget, Math.floor(cleaned.length * 0.62));

  let splitAt = findSplitIndex(cleaned, searchMin, searchMax);
  if (splitAt < 0) {
    splitAt = findSplitIndex(
      cleaned,
      Math.max(60, Math.floor(cleaned.length * 0.2)),
      Math.floor(cleaned.length * 0.75)
    );
  }

  if (splitAt < 0) return [cleaned];

  const first = cleaned.slice(0, splitAt).trim();
  const second = cleaned.slice(splitAt).trim();
  if (!first || !second || second.length < MIN_SECOND_BUBBLE_CHARS) return [cleaned];
  return [first, second];
}
