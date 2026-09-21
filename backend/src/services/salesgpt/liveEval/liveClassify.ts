/**
 * Decision class by EFFECT for live measurement (not by next_action name alone).
 */
import type { CartItem } from '../../../core/types.js';

export type DecisionClass =
  | 'browse'
  | 'qa'
  | 'order'
  | 'photo'
  | 'finalize'
  | 'handoff'
  | 'other';

export type FailureRootCause =
  | 'keyword_classifier'
  | 'state_focus_drift'
  | 'llm_fact_violation'
  | 'template_override';

function lineSignature(line: CartItem): string {
  return [
    line.lineId || '',
    line.productId,
    line.color || '',
    line.size || '',
    String(line.quantity),
    String(line.unitPrice),
    line.currency,
  ].join('::');
}

function cartMutated(before: CartItem[], after: CartItem[]): boolean {
  if (before.length !== after.length) return true;
  const beforeSet = new Set(before.map(lineSignature));
  const afterSet = new Set(after.map(lineSignature));
  if (beforeSet.size !== afterSet.size) return true;
  for (const key of beforeSet) {
    if (!afterSet.has(key)) return true;
  }
  return false;
}

function colorOrSizeRecorded(input: {
  beforeCart: CartItem[];
  afterCart: CartItem[];
  beforeColor?: string | null;
  afterColor?: string | null;
  beforeSize?: string | null;
  afterSize?: string | null;
}): boolean {
  if ((input.afterColor || '') !== (input.beforeColor || '')) return true;
  if ((input.afterSize || '') !== (input.beforeSize || '')) return true;
  for (let i = 0; i < input.afterCart.length; i++) {
    const after = input.afterCart[i];
    const before = input.beforeCart.find(
      (line) =>
        (line.lineId && after.lineId && line.lineId === after.lineId) ||
        line.productId === after.productId
    );
    if (!before) continue;
    if ((after.color || '') !== (before.color || '')) return true;
    if ((after.size || '') !== (before.size || '')) return true;
  }
  return false;
}

/**
 * Classify by observed effect. Soft-fail only when this differs from expectClass.
 */
export function classifyDecision(input: {
  replyText: string;
  userMessage: string;
  beforeCart: CartItem[];
  afterCart: CartItem[];
  beforeColor?: string | null;
  afterColor?: string | null;
  beforeSize?: string | null;
  afterSize?: string | null;
  orderCreated?: boolean;
  awaitingConfirmation?: boolean;
  nextAction?: string;
  intent?: string;
}): DecisionClass {
  const reply = input.replyText || '';
  const action = input.nextAction || '';

  // Photo attach is its own class (effect: media attached).
  if (/\[IMAGE:/i.test(reply)) return 'photo';

  if (input.orderCreated || action === 'confirm_order') return 'finalize';
  if (
    input.awaitingConfirmation ||
    action === 'await_confirmation' ||
    /طلبك جاهز للتأكيد|ready to confirm/i.test(reply)
  ) {
    return 'finalize';
  }

  if (action === 'handoff' || action === 'end_conversation') return 'handoff';

  const mutated = cartMutated(input.beforeCart, input.afterCart);
  const variantRecorded = colorOrSizeRecorded(input);
  if (mutated || variantRecorded) return 'order';

  // Identity collect / close_sale without cart change still order-ish effect.
  if (action === 'collect_info' || action === 'close_sale' || action === 'add_to_cart') {
    return 'order';
  }

  // Price / details / availability answers.
  if (
    input.intent === 'product_query' ||
    input.intent === 'price' ||
    input.intent === 'availability' ||
    action === 'present_product'
  ) {
    return 'qa';
  }

  if (
    action === 'discover_needs' ||
    action === 'recommend_products' ||
    action === 'greet' ||
    /منتجات|عندنا|catalog|available products/i.test(reply)
  ) {
    return 'browse';
  }

  if (action === 'send_image') return 'photo';

  return 'other';
}

/** @deprecated Alias kept for call sites that still pass next_action-only. */
export function classifyDecisionByAction(input: {
  nextAction: string;
  intent?: string;
}): DecisionClass {
  return classifyDecision({
    replyText: '',
    userMessage: '',
    beforeCart: [],
    afterCart: [],
    nextAction: input.nextAction,
    intent: input.intent,
  });
}

export function classifyRootCause(input: {
  invariantIds: string[];
  factFailures: string[];
  stateFailures: string[];
  decisionUnexpected: boolean;
}): FailureRootCause {
  if (input.invariantIds.includes('I1') || /template/i.test(input.factFailures.join(' '))) {
    return 'template_override';
  }
  if (input.factFailures.length > 0) return 'llm_fact_violation';
  if (input.stateFailures.length > 0 || input.invariantIds.includes('I3')) {
    return 'state_focus_drift';
  }
  if (input.decisionUnexpected) return 'keyword_classifier';
  return 'llm_fact_violation';
}
