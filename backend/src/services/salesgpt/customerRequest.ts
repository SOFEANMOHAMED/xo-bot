/**
 * Structured customer-request signals from the sales model.
 *
 * Code may:
 *   - normalize/coerce the schema
 *   - enforce money/safety rails using these flags
 *   - fall back when the model omits the block entirely
 *   - gate unreliable flags against the user utterance (same pattern as
 *     wants_add_another → detectsAddAnotherIntent): wants_alternatives alone
 *     must not invent cross-sells on a specific product Q&A turn.
 */

export interface CustomerRequestSignals {
  /** Customer wants other products / alternatives / "what else". */
  wantsAlternatives: boolean;
  /** Customer wants product details / specs / description. */
  asksProductInfo: boolean;
  /** Customer explicitly wants a product photo. */
  wantsPhoto: boolean;
  /**
   * Customer is affirming order placement (yes/confirm).
   * Never sufficient alone to persist ORDER_DATA — orderConfirmationPolicy still gates.
   */
  readyToConfirm: boolean;
  /**
   * Customer wants to add another product to the cart (not finalize yet).
   * Code locks the current draft into cart; model must not invent cart JSON.
   */
  wantsAddAnother: boolean;
}

export const EMPTY_CUSTOMER_REQUEST: CustomerRequestSignals = {
  wantsAlternatives: false,
  asksProductInfo: false,
  wantsPhoto: false,
  readyToConfirm: false,
  wantsAddAnother: false
};

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes';
  }
  return false;
}

/**
 * Coerce model JSON (camelCase or snake_case) into a safe signal object.
 * Missing/invalid block → all false (conservative).
 */
export function normalizeCustomerRequest(raw: unknown): CustomerRequestSignals {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_CUSTOMER_REQUEST };
  }
  const o = raw as Record<string, unknown>;
  return {
    wantsAlternatives: asBool(o.wants_alternatives ?? o.wantsAlternatives),
    asksProductInfo: asBool(o.asks_product_info ?? o.asksProductInfo),
    wantsPhoto: asBool(o.wants_photo ?? o.wantsPhoto),
    readyToConfirm: asBool(o.ready_to_confirm ?? o.readyToConfirm),
    wantsAddAnother: asBool(o.wants_add_another ?? o.wantsAddAnother)
  };
}

/** True when the model returned an explicit customer_request object (even if all false). */
export function hasCustomerRequestBlock(raw: unknown): boolean {
  return !!raw && typeof raw === 'object';
}

/**
 * Customer explicitly asked for alternatives / something else.
 * Model `wants_alternatives` alone is not trusted (volunteers upsells on price Qs).
 */
export function detectsWantsAlternativesIntent(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  const t = messageText.trim();
  return (
    /(بديل|بدائل|خيارات\s*أخرى|خيارات\s*اخرى)/i.test(t) ||
    /(غير\s*هاد|غير\s*هذا|غير\s*هيك|شي\s*تاني|شيء\s*(ثاني|تاني)|حاجة\s*تانية)/i.test(t) ||
    /(عندك\s*(شي|شيء|حاجة)?\s*(تاني|ثاني|غيرها)|في\s*(شي|شيء)\s*(تاني|ثاني))/i.test(t) ||
    /\b(anything\s+else|something\s+else|other\s+options?|alternatives?|what\s+else)\b/i.test(t)
  );
}

/**
 * Drop volunteer cross-sell sentences («عندنا كمان…» / «عندنا ساعة كمان…»).
 * Phrase-level only — pair with stripUnsolicitedCrossSellMentions for catalog names.
 */
export function stripUnsolicitedAlternativeSuggestions(replyText: string): string {
  if (!replyText?.trim()) return replyText;
  const cleaned = replyText
    // «عندنا كمان…» or «عندنا ساعة كمان…»
    .replace(
      /[^.!?\n]*?(?:إذا\s*حابب،?\s*)?عندنا\s+(?:\S[\s\S]{0,40}?\s+)?كمان[^.!?\n]*[.!?؟]?\s*/gi,
      ''
    )
    // «حابب أذكرك إنه عندنا…»
    .replace(
      /[^.!?\n]*?(?:حابب|احب|أحب)\s*أ?ذكرك[^.!?\n]*[.!?؟]?\s*/gi,
      ''
    )
    .replace(
      /[^.!?\n]*?\b(?:we\s+also\s+have|also\s+available|if\s+you(?:'d| would)\s+like[,.]?\s*we\s+(?:also\s+)?have)\b[^.!?\n]*[.!?]?\s*/gi,
      ''
    )
    .replace(
      /[^.!?\n]*?\bbefore\s+i\s+(?:complete|finish)\s+your\s+order[^.!?\n]*[.!?]?\s*/gi,
      ''
    )
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return cleaned || replyText.trim();
}

function normalizeProductNameToken(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function mentionMatchesProduct(haystack: string, productName: string): boolean {
  const needle = normalizeProductNameToken(productName);
  if (needle.length < 2) return false;
  const hay = normalizeProductNameToken(haystack);
  if (!hay) return false;
  // Whole-token match avoids «سا» inside unrelated words; Arabic has no \b.
  if (needle.length <= 3) {
    return new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:\\s|$)`).test(hay);
  }
  return hay.includes(needle);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitReplySentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?؟\n])/);
  return parts.filter((part) => part.length > 0);
}

function isNameCoveredByActive(name: string, activeNames: string[]): boolean {
  const n = normalizeProductNameToken(name);
  if (!n) return true;
  return activeNames.some((active) => {
    const a = normalizeProductNameToken(active);
    if (!a) return false;
    return a === n || a.includes(n) || n.includes(a);
  });
}

export type StripCrossSellMentionsInput = {
  replyText: string;
  activeProductNames: string[];
  otherProductNames: string[];
  language: 'arabic' | 'english';
};

/**
 * Catalog-aware gate: drop sentences that name a non-active product when the
 * customer did not ask for alternatives. Orphan fluff after an upsell pitch
 * (no active product name) is dropped too.
 */
export function stripUnsolicitedCrossSellMentions(
  input: StripCrossSellMentionsInput
): string {
  const replyText = input.replyText || '';
  if (!replyText.trim()) return replyText;

  const activeNames = (input.activeProductNames || [])
    .map((n) => n.trim())
    .filter(Boolean);
  const forbiddenNames = (input.otherProductNames || [])
    .map((n) => n.trim())
    .filter((n) => n.length >= 2)
    .filter((n) => !isNameCoveredByActive(n, activeNames));

  if (forbiddenNames.length === 0) {
    return stripUnsolicitedAlternativeSuggestions(replyText);
  }

  const phraseCleaned = stripUnsolicitedAlternativeSuggestions(replyText);
  const sentences = splitReplySentences(phraseCleaned);
  const hasForbiddenAnywhere = sentences.some((s) =>
    forbiddenNames.some((name) => mentionMatchesProduct(s, name))
  );

  if (!hasForbiddenAnywhere) return phraseCleaned.trim() || replyText.trim();

  const kept = sentences.filter((sentence) => {
    if (forbiddenNames.some((name) => mentionMatchesProduct(sentence, name))) {
      return false;
    }
    if (activeNames.some((name) => mentionMatchesProduct(sentence, name))) {
      return true;
    }
    // Orphan sentence while an off-focus SKU was pitched → drop.
    return false;
  });

  const cleaned = kept
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (cleaned) return cleaned;

  return input.language === 'arabic'
    ? 'تمام، نكمّل طلب المنتج اللي اخترته. شو بتحتاج بخصوصه؟'
    : "Alright, let's continue with the product you chose. What else do you need for it?";
}
