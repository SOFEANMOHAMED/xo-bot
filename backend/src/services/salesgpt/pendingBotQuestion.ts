/**
 * pending_bot_question — color | size bound to a product_id in conversation_state.
 *
 * Set only when the outbound reply is a deterministic color/size ASK template
 * (buildAskColorMessage / buildAskSizeMessage fingerprints) — not free sales copy.
 * Cleared after the next bare answer is consumed (or on fall-through).
 */
import type { ConversationState, Product } from '../../core/types.js';
import { extractColorFromText } from '../../catalog/color-options.js';
import {
  extractColorFromUserText,
  isColorInProductCatalog,
} from './orderColorPolicy.js';
import { isExplicitPhotoRequest } from './turnIntent.js';

export type PendingBotQuestionKind = 'color' | 'size';

export type PendingBotQuestionState = {
  pending_bot_question: PendingBotQuestionKind | null;
  pending_bot_question_product_id: string | null;
};

/** Fingerprints of buildAskColorMessage / clarification / unavailable asks. */
function isColorAskTemplate(text: string): boolean {
  if (/(?:أي|اي)\s*لون\s*بتحب/i.test(text)) return true;
  if (/which color would you like/i.test(text)) return true;
  if (/اختار لوناً من القائمة|choose from the list/i.test(text)) return true;
  if (/تقصد أي خيار لون|which color option did you mean/i.test(text)) return true;
  if (/الألوان المتاحة|available colors/i.test(text) && /لون|color/i.test(text)) return true;
  return false;
}

function isSizeAskTemplate(text: string): boolean {
  if (/(?:أي|اي)\s*مقاس\s*بتحب/i.test(text)) return true;
  if (/which size would you like/i.test(text)) return true;
  if (/اختار مقاس|choose .{0,24}size/i.test(text)) return true;
  return false;
}

/**
 * Classify an outbound bot reply as a pending color/size ask when it matches
 * deterministic templates — not arbitrary LLM prose.
 */
export function detectPendingBotQuestion(
  replyText: string
): PendingBotQuestionKind | null {
  if (!replyText?.trim()) return null;
  if (isColorAskTemplate(replyText)) return 'color';
  if (isSizeAskTemplate(replyText)) return 'size';
  return null;
}

export function lastAssistantContent(
  recentMessages: Array<{ role: string; content: string }> | null | undefined
): string {
  if (!recentMessages?.length) return '';
  for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
    const msg = recentMessages[i];
    if (msg?.role === 'assistant') return msg.content || '';
  }
  return '';
}

/**
 * Last bot question wins when that text is a color/size ask template.
 * Stored value is used only when there is no last bot text.
 */
export function resolveIncomingPendingBotQuestion(opts: {
  stored?: PendingBotQuestionKind | null;
  lastBotReply: string;
}): PendingBotQuestionKind | null {
  const last = (opts.lastBotReply || '').trim();
  if (last) {
    return detectPendingBotQuestion(last);
  }
  const stored = opts.stored;
  if (stored === 'color' || stored === 'size') return stored;
  return null;
}

export function resolveIncomingPendingProductId(opts: {
  pending: PendingBotQuestionKind | null;
  mentionedProductId?: string | null;
  lastBotProductId?: string | null;
  storedProductId?: string | null;
}): string | null {
  if (!opts.pending) return null;
  return opts.mentionedProductId || opts.lastBotProductId || opts.storedProductId || null;
}

/** Bind pending after we emit a color/size ask for a focused product. */
export function bindPendingBotQuestion(
  replyText: string,
  state: ConversationState,
  focusProduct?: Product | null
): PendingBotQuestionState {
  const pending = detectPendingBotQuestion(replyText);
  const oos = focusProduct ? typeof focusProduct.stock === 'number' && focusProduct.stock <= 0 : false;
  if (!pending || oos) {
    return { pending_bot_question: null, pending_bot_question_product_id: null };
  }
  const productId =
    state.last_recommended_products?.[0] ||
    state.extracted_entities?.product_id ||
    focusProduct?.id ||
    null;
  return {
    pending_bot_question: pending,
    pending_bot_question_product_id: productId ? String(productId) : null,
  };
}

export function clearPendingBotQuestion(): PendingBotQuestionState {
  return { pending_bot_question: null, pending_bot_question_product_id: null };
}

export function readPendingFromState(state: ConversationState): PendingBotQuestionState {
  const raw = (state as ConversationState & {
    pending_bot_question?: string | null;
    pending_bot_question_product_id?: string | null;
  }).pending_bot_question;
  const kind = raw === 'color' || raw === 'size' ? raw : null;
  const productId =
    (state as ConversationState & { pending_bot_question_product_id?: string | null })
      .pending_bot_question_product_id || null;
  return {
    pending_bot_question: kind,
    pending_bot_question_product_id: productId,
  };
}

export function applyPendingToState(
  state: ConversationState,
  pending: PendingBotQuestionState
): ConversationState {
  return {
    ...state,
    pending_bot_question: pending.pending_bot_question,
    pending_bot_question_product_id: pending.pending_bot_question_product_id,
  } as ConversationState;
}

/** Photo / "show me" lexemes — not a bare selection. */
export function looksLikeShowOrPhotoAsk(text: string): boolean {
  if (!text?.trim()) return false;
  if (isExplicitPhotoRequest(text)) return true;
  return /ورجيني|فرجيني|شكله|شكلها|شوف(?:ي|ني)?|صور(?:ة|ه)/i.test(text);
}

export function isAvailabilityQuestion(text: string): boolean {
  if (!text?.trim()) return false;
  return /موجود|متوفر|عندكم|عندك|in\s*stock|available/i.test(text);
}

/** Current-message refusal to receive a photo. */
export function isExplicitPhotoRefusal(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  const hasPhoto =
    /صور(ة|ه)?/i.test(messageText) || /\b(photo|picture|image)\b/i.test(messageText);
  if (!hasPhoto) return false;
  return (
    /(ما\s*بدي|ما\s*ابي|بلاش|بدون|لا\s*بدي|مو\s*بدي|مش\s*بدي)\s*.{0,12}صور/i.test(
      messageText
    ) ||
    /لا\s*أنا\s*ما\s*بدي\s*الصور/i.test(messageText) ||
    /\b(don'?t|do not)\s+want\s+(a\s+)?(photo|picture|image)\b/i.test(messageText)
  );
}

export function extractBareColorAnswer(
  text: string,
  catalogColors: string[] | null | undefined
): string | null {
  if (!text?.trim()) return null;
  if (looksLikeShowOrPhotoAsk(text) || isAvailabilityQuestion(text)) return null;
  const colors = (catalogColors || []).filter((c) => typeof c === 'string' && c.trim());
  if (!colors.length) return null;
  return extractColorFromUserText(text, colors);
}

const SIZE_ALIAS_GROUPS: ReadonlyArray<{ aliases: string[] }> = [
  { aliases: ['xs', 'xxs'] },
  { aliases: ['s', 'small', 'صغير', 'الصغير'] },
  { aliases: ['m', 'medium', 'وسط', 'الوسط', 'متوسط'] },
  { aliases: ['l', 'large', 'كبير', 'الكبير'] },
  { aliases: ['xl', 'xxl', 'xxxl'] },
];

function normalizeSizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/^ال/, '');
}

function stripSelectionPadding(text: string): string {
  return text
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/لو سمحت|من فضلك|please|thanks|thank you|شكرا(?:ً| لك)?/gi, ' ')
    .replace(/\b(?:بدي|بغي|أبي|ابي|أبغى|ابغى|أريد|اريد|أبا|ابا)\b/gi, ' ')
    .replace(/\b(?:اللون|لون|المقاس|مقاس|سايز|size|color)\b/gi, ' ')
    .replace(/[?!؟.,،]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractBareSizeAnswer(
  text: string,
  catalogSizes: string[] | null | undefined
): string | null {
  if (!text?.trim()) return null;
  if (looksLikeShowOrPhotoAsk(text) || isAvailabilityQuestion(text)) return null;
  const padded = stripSelectionPadding(text);
  if (!padded || padded.split(/\s+/).length > 3) return null;
  const sizes = (catalogSizes || []).map((s) => String(s).trim()).filter(Boolean);
  const token = normalizeSizeToken(padded);
  for (const size of sizes) {
    if (normalizeSizeToken(size) === token) return size;
  }
  for (const group of SIZE_ALIAS_GROUPS) {
    if (!group.aliases.some((alias) => normalizeSizeToken(alias) === token)) continue;
    const hit = sizes.find((size) =>
      group.aliases.some(
        (alias) => normalizeSizeToken(size) === normalizeSizeToken(alias)
      )
    );
    if (hit) return hit;
  }
  if (
    sizes.length === 0 &&
    (/^\d{1,3}$/.test(padded) || /^(?:ال)?(?:وسط|صغير|كبير)$/.test(padded))
  ) {
    return padded;
  }
  if (sizes.length && /^\d{1,3}$/.test(padded)) {
    return sizes.includes(padded) ? padded : null;
  }
  return null;
}

export function isAnsweringPendingVariant(opts: {
  pending: PendingBotQuestionKind;
  userMessage: string;
  catalogColors?: string[] | null;
  catalogSizes?: string[] | null;
}): boolean {
  if (opts.pending === 'color') {
    return Boolean(extractBareColorAnswer(opts.userMessage, opts.catalogColors));
  }
  if (opts.pending === 'size') {
    return Boolean(extractBareSizeAnswer(opts.userMessage, opts.catalogSizes));
  }
  return false;
}

export type PendingVariantResolution =
  | { kind: 'select'; color?: string; size?: string }
  | { kind: 'unavailable'; rejected: string }
  | { kind: 'fallthrough' };

/**
 * Interpret the current message against a pending color/size question.
 * Selection / unavailable consume the pending state; fallthrough clears it too.
 */
export function resolvePendingVariantAnswer(opts: {
  pending: PendingBotQuestionKind;
  userMessage: string;
  product: Product;
}): PendingVariantResolution {
  const { pending, userMessage, product } = opts;
  if (looksLikeShowOrPhotoAsk(userMessage) || isAvailabilityQuestion(userMessage)) {
    return { kind: 'fallthrough' };
  }

  if (pending === 'color') {
    const colors = product.colors || [];
    const selected = extractBareColorAnswer(userMessage, colors);
    if (selected) return { kind: 'select', color: selected };

    // A color token exists in the message but not on this product's catalog.
    const anyColor = extractColorFromText(userMessage);
    if (anyColor && colors.length > 0 && !isColorInProductCatalog(anyColor, colors)) {
      return { kind: 'unavailable', rejected: anyColor };
    }
    return { kind: 'fallthrough' };
  }

  if (pending === 'size') {
    const selected = extractBareSizeAnswer(userMessage, product.sizes);
    if (selected) return { kind: 'select', size: selected };
    return { kind: 'fallthrough' };
  }

  return { kind: 'fallthrough' };
}
