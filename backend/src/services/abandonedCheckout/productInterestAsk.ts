/**
 * Explicit product-interest ask — used to arm per-product silence reminders.
 * Not the same as store-policy Q (shipping) or bare greetings with an ad seed.
 */

import type { ConversationState } from '../../core/types.js';
import {
  isProductInfoRequest,
  isStorePolicyInfoRequest,
} from '../salesgpt/orderConfirmationPolicy.js';

const PRICE_OR_DETAILS_ASK: RegExp[] = [
  /(^|[\s،,])(شو|قديش|بكم|بماذا)(\s+|$)/i,
  /(^|[\s،,])كم\s*(سعر|ثمن|تكلفة|ال|هيدا|هذا|هاي)?/i,
  /(سعر|ثمن)\s*(ال)?\S+/i,
  /(تفاصيل|معلومات|وصف|مواصفات|مميزات|فوائد)/i,
  /(احكيلي|احكي|قلي|قولي|عرفني|وضح|اشرح)\s*(لي\s*)?(عن|عنه|عنها|اكثر|أكثر)?/i,
  /\b(how much|what('?s| is) the price|tell me (more )?about|details|specs|features)\b/i,
];

/**
 * True when the current message is an explicit question / info ask about a product
 * (price, details, specs) — not shipping/policy and not a bare affirm.
 */
export function isExplicitProductInterestAsk(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  if (isStorePolicyInfoRequest(messageText)) return false;
  if (isProductInfoRequest(messageText)) return true;
  const text = messageText.trim();
  if (/^(نعم|اي|أكد|اكد|لا|لأ|ok|okay|yes|no)\s*[.!?؟]*$/i.test(text)) {
    return false;
  }
  if (PRICE_OR_DETAILS_ASK.some((p) => p.test(text))) return true;
  // Short interrogative about "it / this product"
  const asksMark = /[؟?]/.test(text);
  const aboutProduct = /(المنتج|هذا|هيدا|هاي|عنه|عنها|this|it|product)/i.test(text);
  return asksMark && aboutProduct;
}

export function recordExplicitProductInterest(
  state: ConversationState,
  productId: string
): ConversationState {
  if (!productId?.trim()) return state;
  const now = new Date().toISOString();
  const prev = state.product_interest_reminder || {
    asked: {},
    sent: {},
    claimed: {},
  };
  return {
    ...state,
    product_interest_reminder: {
      asked: { ...(prev.asked || {}), [productId]: now },
      sent: { ...(prev.sent || {}) },
      claimed: { ...(prev.claimed || {}) },
    },
  };
}

export function clearProductInterestReminderFromState(state: ConversationState): void {
  if (state && 'product_interest_reminder' in state) {
    delete (state as ConversationState & { product_interest_reminder?: unknown })
      .product_interest_reminder;
  }
}
