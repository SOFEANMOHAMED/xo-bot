/**
 * Deterministic identity-field collection (name → phone → address).
 *
 * Policy:
 * - All three missing → one bundle message.
 * - Two missing → one message listing both missing fields.
 * - One missing → single-field template.
 * Code owns templates so the LLM cannot reorder or invent asks.
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

const FIELD_LABEL_AR: Record<IdentityField, string> = {
  name: 'اسمك الكامل',
  phone: 'رقم هاتفك',
  address: 'عنوان التوصيل',
};

/** Cues that a bot reply is asking for a given identity field (template or free-form LLM). */
const IDENTITY_ASK_CUES: Record<IdentityField, RegExp> = {
  name: /اسمك|باسمك|full name|your name|what is your name/i,
  phone: /هاتفك|رقم هاتف|phone number|your phone/i,
  address: /عنوان التوصيل|عنوانك|delivery address|your address|shipping address/i,
};

/**
 * Which identity fields the last bot reply appears to ask for.
 * Used so free-form LLM asks («باسمك ورقم هاتفك وعنوانك») are treated as a
 * bundle — not as a single phone/address slot that swallows the customer's name.
 */
export function identityFieldsAskedInBotReply(lastBotReply: string): IdentityField[] {
  const bot = lastBotReply || '';
  if (!bot.trim()) return [];
  return IDENTITY_FIELD_ORDER.filter((field) => IDENTITY_ASK_CUES[field].test(bot));
}

const FIELD_LABEL_EN: Record<IdentityField, string> = {
  name: 'your full name',
  phone: 'your phone number',
  address: 'the delivery address',
};

/** First-time ask when name+phone+address are all missing. */
export const IDENTITY_BUNDLE_ASK_AR =
  'تمام، لإكمال الطلب أحتاج اسمك الكامل ورقم هاتفك وعنوان التوصيل.';
export const IDENTITY_BUNDLE_ASK_EN =
  'Got it — to complete the order I need your full name, phone number, and delivery address.';

export function buildIdentityBundleAskMessage(language: Language): string {
  return language === 'english' ? IDENTITY_BUNDLE_ASK_EN : IDENTITY_BUNDLE_ASK_AR;
}

/** Ask for exactly the given missing identity fields (1–3). */
export function buildIdentityPartialBundleAsk(
  language: Language,
  missing: IdentityField[]
): string {
  if (missing.length === 0) return '';
  if (missing.length === 3) return buildIdentityBundleAskMessage(language);
  if (missing.length === 1) return buildIdentityCollectMessage(language, missing[0]);

  if (language === 'english') {
    const labels = missing.map((f) => FIELD_LABEL_EN[f]);
    return `Got it — to complete the order I still need ${labels[0]} and ${labels[1]}.`;
  }
  const labels = missing.map((f) => FIELD_LABEL_AR[f]);
  return `تمام، لإكمال الطلب أحتاج كمان ${labels[0]} و${labels[1]}.`;
}

/** True when the last bot reply asks for two or more identity fields (template or free-form). */
export function isBotIdentityBundleAsk(lastBotReply: string): boolean {
  if (!lastBotReply?.trim()) return false;
  if (
    /لإكمال الطلب أحتاج اسمك الكامل ورقم هاتفك وعنوان التوصيل/i.test(lastBotReply) ||
    /to complete the order I need your full name, phone number, and delivery address/i.test(
      lastBotReply
    ) ||
    /لإكمال الطلب أحتاج كمان /i.test(lastBotReply) ||
    /to complete the order I still need /i.test(lastBotReply)
  ) {
    return true;
  }
  // Free-form LLM asks that mention 2+ identity fields must not be treated as a
  // single phone/address slot (that path binds the whole reply to one field).
  return identityFieldsAskedInBotReply(lastBotReply).length >= 2;
}

/** Single-question template for one missing identity field. */
export function buildIdentityCollectMessage(
  language: Language,
  field: IdentityField
): string {
  return language === 'arabic' ? ASK_AR[field] : ASK_EN[field];
}

/**
 * Ask template for current gaps:
 * - 3 missing → full bundle
 * - 2 missing → partial bundle (both fields)
 * - 1 missing → single-field ask
 */
export function buildIdentityAskForCollected(
  language: Language,
  collected: IdentitySnapshot
): string | null {
  const missing = missingIdentityFields(collected);
  if (missing.length === 0) return null;
  return buildIdentityPartialBundleAsk(language, missing);
}

/**
 * When identity is incomplete, replace free-form LLM copy with the owned template.
 * Live SSOT for identity collect reply text.
 */
export function resolveIdentityCollectReply(input: {
  language: Language;
  collected: IdentitySnapshot;
  responseText?: string;
}): { missing: IdentityField[]; replyText: string; complete: boolean } {
  const missing = missingIdentityFields(input.collected);
  if (missing.length === 0) {
    return { missing, replyText: input.responseText || '', complete: true };
  }
  const replyText =
    buildIdentityAskForCollected(input.language, input.collected) ||
    input.responseText ||
    '';
  return { missing, replyText, complete: false };
}

/**
 * When the last bot message asked for identity (bundle or single field),
 * bind the user reply via structural parse + asked-slot fallback.
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
  const bundleAsk = isBotIdentityBundleAsk(bot);

  // Prefer structural multi-field parse whenever a phone token is present.
  const parsed = parseIdentityFieldsFromMessage(msg);
  const hasMulti =
    (hasIdentityValue(parsed.phone) &&
      (hasIdentityValue(parsed.name) || hasIdentityValue(parsed.address))) ||
    (hasIdentityValue(parsed.name) && hasIdentityValue(parsed.address));

  if (hasMulti || (hasIdentityValue(parsed.phone) && !isPhoneOnlyMessage(msg))) {
    next = mergeIdentitySnapshot(next, parsed);
    return next;
  }

  if (bundleAsk) {
    if (isPhoneOnlyMessage(msg) && !hasIdentityValue(next.phone)) {
      next.phone = msg;
      return next;
    }
    const tokens = msg.split(/\s+/).filter(Boolean).length;
    if (!hasIdentityValue(next.name) && tokens > 0 && tokens <= 4 && !isPhoneOnlyMessage(msg)) {
      next.name = msg;
      return next;
    }
    // Name already present (prior turn or this-turn extract): long free text can be address.
    // Never bind the same short name blob as address.
    if (
      hasIdentityValue(next.name) &&
      !hasIdentityValue(next.address) &&
      tokens > 4 &&
      next.name !== msg &&
      !isPhoneOnlyMessage(msg)
    ) {
      next.address = msg;
    }
    return next;
  }

  const asked = botAskedIdentityField(bot);

  if (asked === 'address' && !hasIdentityValue(next.address)) {
    // Never treat a phone-number reply as an address (S10: «09552222» after name).
    if (!isPhoneOnlyMessage(msg)) next.address = msg;
    else if (!hasIdentityValue(next.phone)) next.phone = msg;
  } else if (asked === 'phone' && !hasIdentityValue(next.phone)) {
    if (hasIdentityValue(parsed.phone)) next.phone = parsed.phone;
    else next.phone = msg;
  } else if (asked === 'name' && !hasIdentityValue(next.name)) {
    // Single-field name answer (no phone token in message).
    next.name = msg;
  } else if (
    missing === 'address' &&
    msg.length >= 4 &&
    !isPhoneOnlyMessage(msg) &&
    !/هاتف|phone/i.test(bot) &&
    !/^(نعم|لا|أيوه|ايوه|أكد|اكد|ok|yes|no)$/i.test(msg)
  ) {
    next.address = msg;
  } else if (missing === 'phone' && isPhoneOnlyMessage(msg)) {
    next.phone = msg;
  }

  return next;
}

/** Which single-field identity ask the last bot reply targeted, if any. */
export function botAskedIdentityField(lastBotReply: string): IdentityField | null {
  const bot = lastBotReply || '';
  // Bundle / multi-field ask is not a single-field ask.
  if (isBotIdentityBundleAsk(bot)) return null;
  const cues = identityFieldsAskedInBotReply(bot);
  if (cues.length === 1) return cues[0];
  return null;
}

/** True when this turn is filling an identity slot (blocks false asks_product_info). */
export function isAnsweringIdentityTurn(input: {
  lastBotReply: string;
  collectedBeforeIngest: IdentitySnapshot;
  userMessage?: string;
}): boolean {
  if (isBotIdentityBundleAsk(input.lastBotReply) || botAskedIdentityField(input.lastBotReply)) {
    const msg = (input.userMessage || '').trim();
    if (!msg) return false;
    if (/^(نعم|لا|أيوه|ايوه|أكد|اكد|ok|yes|no)$/i.test(msg)) return false;
    return true;
  }
  const missing = firstMissingIdentityField(input.collectedBeforeIngest);
  const msg = (input.userMessage || '').trim();
  if (missing === 'address' && msg && !/^\+?\d[\d\s-]{6,}$/.test(msg)) return true;
  if (missing === 'phone' || missing === 'name') {
    return /شو اسمك|شو رقم هاتف|اسمك|هاتفك|full name|phone number|أحتاج كمان|I still need/i.test(
      input.lastBotReply || ''
    );
  }
  return /شو اسمك|شو رقم هاتف|شو عنوان|عنوان التوصيل|عنوانك|full name|phone number|delivery address|لإكمال الطلب أحتاج/i.test(
    input.lastBotReply || ''
  );
}

/** True when proposed identity text is a span of the user utterance (no invented PII). */
function identityValueGroundedInMessage(proposed: string, userMessage: string): boolean {
  const value = proposed.trim();
  const msg = userMessage.trim();
  if (!value || !msg) return false;
  if (msg === value) return true;
  if (msg.includes(value)) return true;
  return false;
}

function identityValuesEquivalent(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * Gate for LLM `extracted_info` identity fields.
 *
 * Accepts only when the proposed value is grounded in the current user message
 * (no invented PII), and either:
 * - the deterministic identity ingest would also write that field this turn, or
 * - we are in an identity-answer turn and the value is a grounded field span
 *   (allows LLM to split name/address better than structural phone parse alone).
 *
 * Closes the hole where free-form model extraction treats a shipping /
 * product question as a customer name without a real identity answer.
 */
export function mayAcceptLlmIdentityField(opts: {
  field: IdentityField;
  proposed: unknown;
  userMessage: string;
  lastBotReply: string;
  collected: IdentitySnapshot;
  blockIngest?: boolean;
}): boolean {
  if (!hasIdentityValue(opts.proposed)) return false;
  const proposed = String(opts.proposed).trim();
  const userMessage = (opts.userMessage || '').trim();
  if (!userMessage) return false;
  if (!identityValueGroundedInMessage(proposed, userMessage)) return false;

  // Probe with the field cleared so we ask: would ingest write it from this message?
  const probe: IdentitySnapshot = {
    name: opts.field === 'name' ? null : opts.collected.name,
    phone: opts.field === 'phone' ? null : opts.collected.phone,
    address: opts.field === 'address' ? null : opts.collected.address,
  };
  const ingested = ingestIdentityAnswerFromBotAsk({
    lastBotReply: opts.lastBotReply || '',
    userMessage,
    collected: probe,
    blockIngest: opts.blockIngest,
  });
  const accepted = ingested[opts.field];
  if (hasIdentityValue(accepted) && identityValuesEquivalent(String(accepted), proposed)) {
    return true;
  }

  // Outside an identity-answer turn, only the deterministic ingest may write identity.
  if (
    !isAnsweringIdentityTurn({
      lastBotReply: opts.lastBotReply || '',
      collectedBeforeIngest: opts.collected,
      userMessage,
    })
  ) {
    return false;
  }

  // Identity turn + grounded span: allow LLM refinement, but never bind the
  // entire free-form utterance as a name when ingest refused (shipping Q, etc.).
  if (opts.field === 'phone') {
    return PHONE_TOKEN_RE.test(proposed) || isPhoneOnlyMessage(proposed);
  }
  if (opts.field === 'name') {
    if (proposed === userMessage) return false;
    const tokens = proposed.split(/\s+/).filter(Boolean).length;
    return tokens >= 1 && tokens <= 6 && !isPhoneOnlyMessage(proposed);
  }
  // address
  if (isPhoneOnlyMessage(proposed)) return false;
  return proposed.length >= 4;
}
