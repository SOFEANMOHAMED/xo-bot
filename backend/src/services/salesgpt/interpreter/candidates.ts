/**
 * Closed candidate lists for the interpreter — never the full catalog.
 */
import { searchProducts } from '../../../catalog/product-search.js';
import type { CartItem, ConversationState, Message, Product } from '../../../core/types.js';
import { ensureLineId } from '../cartLineOps.js';
import { findProductsMentionedInText, getCartItems } from '../conversationCart.js';
import { axisById } from '../variantEngine/axes.js';
import type { InterpreterCartLine, InterpreterInput, InterpreterStateSummary } from './types.js';

const SEARCH_TOP_N = 8;

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function cartLineToInterpreter(
  line: CartItem,
  product: Product | undefined
): InterpreterCartLine {
  const withId = ensureLineId(line);
  const colorAxis = product ? axisById(product, 'color') : null;
  const sizeAxis = product ? axisById(product, 'size') : null;
  return {
    lineId: withId.lineId,
    productId: withId.productId,
    productName: withId.productName,
    color: withId.color ?? null,
    size: withId.size ?? null,
    quantity: withId.quantity,
    currency: withId.currency,
    allowedColors: colorAxis?.values ?? [],
    allowedSizes: sizeAxis?.values ?? [],
  };
}

export function buildStateSummary(
  state: ConversationState,
  pendingKind: string | null,
  pendingProductId: string | null,
  /** Authoritative focus from resolveTurnFocus (message / post-seed / cart). */
  resolvedFocusProductId?: string | null
): InterpreterStateSummary {
  return {
    // Prefer the turn's resolved focus — never let a stale seed in state
    // override a product the customer just named in this message.
    focusProductId:
      resolvedFocusProductId ||
      state.extracted_entities?.product_id ||
      state.last_recommended_products?.[0] ||
      null,
    pendingBotQuestion: pendingKind,
    pendingProductId,
    awaitingOrderConfirmation: Boolean(state.awaiting_order_confirmation),
    cartStatus: state.cart?.status === 'checking_out' ? 'checking_out' : state.cart ? 'building' : null,
  };
}

export async function buildInterpreterCandidates(opts: {
  merchantId: string;
  message: string;
  recentMessages: Message[];
  conversationState: ConversationState;
  catalog: Product[];
  focusProductId: string | null;
  mentioned: Product[];
  pendingKind: string | null;
  pendingProductId: string | null;
}): Promise<{
  input: InterpreterInput;
  productsById: Map<string, Product>;
}> {
  const productsById = new Map<string, Product>();
  for (const p of opts.catalog) {
    if (p?.id) productsById.set(p.id, p);
  }
  for (const p of opts.mentioned) {
    if (p?.id) productsById.set(p.id, p);
  }

  const cartItems = getCartItems(opts.conversationState);
  const cartIds = cartItems.map((line) => line.productId);

  let searchIds: string[] = [];
  if (opts.mentioned.length === 0 && opts.message.trim()) {
    const found = await searchProducts(opts.merchantId, opts.message, { inStockOnly: false }, SEARCH_TOP_N);
    for (const p of found) {
      if (p?.id) {
        productsById.set(p.id, p);
        searchIds.push(p.id);
      }
    }
  }

  const recentUserMentions: string[] = [];
  for (const msg of opts.recentMessages.slice(-6)) {
    if (msg.role !== 'user') continue;
    for (const p of findProductsMentionedInText(msg.content || '', opts.catalog)) {
      productsById.set(p.id, p);
      recentUserMentions.push(p.id);
    }
  }

  const allowedProductIds = uniqueIds([
    opts.focusProductId,
    opts.pendingProductId,
    ...cartIds,
    ...opts.mentioned.map((p) => p.id),
    ...recentUserMentions,
    ...searchIds,
  ]).slice(0, SEARCH_TOP_N);

  const cartLines = cartItems.map((line) =>
    cartLineToInterpreter(line, productsById.get(line.productId))
  );

  const ensureDraftLine = (productId: string | null | undefined): void => {
    if (!productId) return;
    if (cartLines.some((line) => line.productId === productId)) return;
    const product = productsById.get(productId);
    if (!product) return;
    cartLines.push(
      cartLineToInterpreter(
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPrice: product.price,
          currency: product.currency || 'USD',
          addedAt: new Date().toISOString(),
        },
        product
      )
    );
  };
  ensureDraftLine(opts.pendingProductId);
  ensureDraftLine(opts.focusProductId);

  const recentMessages = opts.recentMessages.slice(-6).map((m) => ({
    role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: m.content || '',
  }));

  return {
    productsById,
    input: {
      message: opts.message,
      recentMessages,
      stateSummary: buildStateSummary(
        opts.conversationState,
        opts.pendingKind,
        opts.pendingProductId,
        opts.focusProductId
      ),
      allowedProductIds,
      cartLines,
    },
  };
}
