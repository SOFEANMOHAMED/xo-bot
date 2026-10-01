/**
 * STEP 1 — resolve product focus + catalog awareness for the turn.
 */
import {
  getCatalogMeta,
  getProductById,
  getProductsOverview,
  getTopProducts,
  searchProducts,
} from '../../../catalog/product-search.js';
import type {
  ConversationState,
  Message,
  Product,
} from '../../../core/types.js';
import { logger } from '../../../utils/logger.js';
import type { CatalogAwareness } from '../agent.js';
import { isGenuineCatalogNoMatch } from '../catalogGrounding.js';
import { isProductNameNegatedInMessage } from '../cartLineRemoval.js';
import { findProductsMentionedInText, getCartItems } from '../conversationCart.js';
import {
  lastAssistantContent,
  readPendingFromState,
  resolveIncomingPendingBotQuestion,
  resolveIncomingPendingProductId,
} from '../pendingBotQuestion.js';
import { extractProductKeywords, hasSpecificProductSearchIntent } from '../productKeywords.js';
import { resolveFocus } from '../resolveFocus.js';
import { isExplicitPhotoRequest } from '../turnIntent.js';

export type ResolveTurnFocusInput = {
  merchantId: string;
  messageText: string;
  recentMessages: Message[];
  conversationState: ConversationState;
};

export type ResolveTurnFocusResult = {
  products: Product[];
  activeProductId: string | null;
  focusSource: ReturnType<typeof resolveFocus>['source'];
  catalogForMention: Product[];
  namedInMessage: Product[];
  mentionedInMessage: Product[];
  hadSpecificSearchIntent: boolean;
  searchMatchedQuery: boolean;
  noMatchForSpecificQuery: boolean;
  asksForPhoto: boolean;
  pendingKindEarly: ReturnType<typeof resolveIncomingPendingBotQuestion>;
  pendingProductIdEarly: string | null;
  catalogAwareness: CatalogAwareness;
};

export async function resolveTurnFocus(
  input: ResolveTurnFocusInput
): Promise<ResolveTurnFocusResult> {
  const { merchantId, messageText, recentMessages, conversationState } = input;

  let products: Product[] = [];
  let activeProductId: string | null = null;
  let searchMatchedQuery = false;

  const catalogForMention = await getTopProducts(merchantId, 40);
  const mentionedInMessage = findProductsMentionedInText(messageText, catalogForMention);
  const hadSpecificSearchIntent = hasSpecificProductSearchIntent({
    messageText,
    mentionedInMessageCount: mentionedInMessage.length,
    productQuery: conversationState.extracted_entities?.product_query,
  });

  let namedInMessage = mentionedInMessage;
  // «بدي القميص مو الساعة» — prefer the positively requested product over the negated one.
  const nonNegatedMentions = namedInMessage.filter(
    (p) => !isProductNameNegatedInMessage(messageText, p.name)
  );
  if (nonNegatedMentions.length > 0 && nonNegatedMentions.length < namedInMessage.length) {
    namedInMessage = nonNegatedMentions;
  }
  if (namedInMessage.length === 0 && hadSpecificSearchIntent) {
    const smartKeywords = extractProductKeywords(messageText);
    const meaningfulKeywords = smartKeywords.filter((k) => k.length >= 3);
    const sortedKeywords = [...meaningfulKeywords].sort((a, b) => b.length - a.length);
    for (const keyword of sortedKeywords) {
      const searchResults = await searchProducts(
        merchantId,
        keyword,
        { inStockOnly: false },
        5
      );
      if (searchResults.length > 0) {
        namedInMessage = searchResults;
        logger.debug('SalesGPT: Found products from keywords', {
          keyword,
          count: searchResults.length,
          topProduct: searchResults[0]?.name,
        });
        break;
      }
    }
  }

  const asksForPhoto = isExplicitPhotoRequest(messageText);
  if (asksForPhoto && namedInMessage.length === 0) {
    for (let i = recentMessages.length - 1; i >= 0 && i >= recentMessages.length - 8; i--) {
      const msg = recentMessages[i];
      if (msg.role !== 'user') continue;
      const fromHistory = findProductsMentionedInText(msg.content || '', catalogForMention);
      if (fromHistory.length > 0) {
        namedInMessage = fromHistory;
        logger.debug('SalesGPT: Photo focus from recent user mention', {
          productName: fromHistory[0].name,
        });
        break;
      }
    }
  }

  const lastBotText = lastAssistantContent(recentMessages);
  const lastBotProducts = findProductsMentionedInText(lastBotText, catalogForMention);
  const storedPendingEarly = readPendingFromState(conversationState);
  const pendingKindEarly = resolveIncomingPendingBotQuestion({
    stored: storedPendingEarly.pending_bot_question,
    lastBotReply: lastBotText,
  });
  const pendingProductIdEarly = resolveIncomingPendingProductId({
    pending: pendingKindEarly,
    mentionedProductId: namedInMessage[0]?.id ?? null,
    lastBotProductId: lastBotProducts[0]?.id ?? null,
    storedProductId: storedPendingEarly.pending_bot_question_product_id,
  });

  async function productById(id: string | null | undefined): Promise<Product | null> {
    if (!id) return null;
    const fromCatalog = catalogForMention.find((p) => p.id === id);
    if (fromCatalog) return fromCatalog;
    return getProductById(merchantId, id);
  }

  const pendingProduct = await productById(pendingProductIdEarly);
  const cartLinesEarly = getCartItems(conversationState);
  const cartFocusId =
    conversationState.last_recommended_products?.[0] ||
    cartLinesEarly[0]?.productId ||
    null;
  const cartFocusProduct = await productById(cartFocusId);
  const seededProduct = await productById(
    conversationState.extracted_entities?.product_id || null
  );

  const focused = resolveFocus({
    namedInMessage,
    pendingProduct,
    lastBotProduct: lastBotProducts[0] || null,
    cartFocusProduct,
    seededProduct,
  });
  let focusSource = focused.source;

  if (focused.product) {
    products = [focused.product];
    activeProductId = focused.product.id;
    if (focused.source !== 'seed' || namedInMessage.length > 0) {
      searchMatchedQuery = true;
    }
    if (focused.source === 'message') {
      logger.debug('SalesGPT: Products mentioned in message', {
        names: namedInMessage.map((p) => p.name),
      });
    } else if (focused.source === 'seed') {
      logger.debug('SalesGPT: Using acquisition-seeded / post-linked product', {
        productName: focused.product.name,
      });
    } else {
      logger.debug('SalesGPT: Focus from source', {
        source: focused.source,
        productName: focused.product.name,
      });
    }
  }

  const noMatchForSpecificQuery = isGenuineCatalogNoMatch(
    hadSpecificSearchIntent,
    searchMatchedQuery
  );

  if (noMatchForSpecificQuery) {
    products = [];
    activeProductId = null;
    focusSource = 'none';
  } else if (products.length === 0) {
    products =
      catalogForMention.length > 0
        ? catalogForMention.slice(0, 5)
        : await getTopProducts(merchantId, 5);
    if (products[0]) activeProductId = products[0].id;
  }

  const [catalogOverview, catalogMeta] = await Promise.all([
    getProductsOverview(merchantId, 30),
    getCatalogMeta(merchantId),
  ]);
  const catalogAwareness: CatalogAwareness = {
    overview: catalogOverview,
    meta: catalogMeta,
    activeProductId,
    hadSpecificSearchIntent,
    searchMatchedQuery,
    noMatchForSpecificQuery,
  };

  return {
    products,
    activeProductId,
    focusSource,
    catalogForMention,
    namedInMessage,
    mentionedInMessage,
    hadSpecificSearchIntent,
    searchMatchedQuery,
    noMatchForSpecificQuery,
    asksForPhoto,
    pendingKindEarly,
    pendingProductIdEarly,
    catalogAwareness,
  };
}
