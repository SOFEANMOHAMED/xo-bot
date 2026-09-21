/**
 * Map next_action / intent → decision class for live reporting.
 */
export type DecisionClass = 'browse' | 'qa' | 'order' | 'finalize' | 'handoff' | 'other';

const BROWSE_ACTIONS = new Set([
  'greet',
  'discover_needs',
  'present_product',
  'handle_objection',
  'send_image',
  'recommend_products',
]);
const ORDER_ACTIONS = new Set(['collect_info', 'add_to_cart', 'close_sale']);
const FINALIZE_ACTIONS = new Set(['await_confirmation', 'confirm_order']);
const HANDOFF_ACTIONS = new Set(['end_conversation', 'handoff']);

export function classifyDecision(input: {
  nextAction: string;
  intent?: string;
}): DecisionClass {
  const action = input.nextAction || '';
  if (HANDOFF_ACTIONS.has(action)) return 'handoff';
  if (FINALIZE_ACTIONS.has(action)) return 'finalize';
  if (ORDER_ACTIONS.has(action)) return 'order';
  if (input.intent === 'product_query' || action === 'present_product') {
    return action === 'present_product' ? 'qa' : 'browse';
  }
  if (BROWSE_ACTIONS.has(action)) return 'browse';
  return 'other';
}

export type FailureRootCause =
  | 'keyword_classifier'
  | 'state_focus_drift'
  | 'llm_fact_violation'
  | 'template_override';

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
