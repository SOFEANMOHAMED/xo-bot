/**
 * Post-agent compose: variant ask / await / identity + bind pending question.
 */
import type { ConversationState, Language, Product } from '../../../core/types.js';
import { getCartItems, formatCartSummary, isCheckoutReady } from '../conversationCart.js';
import { AWAIT_CONFIRMATION_ACTION } from '../orderConfirmationPolicy.js';
import {
  applyPostAgentReplyPolicy,
  type ComposeOutboundReplyResult,
} from '../replyPolicy.js';
import { applyPendingToState, bindPendingBotQuestion } from '../pendingBotQuestion.js';
import { applySalesGPTStage } from '../conversationStateSync.js';
import type { TurnIntent } from '../turnIntent.js';
import { resolveTurnIntent } from '../turnIntent.js';
import { isProductInfoRequest } from '../orderConfirmationPolicy.js';

export type FinalizeOutboundReplyInput = {
  language: Language;
  messageText: string;
  effectiveNextAction: string;
  replyText: string;
  updatedState: ConversationState;
  focusProduct: Product | null;
  turnIntent?: TurnIntent | null;
  shippingPolicy?: string;
};

export type FinalizeOutboundReplyResult = {
  replyText: string;
  nextAction: string;
  updatedState: ConversationState;
  composed: ComposeOutboundReplyResult;
};

export function finalizeOutboundReply(
  input: FinalizeOutboundReplyInput
): FinalizeOutboundReplyResult {
  let { updatedState, effectiveNextAction } = input;
  const focusForPending = input.focusProduct;
  const checkoutMissing = isCheckoutReady(updatedState, focusForPending).missing;
  const eForCompose = updatedState.extracted_entities || {};
  const cartItemsForCompose = getCartItems(updatedState);
  const composed = applyPostAgentReplyPolicy({
    language: input.language,
    nextAction: effectiveNextAction,
    turnIntent:
      input.turnIntent ||
      resolveTurnIntent({
        userMessage: input.messageText,
        asksProductInfo: isProductInfoRequest(input.messageText),
      }),
    replyText: input.replyText,
    collected: {
      name: eForCompose.name,
      phone: eForCompose.phone,
      address: eForCompose.address,
      product_name:
        cartItemsForCompose[0]?.productName || eForCompose.product_query,
      color: cartItemsForCompose[0]?.color || eForCompose.color,
      size: cartItemsForCompose[0]?.size || eForCompose.size,
      quantity: cartItemsForCompose[0]?.quantity || eForCompose.quantity,
    },
    cartLinesSummary:
      cartItemsForCompose.length > 0
        ? formatCartSummary(cartItemsForCompose, input.language, {
            shippingPolicy: input.shippingPolicy,
          })
        : undefined,
    focusProduct: focusForPending,
    checkoutMissing,
  });

  let finalReplyText = composed.replyText;
  effectiveNextAction = composed.nextAction;
  if (effectiveNextAction === AWAIT_CONFIRMATION_ACTION) {
    applySalesGPTStage(updatedState, '8');
    updatedState.awaiting_order_confirmation = true;
  }
  if (effectiveNextAction === 'collect_info' && composed.replySource === 'ask_variant') {
    updatedState.awaiting_order_confirmation = false;
  }

  const pendingBind = bindPendingBotQuestion(
    finalReplyText,
    updatedState,
    focusForPending
  );
  updatedState = applyPendingToState(updatedState, pendingBind);

  return {
    replyText: finalReplyText,
    nextAction: effectiveNextAction,
    updatedState,
    composed,
  };
}
