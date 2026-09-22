/**
 * Deterministic identity-field collection (name → phone → address).
 *
 * WHY: the LLM freely reorders or repeats questions («شو عنوانك؟» after name).
 * Code owns which field is asked next and the template text.
 */
import type { Language } from '../../core/types.js';

export const IDENTITY_FIELD_ORDER = ['name', 'phone', 'address'] as const;
export type IdentityField = (typeof IDENTITY_FIELD_ORDER)[number];

export type IdentitySnapshot = {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
};

function hasIdentityValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return false;
    if (/^(null|undefined|n\/a|none|unknown|-)$/i.test(t)) return false;
    return true;
  }
  return true;
}

/** First missing identity field in fixed order, or null when all present. */
export function firstMissingIdentityField(
  info: IdentitySnapshot | null | undefined
): IdentityField | null {
  const snap = info || {};
  for (const field of IDENTITY_FIELD_ORDER) {
    if (!hasIdentityValue(snap[field])) return field;
  }
  return null;
}

/** All missing identity fields in order (for completeness lists). */
export function missingIdentityFields(
  info: IdentitySnapshot | null | undefined
): IdentityField[] {
  const snap = info || {};
  return IDENTITY_FIELD_ORDER.filter((field) => !hasIdentityValue(snap[field]));
}

const ASK_AR: Record<IdentityField, string> = {
  name: 'تمام، شو اسمك الكامل؟',
  phone: 'تمام، شو رقم هاتفك؟',
  address: 'تمام، شو عنوان التوصيل؟',
};

const ASK_EN: Record<IdentityField, string> = {
  name: 'Got it — what is your full name?',
  phone: 'Got it — what is your phone number?',
  address: 'Got it — what is the delivery address?',
};

/** Single-question template for the next identity field. */
export function buildIdentityCollectMessage(
  language: Language,
  field: IdentityField
): string {
  return language === 'arabic' ? ASK_AR[field] : ASK_EN[field];
}

/**
 * When identity is incomplete, replace free-form LLM copy with the template
 * for the first missing field so answered questions are never repeated.
 */
export function resolveIdentityCollectReply(input: {
  language: Language;
  collected: IdentitySnapshot;
  responseText: string;
}): { missing: IdentityField[]; replyText: string; complete: boolean } {
  const missing = missingIdentityFields(input.collected);
  if (missing.length === 0) {
    return { missing, replyText: input.responseText, complete: true };
  }
  return {
    missing,
    replyText: buildIdentityCollectMessage(input.language, missing[0]),
    complete: false,
  };
}

/**
 * When the last bot message asked for a specific identity field via our template,
 * treat the user reply as that field's value.
 * WHY: LLM often omits extracted_info.address while upselling in free text (S10).
 *
 * When name+phone already exist and only address is missing, bind the reply to
 * address even if the bot paraphrased the ask (live paraphrase expansions).
 */
export function ingestIdentityAnswerFromBotAsk(input: {
  lastBotReply: string;
  userMessage: string;
  collected: IdentitySnapshot;
  /** When true, do not fill identity from this message (dispute / non-answer). */
  blockIngest?: boolean;
}): IdentitySnapshot {
  if (input.blockIngest) return { ...input.collected };
  const msg = (input.userMessage || '').trim();
  if (!msg) return { ...input.collected };

  const next: IdentitySnapshot = { ...input.collected };
  const bot = input.lastBotReply || '';
  const missing = firstMissingIdentityField(next);

  const askedName =
    /شو اسمك الكامل|what is your full name|اسمك الكامل/i.test(bot) &&
    !hasIdentityValue(next.name);
  const askedPhone =
    /شو رقم هاتفك|what is your phone number|رقم هاتف/i.test(bot) &&
    !hasIdentityValue(next.phone);
  const askedAddress =
    /شو عنوان التوصيل|what is the delivery address|عنوان التوصيل|عنوانك/i.test(bot) &&
    !hasIdentityValue(next.address);

  if (askedAddress) next.address = msg;
  else if (askedPhone) next.phone = msg;
  else if (askedName) next.name = msg;
  else if (
    missing === 'address' &&
    msg.length >= 4 &&
    // Never treat a phone-number reply as an address (S10: «09552222» after name).
    !/^\+?\d[\d\s-]{6,}$/.test(msg) &&
    !/هاتف|phone/i.test(bot) &&
    !/^(نعم|لا|أيوه|ايوه|أكد|اكد|ok|yes|no)$/i.test(msg)
  ) {
    // Last identity slot — only when the bot is not asking for phone.
    next.address = msg;
  }

  return next;
}

/** True when this turn is filling an identity slot (blocks false asks_product_info). */
export function isAnsweringIdentityTurn(input: {
  lastBotReply: string;
  collectedBeforeIngest: IdentitySnapshot;
  userMessage?: string;
}): boolean {
  const missing = firstMissingIdentityField(input.collectedBeforeIngest);
  const msg = (input.userMessage || '').trim();
  // Phone digit replies while address is "missing" are phone answers, not address.
  if (missing === 'address' && msg && !/^\+?\d[\d\s-]{6,}$/.test(msg)) return true;
  if (missing === 'phone' || missing === 'name') {
    return /شو اسمك|شو رقم هاتف|اسمك|هاتفك|full name|phone number/i.test(
      input.lastBotReply || ''
    );
  }
  return /شو اسمك|شو رقم هاتف|شو عنوان|عنوان التوصيل|عنوانك|full name|phone number|delivery address/i.test(
    input.lastBotReply || ''
  );
}
