/**
 * Gate for deterministic reply templates (ask color / ask identity / confirm summary).
 *
 * WHY: Phase 2D forced collect_info / color asks whenever a focused product
 * was missing a field — including greetings and price questions.
 *
 * Invariant: templates may replace the model reply ONLY on order/cart/finalize
 * turns — never greeting, price, product details, browse, or availability.
 */
import type { TurnIntent } from './turnIntent.js';

const ORDERISH_ACTIONS = new Set([
  'collect_info',
  'await_confirmation',
  'confirm_order',
  'add_to_cart',
  'close_sale',
]);

const ORDERISH_INTENTS = new Set<TurnIntent>([
  'cart_edit',
  'checkout',
  'finalize',
]);

const BROWSE_INTENTS = new Set<TurnIntent>(['browse_media', 'product_qa']);

export type DeterministicTemplateGateInput = {
  /** Effective / AI next_action for this turn. */
  nextAction: string;
  /** Deterministic turn intent when known. */
  turnIntent?: TurnIntent | null;
};

/**
 * True when code may replace the model reply with an order template
 * (color ask, identity ask, confirmation summary).
 */
export function mayReplaceWithOrderTemplate(
  input: DeterministicTemplateGateInput
): boolean {
  const intent = input.turnIntent || null;
  if (intent && BROWSE_INTENTS.has(intent)) return false;
  if (intent && ORDERISH_INTENTS.has(intent)) return true;
  return ORDERISH_ACTIONS.has(input.nextAction);
}
