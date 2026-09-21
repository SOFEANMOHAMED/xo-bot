/**
 * Per-turn invariants I1–I5 for live measurement (pure checks).
 */
import type { CartItem, ConversationState, Product } from '../../../core/types.js';
import { mayReplaceWithOrderTemplate } from '../deterministicReplyGate.js';
import { isExplicitPhotoRequest } from '../turnIntent.js';
import type { DecisionClass } from './liveClassify.js';

export type InvariantId = 'I1' | 'I2' | 'I3' | 'I4' | 'I5';

export type InvariantFailure = {
  id: InvariantId;
  message: string;
};

function looksLikeColorTemplate(text: string): boolean {
  return /أي لون بتحب|which color would you like|الألوان المتاحة:\s*/i.test(text);
}

function looksLikeIdentityTemplate(text: string): boolean {
  return /تمام، شو (اسمك الكامل|رقم هاتفك|عنوان التوصيل)\؟/.test(text);
}

function looksLikeConfirmSummary(text: string): boolean {
  return /طلبك جاهز للتأكيد|ready to confirm/i.test(text);
}

function sumMentionedAcrossCurrencies(text: string): boolean {
  // Crude: "753" style cross-sum of 200+553 while both currencies appear.
  if (!/ريال|دولار|SAR|USD/i.test(text)) return false;
  return /\b753\b/.test(text) || /مجموع[^\n]{0,40}753/.test(text);
}

export function checkInvariants(input: {
  userMessage: string;
  replyText: string;
  nextAction: string;
  decisionClass: DecisionClass;
  beforeCart: CartItem[];
  afterCart: CartItem[];
  userRemovedOrCancelled: boolean;
  orderCreated: boolean;
  userExplicitlyConfirmed: boolean;
}): InvariantFailure[] {
  const failures: InvariantFailure[] = [];
  const orderish = mayReplaceWithOrderTemplate({ nextAction: input.nextAction });
  const templatePresent =
    looksLikeColorTemplate(input.replyText) ||
    looksLikeIdentityTemplate(input.replyText) ||
    looksLikeConfirmSummary(input.replyText);

  // I1: template questions only on order-ish turns
  if (templatePresent && !orderish) {
    // Allow confirm summary only on finalize class
    if (
      looksLikeConfirmSummary(input.replyText) &&
      input.decisionClass === 'finalize'
    ) {
      // ok
    } else if (
      (looksLikeColorTemplate(input.replyText) ||
        looksLikeIdentityTemplate(input.replyText)) &&
      (input.decisionClass === 'order' || input.decisionClass === 'finalize')
    ) {
      // ok — order class
    } else {
      failures.push({
        id: 'I1',
        message: `template question on non-order turn (class=${input.decisionClass} action=${input.nextAction})`,
      });
    }
  }

  // I2: no mixed-currency sum
  if (sumMentionedAcrossCurrencies(input.replyText)) {
    failures.push({ id: 'I2', message: 'reply appears to sum across currencies' });
  }

  // I3: cart never loses a line without explicit remove/cancel
  const beforeIds = new Set(input.beforeCart.map((l) => `${l.productId}::${l.color || ''}::${l.size || ''}`));
  const afterIds = new Set(input.afterCart.map((l) => `${l.productId}::${l.color || ''}::${l.size || ''}`));
  for (const key of beforeIds) {
    if (!afterIds.has(key) && !input.userRemovedOrCancelled) {
      failures.push({
        id: 'I3',
        message: `cart lost line ${key} without remove/cancel`,
      });
      break;
    }
  }

  // I4: no order without explicit confirmation
  if (input.orderCreated && !input.userExplicitlyConfirmed) {
    failures.push({ id: 'I4', message: 'order created without explicit confirmation' });
  }

  // I5: image only when current message asks for it
  if (/\[IMAGE:/i.test(input.replyText) && !isExplicitPhotoRequest(input.userMessage)) {
    failures.push({ id: 'I5', message: 'IMAGE tag without explicit photo ask in current message' });
  }

  return failures;
}

export function cartSnapshot(state: ConversationState): CartItem[] {
  return [...(state.cart?.items || [])];
}

export function focusProductId(state: ConversationState): string | null {
  return (
    state.extracted_entities?.product_id ||
    state.last_recommended_products?.[0] ||
    state.cart?.items?.[0]?.productId ||
    null
  );
}

export function catalogAllowsColor(catalog: Product[], color: string): boolean {
  return catalog.some((p) =>
    (p.colors || []).some((c) => c === color || c.includes(color) || color.includes(c))
  );
}
