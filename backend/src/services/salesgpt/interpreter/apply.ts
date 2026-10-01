/**
 * Apply validated interpreter actions. Never persists an order (affirm only).
 */
import type { ConversationState, Product } from '../../../core/types.js';
import { ensureLineId, removeCartLineById, updateCartLineById } from '../cartLineOps.js';
import {
  addItemToCart,
  buildCartItemFromDraft,
  clearCart,
  getCartItems,
  normalizeCart,
} from '../conversationCart.js';
import { setLineVariant } from '../variantEngine/line.js';
import type {
  InterpreterAction,
  InterpreterActionType,
  InterpreterResult,
} from './types.js';

export type InterpreterApplyResult = {
  state: ConversationState;
  applied: InterpreterActionType[];
  focusProductId: string | null;
  /** True when an action this turn intentionally changed focus (not inherited state). */
  focusExplicitlyChanged: boolean;
  wantsPhoto: boolean;
  refusesPhoto: boolean;
  affirmsOrder: boolean;
  deniesOrder: boolean;
  handoffHuman: boolean;
  browseCatalog: boolean;
  infoKind: 'price' | 'details' | 'availability' | null;
  clarification: boolean;
};

function productName(product: Product | undefined, fallback: string): string {
  return product?.name || fallback;
}

/**
 * Resolve a real cart lineId for variant/qty writes.
 * Candidate lists may pass a phantom lineId that is not in state.cart — ignore it
 * and create a real line from the product draft when needed.
 */
function resolveOrCreateCartLineId(opts: {
  state: ConversationState;
  productsById: Map<string, Product>;
  storeCurrency?: string;
  productId: string | null | undefined;
  preferredLineId?: string | null;
  color?: string | null;
  size?: string | null;
  quantity?: number | null;
}): { state: ConversationState; lineId: string | null } {
  const productId = opts.productId || null;
  let state = opts.state;
  // Persist ensureLineId onto the cart so returned lineIds stay addressable.
  const items = getCartItems(state).map(ensureLineId);
  if (items.some((row, i) => row.lineId !== getCartItems(state)[i]?.lineId)) {
    state = {
      ...state,
      cart: normalizeCart({
        items,
        status: state.cart?.status || 'building',
      }),
    };
  }

  if (opts.preferredLineId && items.some((row) => row.lineId === opts.preferredLineId)) {
    return { state, lineId: opts.preferredLineId };
  }

  if (productId) {
    const byProduct = items.find((row) => row.productId === productId);
    if (byProduct?.lineId) {
      return { state, lineId: byProduct.lineId };
    }
  }

  if (!productId) return { state, lineId: null };
  const product = opts.productsById.get(productId);
  const draft = buildCartItemFromDraft({
    entities: {
      ...(state.extracted_entities || {}),
      product_id: productId,
      product_query: productName(product, state.extracted_entities?.product_query || ''),
      color: opts.color ?? state.extracted_entities?.color,
      size: opts.size ?? state.extracted_entities?.size,
      quantity: opts.quantity ?? state.extracted_entities?.quantity,
    },
    product,
    currency: opts.storeCurrency,
  });
  if (!draft) return { state, lineId: null };

  const withId = ensureLineId(draft);
  state = {
    ...state,
    cart: addItemToCart(state.cart, withId),
  };
  return { state, lineId: withId.lineId };
}

export function applyInterpreterResult(opts: {
  result: InterpreterResult;
  state: ConversationState;
  productsById: Map<string, Product>;
  storeCurrency?: string;
}): InterpreterApplyResult {
  let state: ConversationState = {
    ...opts.state,
    extracted_entities: { ...(opts.state.extracted_entities || {}) },
  };
  const applied: InterpreterActionType[] = [];
  let focusProductId = state.extracted_entities?.product_id || null;
  let focusExplicitlyChanged = false;
  let wantsPhoto = false;
  let refusesPhoto = false;
  let affirmsOrder = false;
  let deniesOrder = false;
  let handoffHuman = false;
  let browseCatalog = false;
  let infoKind: InterpreterApplyResult['infoKind'] = null;
  let clarification = false;

  const setFocus = (productId: string): void => {
    const product = opts.productsById.get(productId);
    focusProductId = productId;
    focusExplicitlyChanged = true;
    state.extracted_entities = {
      ...(state.extracted_entities || {}),
      product_id: productId,
      product_query: productName(product, state.extracted_entities?.product_query || ''),
    };
  };

  const applyOne = (action: InterpreterAction): void => {
    switch (action.type) {
      case 'set_focus_product': {
        if (!action.productId) return;
        setFocus(action.productId);
        applied.push(action.type);
        return;
      }
      case 'ask_clarification':
        clarification = true;
        applied.push(action.type);
        return;
      case 'select_color': {
        if (!action.color) return;
        const resolved = resolveOrCreateCartLineId({
          state,
          productsById: opts.productsById,
          storeCurrency: opts.storeCurrency,
          productId: action.productId || focusProductId,
          preferredLineId: action.lineId,
          color: action.color,
        });
        state = resolved.state;
        const lineId = resolved.lineId;
        if (lineId) {
          const items = getCartItems(state).map(ensureLineId);
          let next = updateCartLineById(items, lineId, { color: action.color });
          next = next.map((row) =>
            row.lineId === lineId ? setLineVariant(row, 'color', action.color as string) : row
          );
          state.cart = normalizeCart({ items: next, status: state.cart?.status || 'building' });
        }
        state.extracted_entities = {
          ...(state.extracted_entities || {}),
          color: action.color,
          product_id: action.productId || state.extracted_entities?.product_id,
        };
        applied.push(action.type);
        return;
      }
      case 'select_size': {
        if (!action.size) return;
        const resolved = resolveOrCreateCartLineId({
          state,
          productsById: opts.productsById,
          storeCurrency: opts.storeCurrency,
          productId: action.productId || focusProductId,
          preferredLineId: action.lineId,
          size: action.size,
        });
        state = resolved.state;
        const lineId = resolved.lineId;
        if (lineId) {
          const items = getCartItems(state).map(ensureLineId);
          let next = updateCartLineById(items, lineId, { size: action.size });
          next = next.map((row) =>
            row.lineId === lineId ? setLineVariant(row, 'size', action.size as string) : row
          );
          state.cart = normalizeCart({ items: next, status: state.cart?.status || 'building' });
        }
        state.extracted_entities = {
          ...(state.extracted_entities || {}),
          size: action.size,
          product_id: action.productId || state.extracted_entities?.product_id,
        };
        applied.push(action.type);
        return;
      }
      case 'correct_variant': {
        // Color and/or size — size-only corrections must mutate the cart (not color-only).
        if (!action.color && !action.size) return;
        const resolved = resolveOrCreateCartLineId({
          state,
          productsById: opts.productsById,
          storeCurrency: opts.storeCurrency,
          productId: action.productId || focusProductId,
          preferredLineId: action.lineId,
          color: action.color,
          size: action.size,
        });
        state = resolved.state;
        const lineId = resolved.lineId;
        if (lineId) {
          let next = getCartItems(state).map(ensureLineId);
          if (action.color) {
            next = updateCartLineById(next, lineId, { color: action.color }).map(ensureLineId);
            next = next.map((row) =>
              row.lineId === lineId ? ensureLineId(setLineVariant(row, 'color', action.color as string)) : row
            );
          }
          if (action.size) {
            next = updateCartLineById(next, lineId, { size: action.size }).map(ensureLineId);
            next = next.map((row) =>
              row.lineId === lineId ? ensureLineId(setLineVariant(row, 'size', action.size as string)) : row
            );
          }
          state.cart = normalizeCart({ items: next, status: state.cart?.status || 'building' });
        }
        state.extracted_entities = {
          ...(state.extracted_entities || {}),
          ...(action.color ? { color: action.color } : {}),
          ...(action.size ? { size: action.size } : {}),
          product_id: action.productId || state.extracted_entities?.product_id,
        };
        applied.push(action.type);
        return;
      }
      case 'set_quantity': {
        if (typeof action.quantity !== 'number' || action.quantity <= 0) return;
        const qty = Math.min(Math.floor(action.quantity), 99);
        const resolved = resolveOrCreateCartLineId({
          state,
          productsById: opts.productsById,
          storeCurrency: opts.storeCurrency,
          productId: action.productId || focusProductId,
          preferredLineId: action.lineId,
          quantity: qty,
        });
        state = resolved.state;
        const lineId = resolved.lineId;
        if (lineId) {
          state.cart = normalizeCart({
            items: updateCartLineById(getCartItems(state).map(ensureLineId), lineId, {
              quantity: qty,
            }),
            status: state.cart?.status || 'building',
          });
        }
        state.extracted_entities = {
          ...(state.extracted_entities || {}),
          quantity: qty,
        };
        applied.push(action.type);
        return;
      }
      case 'add_product': {
        if (!action.productId) return;
        const product = opts.productsById.get(action.productId);
        const draft = buildCartItemFromDraft({
          entities: {
            ...(state.extracted_entities || {}),
            product_id: action.productId,
            product_query: productName(product, ''),
            color: action.color,
            size: action.size,
            quantity: action.quantity,
          },
          product,
          currency: opts.storeCurrency,
        });
        if (!draft) return;
        const cart = addItemToCart(state.cart, draft);
        state.cart = cart;
        setFocus(action.productId);
        state.extracted_entities = {
          ...(state.extracted_entities || {}),
          product_id: action.productId,
          product_query: draft.productName,
        };
        applied.push(action.type);
        return;
      }
      case 'remove_line': {
        const items = getCartItems(state).map(ensureLineId);
        const lineId =
          action.lineId ||
          items.find((row) => row.productId === action.productId)?.lineId;
        if (!lineId) return;
        let next = removeCartLineById(items, lineId);
        if (next.length === items.length && action.productId) {
          next = items.filter((row) => row.productId !== action.productId);
        }
        if (next.length === items.length) return;
        state.cart = normalizeCart({ items: next, status: state.cart?.status || 'building' });
        applied.push(action.type);
        return;
      }
      case 'cancel_order':
        state = clearCart(state);
        state.awaiting_order_confirmation = false;
        applied.push(action.type);
        return;
      case 'request_photo':
        wantsPhoto = true;
        state.extracted_entities = {
          ...(state.extracted_entities || {}),
          wants_image: true,
        };
        applied.push(action.type);
        return;
      case 'refuse_photo':
        refusesPhoto = true;
        state.extracted_entities = {
          ...(state.extracted_entities || {}),
          wants_image: false,
        };
        applied.push(action.type);
        return;
      case 'browse_catalog':
        browseCatalog = true;
        applied.push(action.type);
        return;
      case 'ask_product_info':
        infoKind = action.infoKind || 'details';
        // Customer asked about a specific SKU — that product becomes focus,
        // even if a post-seed / prior focus pointed elsewhere.
        if (action.productId) {
          setFocus(action.productId);
        }
        applied.push(action.type);
        return;
      case 'provide_identity_field': {
        if (!action.identityField || !action.identityValue?.trim()) return;
        const value = action.identityValue.trim();
        // Same snapshot the agent ingest path writes (entities feed collectedInfo).
        state.extracted_entities = {
          ...(state.extracted_entities || {}),
          [action.identityField]: value,
        };
        applied.push(action.type);
        return;
      }
      case 'affirm_order':
        affirmsOrder = true;
        applied.push(action.type);
        return;
      case 'deny_order':
        deniesOrder = true;
        applied.push(action.type);
        return;
      case 'handoff_human':
        handoffHuman = true;
        applied.push(action.type);
        return;
      default:
        return;
    }
  };

  for (const action of opts.result.actions) {
    applyOne(action);
  }

  return {
    state,
    applied,
    focusProductId,
    focusExplicitlyChanged,
    wantsPhoto,
    refusesPhoto,
    affirmsOrder,
    deniesOrder,
    handoffHuman,
    browseCatalog,
    infoKind,
    clarification,
  };
}
