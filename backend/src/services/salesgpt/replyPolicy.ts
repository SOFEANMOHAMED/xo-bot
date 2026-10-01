/**
 * Single owner of outbound SalesGPT reply text for template-owned decisions.
 *
 * Early rails still decide the event; this module builds the words.
 * Post-agent mutators (await / variant ask / identity) compose here once.
 */
import type { Language, Product } from '../../core/types.js';
import { buildCartActionCta } from './cartActionCta.js';
import {
  buildIdentityAskForCollected,
  missingIdentityFields,
  resolveIdentityCollectReply,
  type IdentitySnapshot,
} from './collectInfoOrder.js';
import { mayReplaceWithOrderTemplate } from './deterministicReplyGate.js';
import {
  AWAIT_CONFIRMATION_ACTION,
  CONFIRM_ORDER_ACTION,
  buildAwaitConfirmationMessage,
  buildCollectMissingFieldsMessage,
  buildOrderCancelledMessage,
  buildOrderConfirmedMessage,
  type OrderCollectedSnapshot,
} from './orderConfirmationPolicy.js';
import { buildAskColorMessage } from './orderColorPolicy.js';
import { detectPendingBotQuestion } from './pendingBotQuestion.js';
import { logReplyOwnership } from './replyOwnership.js';
import type { TurnIntent } from './turnIntent.js';
import {
  axisById,
  buildAskVariantMessage,
  isOurVariantAskTemplate,
} from './variantEngine/index.js';

export type ReplyDecision =
  | 'collect_identity'
  | 'ask_variant'
  | 'await_confirm'
  | 'confirm'
  | 'cancel'
  | 'cart_add'
  | 'cart_sync'
  | 'cart_remove'
  | 'cart_empty'
  | 'line_not_found'
  | 'pending_select'
  | 'variant_unchanged'
  | 'variant_unavailable'
  | 'ask_which_line'
  | 'ambiguous_color'
  | 'photo_clarify'
  | 'photo_not_found'
  | 'browse'
  | 'present';

export type ComposeOutboundReplyInput = {
  decision: ReplyDecision;
  language: Language;
  collected?: OrderCollectedSnapshot | IdentitySnapshot;
  cartLinesSummary?: string;
  missingIdentity?: string[];
  missingFields?: string[];
  draftReply?: string;
  turnIntent?: TurnIntent | null;
  nextActionHint?: string;
  focusProduct?: Product | null;
  productName?: string;
  removedNames?: string;
  productList?: string;
  colorOptions?: string;
};

export type ComposeOutboundReplyResult = {
  replyText: string;
  nextAction: string;
  replySource: string;
};

const TEMPLATE_OWNED = new Set<ReplyDecision>([
  'collect_identity',
  'ask_variant',
  'await_confirm',
  'confirm',
  'cancel',
  'cart_add',
  'cart_sync',
  'cart_remove',
  'cart_empty',
  'line_not_found',
  'pending_select',
  'variant_unchanged',
  'variant_unavailable',
  'ask_which_line',
  'ambiguous_color',
]);

export function isTemplateOwnedDecision(decision: ReplyDecision): boolean {
  return TEMPLATE_OWNED.has(decision);
}

export function buildAmbiguousColorClarifyMessage(
  language: Language,
  options: string
): string {
  return language === 'arabic'
    ? `تقصد أي خيار لون؟ 🎨\n${options}`
    : `Which color option did you mean? 🎨\n${options}`;
}

export function buildPendingSelectMessage(input: {
  language: Language;
  productName: string;
  color?: string | null;
  size?: string | null;
  cartSummary: string;
}): string {
  const lead =
    input.language === 'arabic'
      ? `تمام، ثبتّ${input.color ? ` اللون ${input.color}` : ''}${input.size ? ` المقاس ${input.size}` : ''} لـ ${input.productName}.`
      : `Got it — recorded${input.color ? ` ${input.color}` : ''}${input.size ? ` size ${input.size}` : ''} for ${input.productName}.`;
  return `${lead}\n${input.cartSummary}\n\n${buildCartActionCta(input.language)}`;
}

export function buildLineNotFoundMessage(language: Language): string {
  return language === 'arabic'
    ? 'هذا المنتج مو موجود بطلبك الحالي.'
    : 'That item is not in your current order.';
}

export function buildCartEmptiedMessage(language: Language): string {
  return language === 'arabic'
    ? 'تمام، شلت آخر منتج من طلبك. الطلب فاضي هلق — خبرني إذا بدك تختار شي تاني.'
    : 'Okay, I removed the last item. Your order is empty now — tell me if you want to pick something else.';
}

export function buildLineRemovedMessage(input: {
  language: Language;
  removedNames: string;
  cartSummary: string;
}): string {
  if (input.language === 'arabic') {
    return `تمام، شلت ${input.removedNames} من طلبك.\n${input.cartSummary}\n\n${buildCartActionCta(input.language)}`;
  }
  return `Okay, I removed ${input.removedNames} from your order.\n${input.cartSummary}\n\n${buildCartActionCta(input.language)}`;
}

export function buildMultiProductPhotoClarifyMessage(
  language: Language,
  productList: string
): string {
  return language === 'arabic'
    ? `في أكثر من منتج: ${productList}. شو المنتج اللي بدك صورته؟`
    : `Multiple products found: ${productList}. Which one do you want to see?`;
}

export function buildProductNotFoundPhotoMessage(language: Language): string {
  return language === 'arabic'
    ? `عذراً، ما عندي المنتج المطلوب 😔 جرّب اسم تاني أو اسأل "شو عندك؟"`
    : `Sorry, product not found 😔 Try another name or ask "what do you have?"`;
}

/** Ask which color/size photo when gallery images are variant-bound. */
export function buildVariantPhotoClarifyMessage(
  language: Language,
  opts: { colors?: string[] | null; sizes?: string[] | null }
): string {
  const colors = (opts.colors || []).filter(Boolean);
  const sizes = (opts.sizes || []).filter(Boolean);
  if (language === 'arabic') {
    if (colors.length && sizes.length) {
      return `عندي صور حسب اللون والمقاس. أي لون بدك؟ (${colors.join('، ')}) وأي مقاس؟ (${sizes.join('، ')})`;
    }
    if (colors.length) {
      return `عندي صورة لكل لون. أي لون بدك صورته؟ (${colors.join('، ')})`;
    }
    if (sizes.length) {
      return `عندي صورة لكل مقاس. أي مقاس بدك صورته؟ (${sizes.join('، ')})`;
    }
    return `خبرني اللون أو المقاس لأرسل لك الصورة الصحيحة.`;
  }
  if (colors.length && sizes.length) {
    return `I have photos by color and size. Which color (${colors.join(', ')}) and size (${sizes.join(', ')})?`;
  }
  if (colors.length) {
    return `I have a photo per color. Which color do you want? (${colors.join(', ')})`;
  }
  if (sizes.length) {
    return `I have a photo per size. Which size do you want? (${sizes.join(', ')})`;
  }
  return `Tell me the color or size so I can send the right photo.`;
}

export function buildPhotoUnavailableMessage(language: Language): string {
  return language === 'arabic'
    ? `حالياً ما قدرت أرسل صورة هذا المنتج. تقدر تسألني عن السعر أو التفاصيل.`
    : `I couldn't send a photo for this product right now. You can ask about price or details.`;
}

export function composeOutboundReply(
  input: ComposeOutboundReplyInput
): ComposeOutboundReplyResult {
  const language = input.language;
  const collected = input.collected || {};

  switch (input.decision) {
    case 'cancel':
      return {
        replyText: buildOrderCancelledMessage(language),
        nextAction: input.nextActionHint || 'end_conversation',
        replySource: 'cancel',
      };
    case 'confirm':
      return {
        replyText: buildOrderConfirmedMessage(
          language,
          collected as OrderCollectedSnapshot
        ),
        nextAction: CONFIRM_ORDER_ACTION,
        replySource: 'confirm',
      };
    case 'await_confirm':
      return {
        replyText: buildAwaitConfirmationMessage(
          language,
          collected as OrderCollectedSnapshot,
          input.cartLinesSummary
        ),
        nextAction: AWAIT_CONFIRMATION_ACTION,
        replySource: 'await_confirm',
      };
    case 'collect_identity': {
      const resolved = resolveIdentityCollectReply({
        language,
        collected: collected as IdentitySnapshot,
        responseText: input.draftReply,
      });
      return {
        replyText:
          resolved.replyText ||
          buildCollectMissingFieldsMessage(
            language,
            input.missingFields || input.missingIdentity || []
          ),
        nextAction: 'collect_info',
        replySource: 'collect_identity',
      };
    }
    case 'ask_variant': {
      const product = input.focusProduct;
      const colorAxis = product ? axisById(product, 'color') : null;
      const sizeAxis = product ? axisById(product, 'size') : null;
      const lang = language === 'english' ? 'english' : 'arabic';
      if (colorAxis) {
        return {
          replyText: buildAskColorMessage(lang, product?.colors || []),
          nextAction: 'collect_info',
          replySource: 'ask_variant',
        };
      }
      if (sizeAxis) {
        return {
          replyText: buildAskVariantMessage(lang, sizeAxis),
          nextAction: 'collect_info',
          replySource: 'ask_variant',
        };
      }
      return {
        replyText: input.draftReply || '',
        nextAction: input.nextActionHint || 'collect_info',
        replySource: 'ask_variant',
      };
    }
    case 'cart_empty':
      return {
        replyText: buildCartEmptiedMessage(language),
        nextAction: input.nextActionHint || 'present_product',
        replySource: 'cart_empty',
      };
    case 'line_not_found':
      return {
        replyText: buildLineNotFoundMessage(language),
        nextAction: input.nextActionHint || 'present_product',
        replySource: 'line_not_found',
      };
    case 'cart_remove':
      return {
        replyText: buildLineRemovedMessage({
          language,
          removedNames: input.removedNames || '',
          cartSummary: input.cartLinesSummary || '',
        }),
        nextAction: input.nextActionHint || 'add_to_cart',
        replySource: 'cart_remove',
      };
    case 'pending_select':
      return {
        replyText: input.draftReply || '',
        nextAction: input.nextActionHint || 'present_product',
        replySource: 'pending_select',
      };
    case 'ambiguous_color':
      return {
        replyText: buildAmbiguousColorClarifyMessage(
          language,
          input.colorOptions || ''
        ),
        nextAction: input.nextActionHint || 'collect_info',
        replySource: 'ambiguous_color',
      };
    case 'photo_clarify':
      return {
        replyText: buildMultiProductPhotoClarifyMessage(
          language,
          input.productList || ''
        ),
        nextAction: input.nextActionHint || 'send_image',
        replySource: 'photo_clarify',
      };
    case 'photo_not_found':
      return {
        replyText: buildProductNotFoundPhotoMessage(language),
        nextAction: input.nextActionHint || 'present_product',
        replySource: 'photo_not_found',
      };
    default:
      return {
        replyText: input.draftReply || '',
        nextAction: input.nextActionHint || 'present_product',
        replySource: 'pass_through',
      };
  }
}

export type PostAgentReplyPolicyInput = {
  language: Language;
  nextAction: string;
  turnIntent?: TurnIntent | null;
  replyText: string;
  collected: OrderCollectedSnapshot;
  cartLinesSummary?: string;
  focusProduct?: Product | null;
  /** Missing fields from isCheckoutReady (identity + color/size on focused line). */
  checkoutMissing: string[];
};

/**
 * Single post-agent compose: variant ask beats await when checkout is incomplete;
 * await template is written once; identity collect uses collectInfoOrder SSOT.
 */
export function applyPostAgentReplyPolicy(
  input: PostAgentReplyPolicyInput
): ComposeOutboundReplyResult {
  const language = input.language;
  const lang = language === 'english' ? 'english' : 'arabic';
  const mayReplace = mayReplaceWithOrderTemplate({
    nextAction: input.nextAction,
    turnIntent: input.turnIntent,
  });
  const checkoutVariantMissing = input.checkoutMissing.filter(
    (field) => field === 'color' || field === 'size'
  );
  const identityMissing = missingIdentityFields(input.collected);
  const mayAskVariant =
    mayReplace &&
    (input.nextAction === 'collect_info' ||
      input.nextAction === AWAIT_CONFIRMATION_ACTION ||
      input.nextAction === CONFIRM_ORDER_ACTION ||
      input.nextAction === 'close_sale');

  if (mayAskVariant && input.focusProduct && checkoutVariantMissing.includes('color')) {
    if (!detectPendingBotQuestion(input.replyText)) {
      const composed = {
        replyText: buildAskColorMessage(lang, input.focusProduct.colors || []),
        nextAction: 'collect_info',
        replySource: 'ask_variant',
      };
      logReplyOwnership({
        phase: 'compose',
        reason: composed.replySource,
        nextAction: composed.nextAction,
        replyText: composed.replyText,
      });
      return composed;
    }
  }

  if (
    mayAskVariant &&
    input.focusProduct &&
    !checkoutVariantMissing.includes('color') &&
    checkoutVariantMissing.includes('size')
  ) {
    const sizeAxis = axisById(input.focusProduct, 'size');
    if (sizeAxis && !isOurVariantAskTemplate(input.replyText, sizeAxis)) {
      const composed = {
        replyText: buildAskVariantMessage(lang, sizeAxis),
        nextAction: 'collect_info',
        replySource: 'ask_variant',
      };
      logReplyOwnership({
        phase: 'compose',
        reason: composed.replySource,
        nextAction: composed.nextAction,
        replyText: composed.replyText,
      });
      return composed;
    }
  }

  const checkoutComplete =
    identityMissing.length === 0 && checkoutVariantMissing.length === 0;
  if (
    checkoutComplete &&
    (input.nextAction === AWAIT_CONFIRMATION_ACTION ||
      input.nextAction === 'collect_info' ||
      input.nextAction === 'close_sale')
  ) {
    const composed = {
      replyText: buildAwaitConfirmationMessage(
        language,
        input.collected,
        input.cartLinesSummary
      ),
      nextAction: AWAIT_CONFIRMATION_ACTION,
      replySource: 'await_confirm',
    };
    logReplyOwnership({
      phase: 'compose',
      reason: composed.replySource,
      nextAction: composed.nextAction,
      replyText: composed.replyText,
    });
    return composed;
  }

  if (mayReplace && input.nextAction === 'collect_info' && identityMissing.length > 0) {
    const ask =
      buildIdentityAskForCollected(language, input.collected) ||
      buildCollectMissingFieldsMessage(language, input.checkoutMissing);
    const composed = {
      replyText: ask,
      nextAction: 'collect_info' as const,
      replySource: 'collect_identity',
    };
    logReplyOwnership({
      phase: 'compose',
      reason: composed.replySource,
      nextAction: composed.nextAction,
      replyText: composed.replyText,
    });
    return composed;
  }

  let replyText = input.replyText;
  if (
    input.focusProduct &&
    !(input.focusProduct.colors && input.focusProduct.colors.length > 0) &&
    /أي لون|الألوان المتاحة|which color|available colors/i.test(replyText)
  ) {
    replyText =
      replyText
        .replace(
          /[^.!\n]*?(?:أي لون|الألوان المتاحة|which color|available colors)[^.!\n]*[.!]?\s*/gi,
          ''
        )
        .trim() || replyText;
  }

  const composed = {
    replyText,
    nextAction: input.nextAction,
    replySource: 'pass_through',
  };
  logReplyOwnership({
    phase: 'compose',
    reason: composed.replySource,
    nextAction: composed.nextAction,
    replyText: composed.replyText,
  });
  return composed;
}
