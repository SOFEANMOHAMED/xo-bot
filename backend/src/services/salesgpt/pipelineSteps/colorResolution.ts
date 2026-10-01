/**
 * Color / size resolution helpers used after the agent turn.
 */
import { formatColorOptionsForDisplay } from '../../../catalog/color-options.js';
import type {
  ConversationState,
  Language,
  Message,
  Product,
} from '../../../core/types.js';
import { getCartItems, normalizeCart } from '../conversationCart.js';
import {
  buildUnavailableColorMessage,
  isColorInProductCatalog,
  resolveOrderColor,
  type ResolveOrderColorResult,
} from '../orderColorPolicy.js';
import { AWAIT_CONFIRMATION_ACTION } from '../orderConfirmationPolicy.js';
import { buildAmbiguousColorClarifyMessage } from '../replyPolicy.js';
import {
  axisById,
  extractBareVariantAnswer,
  gateConfirmWhenVariantsInvalid,
  selectionFromEntities,
  type VariantSelection,
} from '../variantEngine/index.js';

/**
 * Drop stored / cart colors that are not valid for the focused product.
 * Prevents a prior experiment's color from poisoning price/photo turns
 * (and from failing catalog grounding as a false "hallucination").
 */
export function scrubInvalidProductColorState(
  state: ConversationState,
  product: Product | undefined
): ConversationState {
  if (!product?.id) return state;

  const catalogColors = product.colors;
  const colorOk = (color: string | null | undefined): boolean =>
    Boolean(catalogColors?.length && isColorInProductCatalog(color, catalogColors));

  let changed = false;
  const entities = state.extracted_entities
    ? { ...state.extracted_entities }
    : undefined;

  if (entities?.color && !colorOk(entities.color)) {
    delete entities.color;
    if (entities.variants?.color) {
      const variants = { ...entities.variants };
      delete variants.color;
      entities.variants = Object.keys(variants).length > 0 ? variants : undefined;
    }
    changed = true;
  }

  const items = getCartItems(state);
  const nextItems = items.map((item) => {
    if (item.productId !== product.id || !item.color) return item;
    if (colorOk(item.color)) return item;
    changed = true;
    const { color: _drop, ...rest } = item;
    void _drop;
    return { ...rest };
  });

  if (!changed) return state;

  const nextCart =
    items.length > 0
      ? {
          ...normalizeCart(state.cart),
          items: nextItems,
          updatedAt: new Date().toISOString(),
        }
      : state.cart;

  return {
    ...state,
    extracted_entities: entities,
    cart: nextCart,
  };
}

function collectUserMessageTexts(recentMessages: Message[], currentMessage: string): string[] {
  const history = recentMessages
    .filter((m) => m.role === 'user')
    .map((m) => m.content || '');
  return [...history, currentMessage];
}

/**
 * Strict catalog-bound color for the active product.
 * User history wins over AI / stale state (prevents hallucinated overwrite on confirm).
 */
export function resolveProductOrderColor(params: {
  product: Product | undefined;
  messageText: string;
  recentMessages: Message[];
  conversationState: ConversationState;
  aiColor?: string | null;
  language: Language;
  replyText: string;
}): {
  color: string | null;
  replyText: string;
  policy: ResolveOrderColorResult | null;
} {
  const catalogColors = params.product?.colors;
  if (!catalogColors?.length) {
    return { color: null, replyText: params.replyText, policy: null };
  }

  const userMessages = collectUserMessageTexts(params.recentMessages, params.messageText);
  const policy = resolveOrderColor({
    catalogColors,
    currentMessage: params.messageText,
    userMessages,
    storedColor: params.conversationState.extracted_entities?.color,
    aiColor: params.aiColor ?? null,
  });

  let replyText = params.replyText;

  if (policy.needsClarification && policy.ambiguous.length > 1) {
    const options = formatColorOptionsForDisplay(
      policy.ambiguous,
      params.language === 'english' ? 'english' : 'arabic'
    );
    replyText = buildAmbiguousColorClarifyMessage(params.language, options);
    return { color: null, replyText, policy };
  }

  if (!policy.color && policy.rejectedAiColor) {
    replyText = buildUnavailableColorMessage(
      params.language === 'english' ? 'english' : 'arabic',
      catalogColors,
      policy.rejectedAiColor
    );
    return { color: null, replyText, policy };
  }

  return { color: policy.color, replyText, policy };
}

/** Bare catalog size on the current message — same extract as pending size, no pending required. */
export function resolveBareSizeFromMessage(
  product: Product | null | undefined,
  messageText: string
): string | null {
  const sizeAxis = axisById(product, 'size');
  if (!sizeAxis) return null;
  return extractBareVariantAnswer(messageText, sizeAxis);
}

/** Entity + matching cart-line values for variant gates. */
export function variantSelectionForProduct(
  state: ConversationState,
  product: Product
): VariantSelection {
  const selection = selectionFromEntities(state.extracted_entities);
  const line = getCartItems(state).find((item) => item.productId === product.id);
  if (line?.color) selection.color = line.color;
  if (line?.size) selection.size = line.size;
  return selection;
}

/** Wrapper: engine confirm gate for color + size. Unavailable color keeps adapter copy. */
export function gateConfirmWhenColorInvalid(params: {
  nextAction: string;
  product: Product | undefined;
  state: ConversationState;
  resolvedColor: string | null;
  language: Language;
  replyText: string;
  rejectedColor?: string | null;
}): { nextAction: string; replyText: string; awaitingConfirmation: boolean } {
  const selection = params.product
    ? variantSelectionForProduct(params.state, params.product)
    : {};
  if (params.resolvedColor) selection.color = params.resolvedColor;

  const gated = gateConfirmWhenVariantsInvalid({
    nextAction: params.nextAction,
    product: params.product,
    selection,
    language: params.language,
    replyText: params.replyText,
  });

  let replyText = gated.replyText;
  const catalogColors = params.product?.colors;
  const invalidResolved =
    Boolean(params.resolvedColor) &&
    !isColorInProductCatalog(params.resolvedColor, catalogColors);
  if (
    gated.missingAxis?.id === 'color' &&
    catalogColors?.length &&
    (invalidResolved || params.rejectedColor)
  ) {
    replyText = buildUnavailableColorMessage(
      params.language === 'english' ? 'english' : 'arabic',
      catalogColors,
      params.resolvedColor || params.rejectedColor
    );
  }

  return {
    nextAction: gated.nextAction,
    replyText,
    awaitingConfirmation: gated.nextAction === AWAIT_CONFIRMATION_ACTION,
  };
}
