import type { Language, Product } from '../../../core/types.js';
import { buildAskVariantMessage } from './ask.js';
import { missingAxes } from './axes.js';
import type { VariantAxis, VariantSelection } from './types.js';

const CONFIRM_ORDER_ACTION = 'confirm_order';
const AWAIT_CONFIRMATION_ACTION = 'await_confirmation';

export function gateConfirmWhenVariantsInvalid(input: {
  nextAction: string;
  product: Product | null | undefined;
  selection: VariantSelection;
  language: Language;
  replyText: string;
}): {
  nextAction: string;
  replyText: string;
  missingAxis: VariantAxis | null;
} {
  if (input.nextAction !== CONFIRM_ORDER_ACTION || !input.product) {
    return {
      nextAction: input.nextAction,
      replyText: input.replyText,
      missingAxis: null,
    };
  }
  const missing = missingAxes(input.product, input.selection);
  if (missing.length === 0) {
    return {
      nextAction: input.nextAction,
      replyText: input.replyText,
      missingAxis: null,
    };
  }
  const first = missing[0];
  return {
    nextAction: AWAIT_CONFIRMATION_ACTION,
    replyText: buildAskVariantMessage(input.language, first),
    missingAxis: first,
  };
}
