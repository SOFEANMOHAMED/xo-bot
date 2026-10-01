/**
 * Single next_action reducer from interpreter + commerce facts.
 * Model copy is not an input. confirm_order is never emitted here (I4 owns finalize).
 */
import type { InterpreterActionType } from './types.js';

export type InterpreterNextAction =
  | 'send_image'
  | 'present_product'
  | 'collect_info'
  | 'await_confirmation'
  | 'end_conversation'
  | 'discover_needs'
  | null;

export type InterpreterNextActionFacts = {
  applied: InterpreterActionType[];
  handoffHuman: boolean;
  wantsPhoto: boolean;
  refusesPhoto: boolean;
  affirmsOrder: boolean;
  deniesOrder: boolean;
  browseCatalog: boolean;
  infoKind: 'price' | 'details' | 'availability' | null;
  clarification: boolean;
  /** Checkout fields complete (name/phone/address + variants). */
  checkoutReady: boolean;
  /** At least one required variant axis still missing on focus. */
  missingVariantAxes?: boolean;
  /** Cart emptied this turn (cancel / last remove). */
  cartEmpty?: boolean;
};

/**
 * Facts → one next_action. Agent may suggest; when facts yield a value, facts win.
 */
export function nextActionFromInterpreterFacts(
  facts: InterpreterNextActionFacts
): InterpreterNextAction {
  if (facts.handoffHuman) return 'end_conversation';
  if (facts.applied.includes('cancel_order')) return 'end_conversation';
  if (facts.cartEmpty && facts.applied.includes('remove_line')) {
    return 'present_product';
  }
  if (facts.wantsPhoto && !facts.refusesPhoto) return 'send_image';
  if (facts.refusesPhoto) return 'present_product';
  if (facts.infoKind || facts.applied.includes('ask_product_info')) return 'present_product';
  if (facts.browseCatalog) return 'present_product';
  if (facts.clarification || facts.applied.includes('ask_clarification')) {
    return 'discover_needs';
  }
  if (facts.affirmsOrder && facts.checkoutReady) return 'await_confirmation';
  if (facts.deniesOrder) return 'present_product';
  if (facts.applied.includes('provide_identity_field')) {
    if (facts.checkoutReady && !facts.missingVariantAxes) return 'await_confirmation';
    return 'collect_info';
  }
  if (
    facts.applied.includes('select_color') ||
    facts.applied.includes('select_size') ||
    facts.applied.includes('set_quantity') ||
    facts.applied.includes('add_product') ||
    facts.applied.includes('correct_variant') ||
    facts.applied.includes('remove_line')
  ) {
    if (facts.missingVariantAxes || !facts.checkoutReady) return 'collect_info';
    return 'collect_info';
  }
  if (facts.missingVariantAxes) return 'collect_info';
  if (facts.applied.includes('set_focus_product')) return 'present_product';
  return null;
}
