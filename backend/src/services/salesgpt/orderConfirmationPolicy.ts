/**
 * Single source of truth for order confirmation across all channels.
 *
 * Semantics (intentional split — do not merge):
 * - `await_confirmation`: fields are complete; show summary and wait for explicit customer yes.
 * - `confirm_order`: customer has affirmed (or declined upsell while complete) → persist ORDER_DATA.
 *
 * Root bug this prevents: AI emitting confirm_order when fields become complete causes
 * ORDER_DATA + conversation reset before the customer says yes; their "اي أكد" then
 * hits the returning-customer greeting path.
 */

import type { Language } from '../../core/types.js';
import {
  browseMediaCaptionFallback,
  isBrowseTurnIntent,
  type TurnIntent,
} from './turnIntent.js';

export const AWAIT_CONFIRMATION_ACTION = 'await_confirmation';
export const CONFIRM_ORDER_ACTION = 'confirm_order';

const AFFIRM_ORDER_TOKENS = [
  'نعم', 'أيوا', 'ايوا', 'أي', 'اي', 'تمام', 'موافق', 'ماشي', 'طيب',
  'أكيد', 'اكيد', 'بالتأكيد', 'اوكي', 'اوكيه', 'ممتاز', 'صح', 'صحيح',
  'ok', 'okay', 'yes', 'yep', 'yeah', 'sure', 'agree', 'agreed', 'correct', 'right'
];

/** Short refusal — valid only when the bot asked to add more items, not to confirm the order. */
const DECLINE_MORE_TOKENS = [
  'لا', 'لأ', 'no', 'nope', 'not', 'لا شكرا', 'لا شكراً', 'no thanks', 'no thank you'
];

/** Explicit order cancellation — never treat as confirm or decline-more. */
const CANCEL_ORDER_TOKENS = [
  'إلغاء', 'الغي', 'الغاء', 'ارفض', 'إرفض', 'cancel', 'reject', 'stop',
  'ما بدي', 'لا بدي', 'ما بدي الطلب', 'لا بدي الطلب', 'cancel order'
];

const CANCEL_ORDER_PATTERNS: RegExp[] = [
  /(الغ|الغي|الغاء|إلغاء)\s*(الطلب|طلبي|اوردر|الأوردر)?/i,
  /(cancel|reject)\s*(the\s+)?(order|my\s+order)?/i,
  /(ما|لا)\s+بدي\s*(الطلب|طلب|اوردر)?/i,
];

const CONFIRM_VERB_PATTERNS: RegExp[] = [
  /(أكد|اكد|أأكد|اؤكد|أؤكد|تأكيد)\s*(الطلب|طلبي|الأوردر)?/i,
  /(بدي|أريد|ابي|عاوز|رح)\s*(أكد|اكد|أأكد|اؤكد|أؤكد|تأكيد)/i,
  /(confirm|place|submit|finalize)\s*(the\s+)?(order|it|my\s+order)?/i
];

/**
 * Customer is asking about the product (description / specs / ingredients / how it works),
 * not confirming a purchase. Soft affirmatives like "تمام" often prefix these questions.
 */
const PRODUCT_INFO_REQUEST_PATTERNS: RegExp[] = [
  /معلومات\s*(اكثر|أكثر|اكتر|اضافيه|إضافية|عن|حول)?/i,
  /تفاصيل\s*(اكثر|أكثر|اكتر|المنتج|عنه|عنها)?/i,
  /وصف\s*(المنتج|كامل|اكثر|أكثر|اكتر)?/i,
  /مواصفات|مكونات|فوائد|طريقة\s*(الاستخدام|الاستعمال)|كيف\s*(يستخدم|يشتغل|يعمل)/i,
  /(عرفني|احكيلي|احكي|قلي|قولي|وضح|اشرح|شرحي)\s*(لي\s*)?(اكثر|أكثر|اكتر|عنه|عنها|عن\s*المنتج)?/i,
  /(اكثر|أكثر|اكتر)\s*(عن|حول|معلومات|تفاصيل|وصف)/i,
  /(اعطيني|عطيني|بدي|أريد|ابي|عاوز)\s*(معلومات|تفاصيل|وصف)/i,
  /more\s+(info|information|details|about)/i,
  /tell\s+me\s+more|what\s+(is|are)\s+(it|this|the\s+product)|how\s+does\s+it\s+work/i,
  /ingredients?|specifications?|description|benefits?/i
];

const ACTIVE_PRODUCT_DESCRIPTION_MAX_CHARS = 3000;

export function normalizeArabic(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[!,.،؟?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAnyToken(text: string, tokens: string[]): boolean {
  const normalized = normalizeArabic(text);
  const normalizedTokens = tokens.map(t => normalizeArabic(t));
  const words = new Set(normalized.split(' '));
  return normalizedTokens.some(token =>
    token.includes(' ')
      ? normalized.includes(token)
      : words.has(token)
  );
}

/** True when the customer is requesting product details / explanation. */
export function isProductInfoRequest(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  const normalized = normalizeArabic(messageText);
  if (PRODUCT_INFO_REQUEST_PATTERNS.some(p => p.test(messageText) || p.test(normalized))) {
    return true;
  }
  // Short question about "the product" / "it" without order verbs
  const asksQuestion = /[؟?]/.test(messageText) || /\b(what|how|why|which)\b/i.test(messageText);
  const aboutProduct =
    /(المنتج|هذا|هيدا|هاي|عنه|عنها|this|it|product)/i.test(messageText);
  const orderVerb =
    /(طلب|اوردر|أوردر|اشتري|شراء|confirm|order|buy)/i.test(messageText);
  return asksQuestion && aboutProduct && !orderVerb;
}

/**
 * Strip HTML / excess whitespace so long merchant descriptions are safe in prompts.
 */
export function sanitizeProductDescriptionForPrompt(
  raw: string,
  maxChars: number = ACTIVE_PRODUCT_DESCRIPTION_MAX_CHARS
): string {
  const cleaned = String(raw || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars).trim()}…`;
}

/** Permissive yes / confirm detection ("اي اكد", "نعم", "ok", …). Bare «لا» is never affirmation. */
export function customerAffirmsOrder(messageText: string): boolean {
  if (!messageText) return false;
  if (customerCancelsOrder(messageText)) return false;
  if (isProductInfoRequest(messageText)) return false;
  const normalized = normalizeArabic(messageText);
  if (/^(لا|لأ|no|nope|not)$/i.test(normalized)) return false;
  if (containsAnyToken(messageText, AFFIRM_ORDER_TOKENS)) return true;
  return CONFIRM_VERB_PATTERNS.some((p) => p.test(messageText));
}

/** @deprecated Use customerAffirmsOrder */
export const isAffirmativeReply = customerAffirmsOrder;

/** Short «no» / decline — only meaningful when bot asked to add more (see resolveOrderNextAction). */
export function customerDeclinesMoreItems(messageText: string): boolean {
  if (!messageText) return false;
  if (customerCancelsOrder(messageText)) return false;
  if (isProductInfoRequest(messageText)) return false;
  if (customerAffirmsOrder(messageText)) return false;
  const normalized = normalizeArabic(messageText);
  if (/^(لا|لأ|no|nope|not|لا\s*شكرا?|no\s*thanks?)$/i.test(normalized.trim())) {
    return true;
  }
  return containsAnyToken(messageText, DECLINE_MORE_TOKENS);
}

/** Explicit order cancellation. */
export function customerCancelsOrder(messageText: string): boolean {
  if (!messageText) return false;
  if (isProductInfoRequest(messageText)) return false;
  if (CANCEL_ORDER_PATTERNS.some((p) => p.test(messageText))) return true;
  return containsAnyToken(messageText, CANCEL_ORDER_TOKENS);
}

export function botReplyAnnouncesConfirmation(text: string): boolean {
  if (!text) return false;
  const normalized = normalizeArabic(text);
  return (
    /تم\s+(تاكيد|تأكيد)\s+(طلبك|الطلب)/.test(normalized) ||
    /تأكدنا|تم\s+تسجيل\s+طلبك/.test(normalized) ||
    /تم\s+استلام\s+طلبك\s+بنجاح/.test(normalized) ||
    /order\s+(has\s+been\s+)?confirmed|order\s+(has\s+been\s+)?placed|your\s+order\s+has\s+been\s+received/i.test(text)
  );
}

/** True when assistant text is still asking the customer to confirm. */
export function botReplyAsksForConfirmation(text: string): boolean {
  if (!text) return false;
  const normalized = normalizeArabic(text);
  const hasQuestionMark = /[؟?]/.test(text);

  const arabicAsk =
    /جاهز\s*(ة)?\s*(للتاكيد|للتأكيد)/i.test(text) ||
    /(هل|ممكن|يمكنني|يمكننا|يمكن|اقدر|أقدر|نقدر|بقدر).{0,40}(تاكيد|تأكيد|أكد|اكد|أأكد|اأكد|اوكد|أوكد)/i.test(normalized) ||
    /(تحب|ترغب|تريد|تود|بدك|تبغى|تبي).{0,25}(تاكيد|تأكيد|أكد|اكد|أؤكد)/i.test(normalized) ||
    (hasQuestionMark && /(تاكيد|تأكيد|أكد|اكد|أأكد|اأكد).{0,25}(الطلب|اوردر|الأوردر)/i.test(normalized));

  const englishAsk =
    /(can|could|shall|may|should)\s+i\s+(confirm|place|finalize)/i.test(text) ||
    /would\s+you\s+like\s+to\s+(confirm|place|finalize)/i.test(text) ||
    /ready\s+to\s+confirm/i.test(text) ||
    (hasQuestionMark && /confirm\s+(your\s+|the\s+)?order/i.test(text));

  if (arabicAsk || englishAsk) return true;
  return false;
}

/** True when the bot asked whether the customer wants to add another product. */
export function botReplyAsksToAddMore(text: string): boolean {
  if (!text) return false;
  const normalized = normalizeArabic(text);
  const hasQuestionMark = /[؟?]/.test(text);

  const arabicAsk =
    /(تريد|تحب|ترغب|تود|بدك|تبغى|تبي|حابب|حاب).{0,35}(اضاف|إضاف|اضيف|منتج|شي|شيء|غير|second|another)/i.test(
      normalized
    ) ||
    /(اضيف|أضيف|نضيف).{0,25}(منتج|شي|شيء)/i.test(normalized) ||
    (hasQuestionMark &&
      /(منتج|شي|شيء).{0,20}(ثاني|آخر|اخر|غير)/i.test(normalized));

  const englishAsk =
    /(add|another|anything|something)\s+(else|more|product|item)/i.test(text) ||
    /would you like (to )?(add|order) (another|more|something else)/i.test(text);

  return arabicAsk || englishAsk;
}

export function buildAmbiguousNoClarification(language: Language): string {
  if (language === 'arabic') {
    return (
      'تمام 👍 هل تقصد إلغاء الطلب أم تعديل شيء؟\n' +
      '• اكتب «نعم» أو «أكد» لتثبيت الطلب\n' +
      '• أو «إلغاء» لإلغاء الطلب'
    );
  }
  return (
    'Got it 👍 Do you want to cancel the order or change something?\n' +
    '• Reply "yes" or "confirm" to place the order\n' +
    '• Or "cancel" to cancel the order'
  );
}

export function buildOrderCancelledMessage(language: Language): string {
  return language === 'arabic'
    ? 'تمام، تم إلغاء الطلب. إذا حابب تكمّل لاحقاً أنا هون 😊'
    : 'Okay, the order was cancelled. If you want to continue later, I am here 😊';
}

export interface OrderCollectedSnapshot {
  name?: string;
  phone?: string;
  address?: string;
  product_name?: string;
  color?: string;
  size?: string;
  quantity?: number;
}

const PLACEHOLDER_COLLECTED_VALUES = new Set([
  'null',
  'undefined',
  'none',
  'n/a',
  'na',
  'nil',
  'unknown',
  '-',
  '—',
  '–',
  'empty'
]);

/** True when a model/JSON field is missing or the literal string "null". */
export function isPlaceholderCollectedValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  const text = String(value).trim();
  if (!text) return true;
  return PLACEHOLDER_COLLECTED_VALUES.has(text.toLowerCase());
}

/** Keep real customer text only — drops JSON-null lookalikes. */
export function sanitizeCollectedText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const text = String(value).trim();
  if (!text || isPlaceholderCollectedValue(text)) return undefined;
  return text;
}

export function sanitizeCollectedSnapshot(
  info: OrderCollectedSnapshot | Record<string, unknown> | null | undefined
): OrderCollectedSnapshot {
  if (!info) return {};
  const quantityRaw = (info as OrderCollectedSnapshot).quantity;
  const quantity =
    typeof quantityRaw === 'number' && quantityRaw > 0
      ? quantityRaw
      : undefined;
  return {
    name: sanitizeCollectedText(info.name),
    phone: sanitizeCollectedText(info.phone),
    address: sanitizeCollectedText(info.address),
    product_name: sanitizeCollectedText(info.product_name),
    color: sanitizeCollectedText(info.color),
    size: sanitizeCollectedText(info.size),
    quantity
  };
}

export function hasRealCustomerIdentity(
  info: OrderCollectedSnapshot | Record<string, unknown> | null | undefined
): boolean {
  const snap = sanitizeCollectedSnapshot(info);
  return Boolean(snap.name && snap.phone && snap.address);
}

/** Assistant copy that jumped to checkout with empty/placeholder fields. */
export function isPrematureCheckoutCopy(text: string): boolean {
  if (!text?.trim()) return false;
  if (botReplyAsksForConfirmation(text) || botReplyAnnouncesConfirmation(text)) {
    return true;
  }
  if (/\bnull\b/i.test(text)) return true;
  return /جاهز\s*(ة)?\s*(للتاكيد|للتأكيد)|طلبك جاهز|ready to confirm/i.test(text);
}

const MISSING_FIELD_LABELS_AR: Record<string, string> = {
  name: 'اسمك',
  phone: 'رقم هاتفك',
  address: 'عنوان التوصيل',
  product_name: 'المنتج',
  product: 'المنتج',
  color: 'اللون',
  size: 'المقاس'
};

const MISSING_FIELD_LABELS_EN: Record<string, string> = {
  name: 'your name',
  phone: 'your phone number',
  address: 'the delivery address',
  product_name: 'the product',
  product: 'the product',
  color: 'the color',
  size: 'the size'
};

export function buildCollectMissingFieldsMessage(
  language: Language,
  missingFields: string[]
): string {
  const first = missingFields.find((field) =>
    ['name', 'phone', 'address', 'product_name', 'product', 'color', 'size'].includes(field)
  ) || missingFields[0] || 'name';
  if (language === 'arabic') {
    const label = MISSING_FIELD_LABELS_AR[first] || 'المعلومة التالية';
    return `تمام! حتى نكمّل الطلب أحتاج ${label} 😊`;
  }
  const label = MISSING_FIELD_LABELS_EN[first] || 'the next detail';
  return `Got it! To continue the order I just need ${label}.`;
}

function displayCollectedText(value: string | undefined): string | undefined {
  return sanitizeCollectedText(value);
}

export function buildOrderConfirmedMessage(
  language: Language,
  info: OrderCollectedSnapshot
): string {
  const snap = sanitizeCollectedSnapshot(info);
  if (language === 'arabic') {
    return `تم تأكيد طلبك${snap.name ? ` يا ${snap.name}` : ''} 🎉 رح نتواصل معك قريباً لترتيب التوصيل.`;
  }
  return `Your order has been confirmed${snap.name ? `, ${snap.name}` : ''}! 🎉 We'll contact you shortly to arrange delivery.`;
}

export function buildAwaitConfirmationMessage(
  language: Language,
  info: OrderCollectedSnapshot,
  /** Optional multi-line cart summary (already formatted with bullets). */
  cartLinesSummary?: string
): string {
  const snap = sanitizeCollectedSnapshot(info);
  const qty = snap.quantity && snap.quantity > 0 ? snap.quantity : 1;
  const productLine = [
    snap.product_name || (language === 'arabic' ? 'المنتج' : 'the product'),
    displayCollectedText(snap.color),
    displayCollectedText(snap.size)
  ].filter(Boolean).join(' — ');

  const itemsBlock =
    cartLinesSummary && cartLinesSummary.trim().length > 0
      ? cartLinesSummary.trim()
      : `• ${productLine} × ${qty}`;

  if (language === 'arabic') {
    const nameBit = snap.name ? ` يا ${snap.name}` : '';
    return (
      `تمام${nameBit}! طلبك جاهز للتأكيد:\n` +
      `${itemsBlock}\n` +
      `• الهاتف: ${snap.phone || '—'}\n` +
      `• العنوان: ${snap.address || '—'}\n\n` +
      `اكتب «نعم» أو «أكد» لتثبيت الطلب الآن.`
    );
  }

  const nameBit = snap.name ? `, ${snap.name}` : '';
  return (
    `Perfect${nameBit}! Your order is ready to confirm:\n` +
    `${itemsBlock}\n` +
    `• Phone: ${snap.phone || '—'}\n` +
    `• Address: ${snap.address || '—'}\n\n` +
    `Reply "yes" or "confirm" to place the order now.`
  );
}

export interface ResolveOrderActionInput {
  aiNextAction: string;
  /** Fields complete after merging this turn's extractions */
  fieldsComplete: boolean;
  /**
   * Fields were already complete before this turn.
   * Prevents treating "تمام + عنوان" (last missing field) as an order confirmation.
   */
  fieldsWereCompleteBeforeTurn: boolean;
  /** Stage 8 / awaiting flag / last bot asked — customer was asked to confirm */
  wasAwaitingConfirmation: boolean;
  userMessage: string;
  language: Language;
  collectedInfo: OrderCollectedSnapshot;
  /** Existing assistant reply from the model (may be replaced). */
  responseText: string;
  /**
   * Model-classified product-info ask (preferred).
   * When omitted, falls back to isProductInfoRequest(userMessage).
   */
  modelAsksProductInfo?: boolean;
  /** Missing identity/product fields after sanitizing placeholders. */
  missingFields?: string[];
  /**
   * Customer picked a color/size after the bot offered a photo (or asked
   * which colour to show). Never treat that as checkout.
   */
  preferSendImage?: boolean;
  /** Pre-formatted cart lines for multi-item await_confirmation summary. */
  cartLinesSummary?: string;
  /**
   * Deterministic turn intent from turnIntent.ts.
   * browse_media / product_qa must never be rewritten to collect_info.
   */
  turnIntent?: 'browse_media' | 'product_qa' | 'cart_edit' | 'checkout' | 'finalize' | 'other';
  /** Last assistant message before this user turn — drives yes/no context. */
  lastBotReply?: string;
}

export interface ResolveOrderActionResult {
  nextAction: string;
  responseText: string;
  awaitingConfirmation: boolean;
  /** Why the action was chosen (for logs). */
  reason: string;
}

/**
 * Resolve whether this turn finalizes the order or only waits for customer confirmation.
 * Channels must treat only `confirm_order` as permission to append ORDER_DATA.
 */
export function resolveOrderNextAction(input: ResolveOrderActionInput): ResolveOrderActionResult {
  const {
    aiNextAction,
    fieldsComplete,
    fieldsWereCompleteBeforeTurn,
    wasAwaitingConfirmation,
    userMessage,
    language,
    collectedInfo,
    responseText,
    modelAsksProductInfo,
    missingFields = [],
    preferSendImage = false,
    cartLinesSummary,
    turnIntent = 'other',
    lastBotReply = '',
  } = input;

  const safeCollected = sanitizeCollectedSnapshot(collectedInfo);
  const identityComplete = hasRealCustomerIdentity(safeCollected);
  const effectivelyComplete = fieldsComplete && identityComplete;
  const botAskedAddMore = botReplyAsksToAddMore(lastBotReply);
  const botAskedConfirm =
    wasAwaitingConfirmation || botReplyAsksForConfirmation(lastBotReply);

  // ── Browse turns win over checkout rails (photo / product Q&A) ──
  if (isBrowseTurnIntent(turnIntent as TurnIntent)) {
    if (turnIntent === 'browse_media') {
      const keepCaption =
        responseText.trim().length > 0 &&
        !isPrematureCheckoutCopy(responseText) &&
        !/أحتاج|احتاج|اسمك|هاتفك|عنوان/i.test(responseText);
      return {
        nextAction: 'send_image',
        responseText: keepCaption
          ? responseText
          : browseMediaCaptionFallback(language),
        awaitingConfirmation: false,
        reason: 'turn_intent_browse_media',
      };
    }
    const safeAction =
      aiNextAction === 'send_image' || aiNextAction === 'end_conversation'
        ? aiNextAction
        : 'present_product';
    return {
      nextAction: safeAction,
      responseText: isPrematureCheckoutCopy(responseText)
        ? (language === 'arabic'
            ? 'أكيد، شو حابب تعرف عن المنتج؟'
            : 'Sure — what would you like to know about the product?')
        : responseText,
      awaitingConfirmation: false,
      reason: 'turn_intent_product_qa',
    };
  }

  // Product Q&A always wins over checkout rails — never inject order summary here.
  // Prefer model classification; heuristic is fallback only when the model omitted the flag.
  const asksProductInfo =
    typeof modelAsksProductInfo === 'boolean'
      ? modelAsksProductInfo
      : isProductInfoRequest(userMessage);

  if (asksProductInfo) {
    const safeAction =
      aiNextAction === 'send_image' || aiNextAction === 'end_conversation'
        ? aiNextAction
        : 'present_product';
    return {
      nextAction: safeAction,
      responseText,
      awaitingConfirmation: wasAwaitingConfirmation && effectivelyComplete,
      reason: 'product_info_request_blocks_checkout'
    };
  }

  const affirms = customerAffirmsOrder(userMessage);
  const declinesMore = customerDeclinesMoreItems(userMessage);
  const cancels = customerCancelsOrder(userMessage);

  if (cancels && effectivelyComplete) {
    return {
      nextAction: 'end_conversation',
      responseText: buildOrderCancelledMessage(language),
      awaitingConfirmation: false,
      reason: 'customer_cancelled_order',
    };
  }

  // «لا» at confirmation ask → clarify once; never auto-confirm.
  if (
    effectivelyComplete &&
    botAskedConfirm &&
    !botAskedAddMore &&
    declinesMore &&
    !affirms
  ) {
    return {
      nextAction: AWAIT_CONFIRMATION_ACTION,
      responseText: buildAmbiguousNoClarification(language),
      awaitingConfirmation: true,
      reason: 'ambiguous_no_at_confirmation',
    };
  }

  const customerWantsFinalize =
    affirms || (declinesMore && botAskedAddMore);

  const allowedToFinalize =
    effectivelyComplete &&
    customerWantsFinalize &&
    (botAskedConfirm || fieldsWereCompleteBeforeTurn || (declinesMore && botAskedAddMore));

  const photoCaptionFallback =
    language === 'arabic'
      ? 'تمام، رح أرسلك صورة هذا الخيار.'
      : 'Sure — I will send a photo of that option.';

  // Color/size after a photo offer is browsing, not checkout.
  if (preferSendImage && !allowedToFinalize) {
    const keepCaption =
      responseText.trim().length > 0 &&
      !isPrematureCheckoutCopy(responseText);
    return {
      nextAction: 'send_image',
      responseText: keepCaption ? responseText : photoCaptionFallback,
      awaitingConfirmation: false,
      reason: 'variant_after_photo_offer'
    };
  }

  // Finalize only after an explicit yes while we were already ready / awaiting.
  if (allowedToFinalize) {
    const safeThanks =
      !responseText.trim() ||
      botReplyAsksForConfirmation(responseText)
        ? buildOrderConfirmedMessage(language, safeCollected)
        : responseText;
    return {
      nextAction: CONFIRM_ORDER_ACTION,
      responseText: safeThanks,
      awaitingConfirmation: false,
      reason: 'customer_finalized_while_ready'
    };
  }

  // Incomplete → never confirm; rewrite leaked checkout copy (including literal "null").
  if (!effectivelyComplete) {
    const triedCheckout =
      aiNextAction === CONFIRM_ORDER_ACTION ||
      aiNextAction === AWAIT_CONFIRMATION_ACTION ||
      aiNextAction === 'close_sale';
    const leakedCheckout = isPrematureCheckoutCopy(responseText);
    if (triedCheckout || leakedCheckout) {
      return {
        nextAction: 'collect_info',
        responseText: leakedCheckout || triedCheckout
          ? buildCollectMissingFieldsMessage(language, missingFields)
          : responseText,
        awaitingConfirmation: false,
        reason: 'incomplete_fields_blocked_confirm'
      };
    }
    return {
      nextAction: aiNextAction,
      responseText,
      awaitingConfirmation: false,
      reason: 'pass_through_incomplete'
    };
  }

  // Fields complete, customer has NOT finalized (or just completed last field this turn).
  const shouldAwait =
    aiNextAction === CONFIRM_ORDER_ACTION ||
    aiNextAction === AWAIT_CONFIRMATION_ACTION ||
    aiNextAction === 'close_sale' ||
    aiNextAction === 'collect_info' ||
    affirms; // e.g. "تمام" while delivering last field → still ask once

  if (shouldAwait) {
    const keepAsk =
      botReplyAsksForConfirmation(responseText) &&
      !botReplyAnnouncesConfirmation(responseText) &&
      !/\bnull\b/i.test(responseText) &&
      responseText.trim().length > 0;

    return {
      nextAction: AWAIT_CONFIRMATION_ACTION,
      responseText: keepAsk
        ? responseText
        : buildAwaitConfirmationMessage(language, safeCollected, cartLinesSummary),
      awaitingConfirmation: true,
      reason: keepAsk ? 'await_keep_model_ask' : 'await_inject_summary_ask'
    };
  }

  return {
    nextAction: aiNextAction,
    responseText,
    awaitingConfirmation: false,
    reason: 'pass_through_complete_non_order'
  };
}

/** Channels: only persist when pipeline says confirm_order and there is customer-facing text. */
export function shouldAppendOrderData(nextAction: string | undefined, responseText: string): boolean {
  if (nextAction !== CONFIRM_ORDER_ACTION) return false;
  const withoutTags = (responseText || '')
    .replace(/\[ORDER_DATA\][\s\S]*?\[\/ORDER_DATA\]/gi, '')
    .trim();
  // Never persist a silent / tag-only "confirmation" — that leaked ORDER_DATA to inboxes.
  return withoutTags.length > 0;
}
