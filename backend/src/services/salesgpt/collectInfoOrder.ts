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
