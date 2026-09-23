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

/** Digit run long enough to be a phone (not a short qty / house number alone). */
const PHONE_TOKEN_RE = /\+?\d[\d\s-]{5,}\d/;

function isPhoneOnlyMessage(msg: string): boolean {
  return /^\+?\d[\d\s-]{6,}$/.test(msg.trim());
}

/**
 * Split a multi-field identity blob into name / phone / address.
 * WHY: customers often paste «اسم رقم عنوان» in one reply while the bot asked
 * for a single field; dumping the whole string into that slot re-asks nothing
 * useful and loses the other fields (PHASE 2H).
 * Structural only (phone = digit run) — no new keyword lists.
 */
export function parseIdentityFieldsFromMessage(messageText: string): IdentitySnapshot {
  const msg = (messageText || '').trim();
  if (!msg) return {};

  if (isPhoneOnlyMessage(msg)) {
    return { phone: msg.replace(/\s+/g, ' ').trim() };
  }

  const phoneMatch = msg.match(PHONE_TOKEN_RE);
  if (!phoneMatch || phoneMatch.index === undefined) {
    // No phone token — caller binds the whole string to the asked slot.
    return {};
  }

  const phone = phoneMatch[0].replace(/\s+/g, ' ').trim();
  const before = msg.slice(0, phoneMatch.index).trim();
  const after = msg.slice(phoneMatch.index + phoneMatch[0].length).trim();

  const out: IdentitySnapshot = { phone };
  if (before) out.name = before;
  if (after) out.address = after;
  return out;
}

function mergeIdentitySnapshot(
  base: IdentitySnapshot,
  patch: IdentitySnapshot
): IdentitySnapshot {
  const next: IdentitySnapshot = { ...base };
  if (hasIdentityValue(patch.name) && !hasIdentityValue(next.name)) {
    next.name = patch.name;
  }
  if (hasIdentityValue(patch.phone) && !hasIdentityValue(next.phone)) {
    next.phone = patch.phone;
  }
  if (hasIdentityValue(patch.address) && !hasIdentityValue(next.address)) {
    next.address = patch.address;
  }
  return next;
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

  let next: IdentitySnapshot = { ...input.collected };
  const bot = input.lastBotReply || '';
  const missing = firstMissingIdentityField(next);

  // Prefer structural multi-field parse whenever a phone token is present —
  // even if the bot asked for only one field.
  const parsed = parseIdentityFieldsFromMessage(msg);
  const hasMulti =
    (hasIdentityValue(parsed.phone) &&
      (hasIdentityValue(parsed.name) || hasIdentityValue(parsed.address))) ||
    (hasIdentityValue(parsed.name) && hasIdentityValue(parsed.address));

  if (hasMulti || (hasIdentityValue(parsed.phone) && !isPhoneOnlyMessage(msg))) {
    next = mergeIdentitySnapshot(next, parsed);
    // If parse found phone+address but no name, do not stuff the blob into name.
    return next;
  }

  const askedName =
    /شو اسمك الكامل|what is your full name|اسمك الكامل/i.test(bot) &&
    !hasIdentityValue(next.name);
  const askedPhone =
    /شو رقم هاتفك|what is your phone number|رقم هاتف/i.test(bot) &&
    !hasIdentityValue(next.phone);
  const askedAddress =
    /شو عنوان التوصيل|what is the delivery address|عنوان التوصيل|عنوانك/i.test(bot) &&
    !hasIdentityValue(next.address);

  if (askedAddress) {
    // Never treat a phone-number reply as an address (S10: «09552222» after name).
    if (!isPhoneOnlyMessage(msg)) next.address = msg;
    else if (!hasIdentityValue(next.phone)) next.phone = msg;
  } else if (askedPhone) {
    if (hasIdentityValue(parsed.phone)) next.phone = parsed.phone;
    else next.phone = msg;
  } else if (askedName) {
    // Single-field name answer (no phone token in message).
    next.name = msg;
  } else if (
    missing === 'address' &&
    msg.length >= 4 &&
    !isPhoneOnlyMessage(msg) &&
    !/هاتف|phone/i.test(bot) &&
    !/^(نعم|لا|أيوه|ايوه|أكد|اكد|ok|yes|no)$/i.test(msg)
  ) {
    // Last identity slot — only when the bot is not asking for phone.
    next.address = msg;
  } else if (missing === 'phone' && isPhoneOnlyMessage(msg)) {
    next.phone = msg;
  }
  // WHY no bare `missing === 'name'` fill: browse phrases («بدي الحذاء»، «في موبايلات»)
  // must not become the customer name unless the bot actually asked for the name.

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
