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

export const AWAIT_CONFIRMATION_ACTION = 'await_confirmation';
export const CONFIRM_ORDER_ACTION = 'confirm_order';

const AFFIRMATIVE_TOKENS = [
  'نعم', 'أيوا', 'ايوا', 'أي', 'اي', 'تمام', 'موافق', 'ماشي', 'طيب',
  'أكيد', 'اكيد', 'بالتأكيد', 'اوكي', 'اوكيه', 'ممتاز', 'صح', 'صحيح',
  'ok', 'okay', 'yes', 'yep', 'yeah', 'sure', 'agree', 'agreed', 'correct', 'right'
];

const NEGATIVE_TOKENS = [
  'لا', 'لأ', 'مش', 'مو', 'ما بدي', 'لا بدي', 'ارفض', 'إرفض', 'إلغاء', 'الغي',
  'no', 'not', 'nope', 'cancel', 'reject', 'stop'
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

/** Permissive yes / confirm detection ("اي اكد", "نعم", "ok", …). */
export function isAffirmativeReply(messageText: string): boolean {
  if (!messageText) return false;
  if (containsAnyToken(messageText, NEGATIVE_TOKENS)) return false;
  // "تمام، ممكن معلومات أكثر؟" is politeness + question — not order confirmation.
  if (isProductInfoRequest(messageText)) return false;
  if (containsAnyToken(messageText, AFFIRMATIVE_TOKENS)) return true;
  return CONFIRM_VERB_PATTERNS.some(p => p.test(messageText));
}

/** Permissive no / cancel detection. */
export function isNegativeReply(messageText: string): boolean {
  if (!messageText) return false;
  if (isProductInfoRequest(messageText)) return false;
  if (containsAnyToken(messageText, AFFIRMATIVE_TOKENS)) return false;
  return containsAnyToken(messageText, NEGATIVE_TOKENS);
}

/** Customer intent to finalize the order on this turn. */
export function isCustomerFinalizingOrder(messageText: string): boolean {
  if (isProductInfoRequest(messageText)) return false;
  return isAffirmativeReply(messageText) || isNegativeReply(messageText);
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

export interface OrderCollectedSnapshot {
  name?: string;
  phone?: string;
  address?: string;
  product_name?: string;
  color?: string;
  size?: string;
  quantity?: number;
}

export function buildOrderConfirmedMessage(
  language: Language,
  info: OrderCollectedSnapshot
): string {
  if (language === 'arabic') {
    return `تم تأكيد طلبك${info.name ? ` يا ${info.name}` : ''} 🎉 رح نتواصل معك قريباً لترتيب التوصيل.`;
  }
  return `Your order has been confirmed${info.name ? `, ${info.name}` : ''}! 🎉 We'll contact you shortly to arrange delivery.`;
}

export function buildAwaitConfirmationMessage(
  language: Language,
  info: OrderCollectedSnapshot
): string {
  const qty = info.quantity && info.quantity > 0 ? info.quantity : 1;
  const productLine = [
    info.product_name || (language === 'arabic' ? 'المنتج' : 'the product'),
    info.color,
    info.size
  ].filter(Boolean).join(' — ');

  if (language === 'arabic') {
    const nameBit = info.name ? ` يا ${info.name}` : '';
    return (
      `تمام${nameBit}! طلبك جاهز للتأكيد:\n` +
      `• ${productLine} × ${qty}\n` +
      `• الهاتف: ${info.phone || '—'}\n` +
      `• العنوان: ${info.address || '—'}\n\n` +
      `اكتب «نعم» أو «أكد» لتثبيت الطلب الآن.`
    );
  }

  const nameBit = info.name ? `, ${info.name}` : '';
  return (
    `Perfect${nameBit}! Your order is ready to confirm:\n` +
    `• ${productLine} × ${qty}\n` +
    `• Phone: ${info.phone || '—'}\n` +
    `• Address: ${info.address || '—'}\n\n` +
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
    modelAsksProductInfo
  } = input;

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
      awaitingConfirmation: wasAwaitingConfirmation && fieldsComplete,
      reason: 'product_info_request_blocks_checkout'
    };
  }

  const customerFinalizing = isCustomerFinalizingOrder(userMessage);
  const allowedToFinalize =
    fieldsComplete &&
    customerFinalizing &&
    (wasAwaitingConfirmation || fieldsWereCompleteBeforeTurn);

  // Finalize only after an explicit yes while we were already ready / awaiting.
  if (allowedToFinalize) {
    const safeThanks =
      !responseText.trim() ||
      botReplyAsksForConfirmation(responseText)
        ? buildOrderConfirmedMessage(language, collectedInfo)
        : responseText;
    return {
      nextAction: CONFIRM_ORDER_ACTION,
      responseText: safeThanks,
      awaitingConfirmation: false,
      reason: 'customer_finalized_while_ready'
    };
  }

  // Incomplete → never confirm; keep collecting if AI tried to confirm.
  if (!fieldsComplete) {
    if (aiNextAction === CONFIRM_ORDER_ACTION || aiNextAction === AWAIT_CONFIRMATION_ACTION) {
      return {
        nextAction: 'collect_info',
        responseText,
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
    customerFinalizing; // e.g. "تمام" while delivering last field → still ask once

  if (shouldAwait) {
    const keepAsk =
      botReplyAsksForConfirmation(responseText) &&
      !botReplyAnnouncesConfirmation(responseText) &&
      responseText.trim().length > 0;

    return {
      nextAction: AWAIT_CONFIRMATION_ACTION,
      responseText: keepAsk
        ? responseText
        : buildAwaitConfirmationMessage(language, collectedInfo),
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
