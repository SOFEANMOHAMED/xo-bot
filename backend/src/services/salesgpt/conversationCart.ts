/**
 * Deterministic conversation cart — code owns writes; the model only sees summaries.
 *
 * Draft = extracted_entities product fields (one active SKU being discussed).
 * Cart  = locked lines ready for checkout / ORDER_DATA.
 */

import type {
  CartItem,
  ConversationCart,
  ConversationState,
  Entities,
  Language,
  Product,
} from '../../core/types.js';
import {
  isPlaceholderCollectedValue,
  sanitizeCollectedText,
} from './orderConfirmationPolicy.js';
import { isColorInProductCatalog } from './orderColorPolicy.js';
import { colorsMatch, matchColorOption } from '../../catalog/color-options.js';
import { normalizeArabic } from '../../catalog/product-search.js';

export const ADD_TO_CART_ACTION = 'add_to_cart';

export type CartMergeMode = 'set' | 'increment';
/** fill = checkout/await (never duplicate). add = explicit extra line. */
export type CartDraftIntent = 'fill' | 'add';

function emptyCart(): ConversationCart {
  return { items: [], status: 'building', updatedAt: new Date().toISOString() };
}

export function normalizeCart(cart: ConversationCart | null | undefined): ConversationCart {
  if (!cart || !Array.isArray(cart.items)) {
    return emptyCart();
  }
  const items = cart.items
    .filter((item): item is CartItem =>
      !!item &&
      typeof item.productId === 'string' &&
      item.productId.trim().length > 0 &&
      typeof item.productName === 'string' &&
      item.productName.trim().length > 0
    )
    .map((item) => ({
      productId: item.productId.trim(),
      productName: item.productName.trim(),
      quantity:
        typeof item.quantity === 'number' && item.quantity > 0
          ? Math.min(Math.floor(item.quantity), 99)
          : 1,
      unitPrice:
        typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice)
          ? item.unitPrice
          : 0,
      currency: (item.currency || 'USD').trim() || 'USD',
      color: sanitizeCollectedText(item.color),
      size: sanitizeCollectedText(item.size),
      addedAt: item.addedAt || new Date().toISOString(),
    }));
  return {
    items,
    status: cart.status === 'checking_out' ? 'checking_out' : 'building',
    updatedAt: cart.updatedAt || new Date().toISOString(),
  };
}

export function getCartItems(state: ConversationState | null | undefined): CartItem[] {
  return normalizeCart(state?.cart).items;
}

export function cartHasItems(state: ConversationState | null | undefined): boolean {
  return getCartItems(state).length > 0;
}

function cartLineKey(item: Pick<CartItem, 'productId' | 'color' | 'size'>): string {
  return `${item.productId}::${item.color || ''}::${item.size || ''}`;
}

function specifiedVariant(value?: string): string | undefined {
  return sanitizeCollectedText(value);
}

function sizesEquivalent(a?: string, b?: string): boolean {
  const na = specifiedVariant(a);
  const nb = specifiedVariant(b);
  if (!na || !nb) return false;
  return normalizeArabic(na) === normalizeArabic(nb);
}

function colorsEquivalent(a?: string, b?: string): boolean {
  const na = specifiedVariant(a);
  const nb = specifiedVariant(b);
  if (!na || !nb) return false;
  return colorsMatch(na, nb);
}

/** Both sides specified and not the same option — a real second variant. */
function variantConflict(
  existing: string | undefined,
  incoming: string | undefined,
  kind: 'color' | 'size'
): boolean {
  const e = specifiedVariant(existing);
  const i = specifiedVariant(incoming);
  if (!e || !i) return false;
  return kind === 'color' ? !colorsEquivalent(e, i) : !sizesEquivalent(e, i);
}

function isCompatibleCartLine(existing: CartItem, incoming: CartItem): boolean {
  if (existing.productId !== incoming.productId) return false;
  return (
    !variantConflict(existing.color, incoming.color, 'color') &&
    !variantConflict(existing.size, incoming.size, 'size')
  );
}

/**
 * Prefer exact variant key, then same product with fillable (blank) color/size.
 * Returns -1 when the incoming line is a distinct variant or a different product.
 */
export function findCompatibleCartLineIndex(
  items: CartItem[],
  incoming: Pick<CartItem, 'productId' | 'color' | 'size'>
): number {
  const exact = items.findIndex((row) => cartLineKey(row) === cartLineKey(incoming));
  if (exact >= 0) return exact;
  return items.findIndex((row) => isCompatibleCartLine(row, incoming as CartItem));
}

function canonicalizeLineColor(
  color: string | undefined,
  product?: Product | null
): string | undefined {
  const raw = specifiedVariant(color);
  if (!raw) return undefined;
  if (product?.colors && product.colors.length > 0) {
    const matched = matchColorOption(raw, product.colors).matched;
    if (matched) return matched;
  }
  return raw;
}

function mergeCartLine(
  prev: CartItem,
  incoming: CartItem,
  options: { keepQuantity: boolean; qtyMode: CartMergeMode }
): CartItem {
  const nextQty = options.keepQuantity
    ? prev.quantity
    : options.qtyMode === 'increment'
      ? Math.min(prev.quantity + incoming.quantity, 99)
      : Math.min(incoming.quantity > 0 ? incoming.quantity : prev.quantity, 99);

  const prevColor = specifiedVariant(prev.color);
  const incomingColor = specifiedVariant(incoming.color);
  const color =
    prevColor && incomingColor && colorsEquivalent(prevColor, incomingColor)
      ? incomingColor
      : prevColor || incomingColor;

  const prevSize = specifiedVariant(prev.size);
  const incomingSize = specifiedVariant(incoming.size);
  const size =
    prevSize && incomingSize && sizesEquivalent(prevSize, incomingSize)
      ? incomingSize
      : prevSize || incomingSize;

  return {
    ...prev,
    quantity: nextQty,
    unitPrice: incoming.unitPrice || prev.unitPrice,
    currency: incoming.currency || prev.currency,
    productName: incoming.productName || prev.productName,
    color,
    size,
    addedAt: prev.addedAt || incoming.addedAt,
  };
}

/** Draft line completeness for the product currently under discussion. */
export function isDraftLineComplete(
  entities: Entities | null | undefined,
  product?: Product | null
): { complete: boolean; missing: string[] } {
  const e = entities || {};
  const missing: string[] = [];

  const hasProduct = !!(
    product ||
    sanitizeCollectedText(e.product_id) ||
    sanitizeCollectedText(e.product_query)
  );
  if (!hasProduct) missing.push('product');

  if (product) {
    const hasColors = Array.isArray(product.colors) && product.colors.length > 0;
    const hasSizes = Array.isArray(product.sizes) && product.sizes.length > 0;
    if (hasColors && isPlaceholderCollectedValue(e.color)) missing.push('color');
    if (
      hasColors &&
      !isPlaceholderCollectedValue(e.color) &&
      !isColorInProductCatalog(e.color, product.colors)
    ) {
      missing.push('color');
    }
    if (hasSizes && isPlaceholderCollectedValue(e.size)) missing.push('size');
  }

  return { complete: missing.length === 0, missing };
}

/** Checkout ready: identity + cart lines (or a complete draft if the cart is empty). */
export function isCheckoutReady(
  state: ConversationState,
  product?: Product | null
): { complete: boolean; missing: string[] } {
  const e = state.extracted_entities || {};
  const missing: string[] = [];

  if (isPlaceholderCollectedValue(e.name)) missing.push('name');
  if (isPlaceholderCollectedValue(e.phone)) missing.push('phone');
  if (isPlaceholderCollectedValue(e.address)) missing.push('address');

  const items = getCartItems(state);
  if (items.length === 0) {
    const draft = isDraftLineComplete(e, product);
    if (!draft.complete) {
      missing.push(...draft.missing);
    }
    return { complete: missing.length === 0, missing };
  }

  if (product) {
    const line = items.find((item) => item.productId === product.id);
    const colorSource = specifiedVariant(line?.color) || specifiedVariant(e.color);
    const sizeSource = specifiedVariant(line?.size) || specifiedVariant(e.size);
    const hasColors = Array.isArray(product.colors) && product.colors.length > 0;
    const hasSizes = Array.isArray(product.sizes) && product.sizes.length > 0;
    if (hasColors && isPlaceholderCollectedValue(colorSource)) missing.push('color');
    if (
      hasColors &&
      !isPlaceholderCollectedValue(colorSource) &&
      !isColorInProductCatalog(colorSource, product.colors)
    ) {
      missing.push('color');
    }
    if (hasSizes && isPlaceholderCollectedValue(sizeSource)) missing.push('size');
  }

  return { complete: missing.length === 0, missing };
}

export function buildCartItemFromDraft(params: {
  entities: Entities;
  product?: Product | null;
  currency?: string;
}): CartItem | null {
  const { entities, product, currency } = params;
  const productId =
    sanitizeCollectedText(entities.product_id) ||
    (product?.id ? String(product.id) : undefined);
  const productName =
    sanitizeCollectedText(product?.name) ||
    sanitizeCollectedText(entities.product_query);

  if (!productId || !productName) return null;

  const qtyRaw = entities.quantity;
  const quantity =
    typeof qtyRaw === 'number' && qtyRaw > 0 ? Math.min(Math.floor(qtyRaw), 99) : 1;

  return {
    productId,
    productName,
    quantity,
    unitPrice:
      typeof product?.price === 'number' && Number.isFinite(product.price)
        ? product.price
        : 0,
    currency: currency || product?.currency || 'USD',
    color: canonicalizeLineColor(entities.color, product),
    size: sanitizeCollectedText(entities.size),
    addedAt: new Date().toISOString(),
  };
}

/**
 * Upsert cart line using compatible-variant matching (blank color/size fills the existing line).
 * Distinct complete variants of the same product still append as a new line.
 */
export function addItemToCart(
  cart: ConversationCart | null | undefined,
  item: CartItem,
  mode: CartMergeMode = 'set'
): ConversationCart {
  const normalized = normalizeCart(cart);
  const matchIdx = findCompatibleCartLineIndex(normalized.items, item);

  const items = [...normalized.items];
  if (matchIdx >= 0) {
    items[matchIdx] = mergeCartLine(items[matchIdx], item, {
      keepQuantity: false,
      qtyMode: mode,
    });
  } else {
    items.push(item);
  }

  return {
    items,
    status: 'building',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Apply a complete draft line.
 * - fill: merge onto a compatible existing line; never append when the cart already has items.
 * - add: merge compatible, otherwise append (including a second explicit variant).
 */
export function applyDraftToCart(
  cart: ConversationCart | null | undefined,
  item: CartItem,
  intent: CartDraftIntent,
  qtyMode: CartMergeMode = 'set'
): { cart: ConversationCart; item: CartItem; appended: boolean } {
  const normalized = normalizeCart(cart);
  const compatibleIdx = findCompatibleCartLineIndex(normalized.items, item);

  if (compatibleIdx >= 0) {
    const merged = mergeCartLine(normalized.items[compatibleIdx], item, {
      keepQuantity: intent === 'fill',
      qtyMode,
    });
    const items = [...normalized.items];
    items[compatibleIdx] = merged;
    return {
      cart: { items, status: 'building', updatedAt: new Date().toISOString() },
      item: merged,
      appended: false,
    };
  }

  if (intent === 'fill') {
    const sameProductIdx = normalized.items.findIndex((row) => row.productId === item.productId);
    if (sameProductIdx >= 0) {
      const existing = normalized.items[sameProductIdx];
      return { cart: normalized, item: existing, appended: false };
    }
    if (normalized.items.length > 0) {
      return {
        cart: normalized,
        item: normalized.items[normalized.items.length - 1],
        appended: false,
      };
    }
  }

  const items = [...normalized.items, item];
  return {
    cart: { items, status: 'building', updatedAt: new Date().toISOString() },
    item,
    appended: true,
  };
}

/**
 * Write draft color/size onto the matching cart line without adding SKUs.
 * Safe mid-conversation (does not require a complete draft, does not clear entities).
 */
export function fillCartVariantsFromDraft(
  state: ConversationState,
  product?: Product | null
): ConversationState {
  const items = getCartItems(state);
  if (items.length === 0) return state;

  const entities = state.extracted_entities || {};
  const productId =
    sanitizeCollectedText(entities.product_id) ||
    (product?.id ? String(product.id) : undefined);
  if (!productId) return state;

  const color = canonicalizeLineColor(entities.color, product);
  const size = sanitizeCollectedText(entities.size);
  if (!color && !size) return state;

  const stub: CartItem = {
    productId,
    productName:
      sanitizeCollectedText(product?.name) ||
      sanitizeCollectedText(entities.product_query) ||
      items.find((row) => row.productId === productId)?.productName ||
      'Product',
    quantity: 1,
    unitPrice: 0,
    currency: items.find((row) => row.productId === productId)?.currency || 'USD',
    color,
    size,
    addedAt: new Date().toISOString(),
  };

  const idx = findCompatibleCartLineIndex(items, stub);
  const target =
    idx >= 0 ? idx : items.findIndex((row) => row.productId === productId);
  if (target < 0) return state;

  const nextItems = [...items];
  nextItems[target] = mergeCartLine(nextItems[target], stub, {
    keepQuantity: true,
    qtyMode: 'set',
  });

  return {
    ...state,
    cart: {
      items: nextItems,
      status: state.cart?.status === 'checking_out' ? 'checking_out' : 'building',
      updatedAt: new Date().toISOString(),
    },
  };
}

/** Replace entire cart contents (multi-buy / customer correction). Keeps variants already locked. */
export function replaceCartItems(
  state: ConversationState,
  items: CartItem[]
): ConversationState {
  const previous = getCartItems(state);
  const preserved = items.map((item) => {
    const prior = previous.find((row) => row.productId === item.productId);
    if (!prior) return item;
    return {
      ...item,
      color: specifiedVariant(item.color) || specifiedVariant(prior.color),
      size: specifiedVariant(item.size) || specifiedVariant(prior.size),
    };
  });

  return {
    ...state,
    cart: {
      items: normalizeCart({ items: preserved, status: 'building' }).items,
      status: 'building',
      updatedAt: new Date().toISOString(),
    },
    extracted_entities: clearProductDraftFields(state.extracted_entities),
    last_recommended_products: preserved.map((i) => i.productId),
    awaiting_order_confirmation: false,
  };
}

/** Clear product draft fields; keep customer identity. */
export function clearProductDraftFields(entities: Entities | null | undefined): Entities {
  const next: Entities = { ...(entities || {}) };
  delete next.product_query;
  delete next.product_id;
  delete next.color;
  delete next.size;
  delete next.quantity;
  delete next.wants_image;
  delete next.wants_color_info;
  delete next.wants_size_info;
  return next;
}

/**
 * Lock current draft into cart when complete (add-another / first SKU).
 * Compatible blank-variant lines are filled; distinct variants append.
 */
export function lockDraftIntoCart(
  state: ConversationState,
  product?: Product | null,
  currency?: string
): { state: ConversationState; locked: boolean; item: CartItem | null } {
  const entities = state.extracted_entities || {};
  const draft = isDraftLineComplete(entities, product);
  if (!draft.complete) {
    return { state, locked: false, item: null };
  }

  const item = buildCartItemFromDraft({ entities, product, currency });
  if (!item) {
    return { state, locked: false, item: null };
  }

  const applied = applyDraftToCart(state.cart, item, 'add', 'set');
  return {
    state: {
      ...state,
      cart: applied.cart,
      extracted_entities: clearProductDraftFields(entities),
      last_recommended_products: applied.cart.items.map((i) => i.productId),
      awaiting_order_confirmation: false,
    },
    locked: true,
    item: applied.item,
  };
}

/**
 * Checkout/await: fill variants onto existing lines; promote draft only when the cart is empty.
 * Never append a leftover focused SKU on top of an already-populated cart.
 */
export function ensureCartForCheckout(
  state: ConversationState,
  product?: Product | null,
  currency?: string
): ConversationState {
  let next = fillCartVariantsFromDraft(state, product);

  if (getCartItems(next).length === 0) {
    const draft = isDraftLineComplete(next.extracted_entities, product);
    if (draft.complete) {
      const item = buildCartItemFromDraft({
        entities: next.extracted_entities || {},
        product,
        currency,
      });
      if (item) {
        const applied = applyDraftToCart(next.cart, item, 'fill', 'set');
        next = {
          ...next,
          cart: applied.cart,
          extracted_entities: clearProductDraftFields(next.extracted_entities),
          last_recommended_products: applied.cart.items.map((i) => i.productId),
        };
      }
    }
  } else {
    // Cart already has SKUs: leftover focused-product draft must not become a new line.
    next = {
      ...next,
      extracted_entities: clearProductDraftFields(next.extracted_entities),
    };
  }

  if (getCartItems(next).length === 0) return state;

  const cart = normalizeCart(next.cart);
  return {
    ...next,
    cart: { ...cart, status: 'checking_out', updatedAt: new Date().toISOString() },
  };
}

export function clearCart(state: ConversationState): ConversationState {
  const next = { ...state };
  delete next.cart;
  return next;
}

export function cartItemsToOrderProducts(items: CartItem[]): Array<{
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  currency: string;
  variant?: { size?: string; color?: string };
}> {
  return items.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    price: item.unitPrice,
    currency: item.currency,
    variant:
      item.color || item.size
        ? { color: item.color, size: item.size }
        : undefined,
  }));
}

export function formatCartLine(item: CartItem, language: Language): string {
  const parts = [item.productName];
  if (item.color) parts.push(item.color);
  if (item.size) parts.push(item.size);
  const label = parts.join(' — ');
  return language === 'arabic'
    ? `• ${label} × ${item.quantity}`
    : `• ${label} × ${item.quantity}`;
}

export function formatCartSummary(
  items: CartItem[],
  language: Language
): string {
  if (items.length === 0) {
    return language === 'arabic' ? 'السلة فارغة' : 'Cart is empty';
  }
  return items.map((item) => formatCartLine(item, language)).join('\n');
}

export function cartProductIds(items: CartItem[]): string[] {
  return [...new Set(items.map((i) => i.productId).filter(Boolean))];
}

export function cartNotesFragment(items: CartItem[]): string {
  if (items.length === 0) return '';
  return items
    .map((item) => {
      const bits = [`${item.productName} × ${item.quantity}`];
      if (item.color) bits.push(`اللون: ${item.color}`);
      if (item.size) bits.push(`المقاس: ${item.size}`);
      return bits.join(' — ');
    })
    .join('\n');
}

/** "الاتنين / التنين / كلاهما" — means both products, NOT quantity 2. */
export function messageSignalsBothProducts(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  const t = normalizeArabic(messageText);
  return (
    /(?:^|\s)(الاتنين|التنين|الاتنين|كلاهما|كليهما)(?:\s|$)/.test(t) ||
    /\bboth\b/.test(messageText.toLowerCase()) ||
    /\bthe\s+two\b/.test(messageText.toLowerCase())
  );
}

/**
 * Customer is correcting cart composition ("قميص واحد وساعة", "لا بدي …").
 */
export function messageSignalsCartCorrection(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  const t = normalizeArabic(messageText);
  return (
    /^(لا|لأ|مو|مش)\b/.test(t) ||
    /\b(عدل|غير|بدل|صحح|تصحيح)\b/.test(t) ||
    /\b(واحد|واحده|واحدة)\b/.test(t) ||
    /\b(not|instead|only\s+one|one\s+.+\s+and)\b/i.test(messageText)
  );
}

/**
 * Drop bogus quantity=2 when the customer meant "both products".
 */
export function coerceSafeQuantity(
  messageText: string,
  quantity: number | null | undefined
): number | undefined {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    return undefined;
  }
  const q = Math.min(Math.floor(quantity), 99);
  if (q === 2 && messageSignalsBothProducts(messageText)) {
    return undefined;
  }
  return q;
}

/**
 * Match catalog products whose names appear in the user message (longest name first).
 * Tenant-scoped: caller must pass only this merchant's products.
 */
export function findProductsMentionedInText(
  messageText: string,
  catalog: Product[]
): Product[] {
  if (!messageText?.trim() || !catalog.length) return [];
  const hay = normalizeArabic(messageText);
  if (!hay) return [];

  const scored = catalog
    .map((product) => {
      const name = normalizeArabic(product.name || '');
      if (name.length < 2) return null;
      // Require full name token match, or stem without trailing ه/ات for plurals
      const stem = name.replace(/(ات|ين|ون|ه)$/u, '');
      const matched =
        hay.includes(name) ||
        (stem.length >= 3 && hay.includes(stem));
      if (!matched) return null;
      return { product, score: name.length };
    })
    .filter((row): row is { product: Product; score: number } => !!row)
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const out: Product[] = [];
  for (const row of scored) {
    if (seen.has(row.product.id)) continue;
    seen.add(row.product.id);
    out.push(row.product);
  }
  return out;
}

/** Per-product quantity hints near the product name (default 1). */
export function quantityNearProductName(
  messageText: string,
  productName: string
): number {
  const hay = normalizeArabic(messageText);
  const name = normalizeArabic(productName);
  if (!hay || !name) return 1;

  const stem = name.replace(/(ات|ين|ون|ه)$/u, '');
  const needle = hay.includes(name) ? name : stem.length >= 3 ? stem : name;
  const idx = hay.indexOf(needle);
  if (idx < 0) return 1;

  const window = hay.slice(Math.max(0, idx - 12), idx + needle.length + 12);
  if (/(واحد|واحده|واحده|واحدة|\b1\b)/.test(window)) return 1;
  if (/(ثلاث|ثلاثة|\b3\b)/.test(window)) return 3;
  // Avoid treating "التنين" as qty 2 — only digit/كلمة ثنين away from both-products phrase
  if (!messageSignalsBothProducts(messageText) && /(ثنين|اثنين|\b2\b)/.test(window)) {
    return 2;
  }
  return 1;
}

export function buildCartItemsFromProducts(
  products: Product[],
  messageText: string,
  currency?: string
): CartItem[] {
  const now = new Date().toISOString();
  return products.map((product) => ({
    productId: product.id,
    productName: product.name,
    quantity: quantityNearProductName(messageText, product.name),
    unitPrice:
      typeof product.price === 'number' && Number.isFinite(product.price)
        ? product.price
        : 0,
    currency: currency || product.currency || 'USD',
    addedAt: now,
  }));
}

/**
 * True when message should rebuild the cart from multiple named products.
 */
export function shouldSyncMultiProductCart(
  messageText: string,
  mentioned: Product[]
): boolean {
  if (mentioned.length < 1) return false;

  const orderish =
    messageSignalsBothProducts(messageText) ||
    messageSignalsCartCorrection(messageText) ||
    /(اطلب|اطلبها|اطلبهن|بدي|ابي|أبغى|ابغى|عاوز|أريد|اريد|احجز|اشتري|ضيف|أضيف|سله|سلة)/i.test(
      messageText
    ) ||
    /\b(order|buy|get|want|add\s+to\s+cart|checkout)\b/i.test(messageText);

  if (!orderish) return false;

  if (mentioned.length >= 2) return true;
  if (messageSignalsBothProducts(messageText)) return true;
  if (messageSignalsCartCorrection(messageText) && /(و|and)/i.test(messageText)) {
    return true;
  }
  return false;
}

/**
 * Customer wants to add another product (not finalize).
 * Model signal preferred; heuristic fallback for common phrases.
 */
export function detectsAddAnotherIntent(
  messageText: string,
  modelWantsAddAnother?: boolean
): boolean {
  if (modelWantsAddAnother === true) return true;
  if (!messageText?.trim()) return false;

  // Multi-product order phrases are handled by cart sync — not "add another" alone.
  if (messageSignalsBothProducts(messageText)) return false;

  const t = messageText.trim().toLowerCase();
  const patterns: RegExp[] = [
    /(كمان|كمان\s+بدي|برضه|برضو|بعدين|اضيف|أضيف|ضيف|زود|زيد)\b/i,
    /(منتج\s*(ثاني|تاني|اخر|آخر|جديد)|سلعة\s*(ثانية|تانية))/i,
    /(ابي|أبغى|ابغى|بدي|عاوز|أريد|اريد)\s+.+\s+(وكمان|وكمان|وبرضه)/i,
    /\b(add\s+(another|more|one\s+more)|also\s+(want|need|add)|one\s+more\s+item)\b/i,
    /\b(something\s+else|another\s+product)\b/i,
  ];
  return patterns.some((re) => re.test(t));
}

export function buildAddedToCartMessage(
  language: Language,
  item: CartItem,
  cart: ConversationCart
): string {
  const summary = formatCartSummary(cart.items, language);
  if (language === 'arabic') {
    const label =
      cart.items.length > 1
        ? 'تم تحديث سلتك ✅'
        : `تمت إضافة ${item.productName} إلى سلتك ✅`;
    return (
      `${label}\n` +
      `${summary}\n\n` +
      `تبي تضيف منتج ثاني، ولا نكمّل الطلب؟`
    );
  }
  const label =
    cart.items.length > 1
      ? 'Your cart was updated ✅'
      : `Added ${item.productName} to your cart ✅`;
  return (
    `${label}\n` +
    `${summary}\n\n` +
    `Want to add another product, or shall we complete the order?`
  );
}

export function buildCartSyncedMessage(
  language: Language,
  cart: ConversationCart
): string {
  const summary = formatCartSummary(cart.items, language);
  if (language === 'arabic') {
    return (
      `تم ضبط سلتك ✅\n` +
      `${summary}\n\n` +
      `تبي تضيف شي تاني، ولا نكمّل الطلب؟`
    );
  }
  return (
    `Your cart is set ✅\n` +
    `${summary}\n\n` +
    `Want to add anything else, or shall we complete the order?`
  );
}
