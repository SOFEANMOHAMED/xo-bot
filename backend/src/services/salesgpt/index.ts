/**
 * SalesGPT Module Index
 * Main entry point that integrates SalesGPT with the existing XoBot pipeline
 *
 * Replaces the legacy Full-AI orchestrator with stage-based sales conversation management.
 */

import {
    SalesGPTAgent,
    type SalesGPTConfig,
    type SalesGPTResult,
    type CatalogAwareness
} from './agent.js';
import {
    searchProducts,
    getTopProducts,
    getProductById,
    getProductsOverview,
    getCatalogMeta
} from '../../catalog/product-search.js';
import { resolveProductImageForBot } from '../../catalog/resolve-product-image.js';
import { formatColorOptionsForDisplay } from '../../catalog/color-options.js';
import {
    isColorInProductCatalog,
    resolveOrderColor,
    buildUnavailableColorMessage,
    buildAskColorMessage,
    type ResolveOrderColorResult
} from './orderColorPolicy.js';
import {
    sanitizeCaptionWhenImageSent,
    stripFalseImageDeliveryClaims
} from '../../response/image-caption.js';
import type {
    Message,
    ConversationState,
    Product,
    Language,
    MerchantConfig,
    Intent,
    Stage,
    NextAction,
    CtaType,
    RecommendationStrategy
} from '../../core/types.js';
import { logger } from '../../utils/logger.js';
import {
    customerAffirmsOrder,
    customerDeclinesMoreItems,
    botReplyAsksForConfirmation,
    botReplyAsksToAddMore,
    buildOrderConfirmedMessage,
    buildOrderCancelledMessage,
    buildAwaitConfirmationMessage,
    isProductInfoRequest,
    sanitizeCollectedText,
    AWAIT_CONFIRMATION_ACTION,
    CONFIRM_ORDER_ACTION,
    shouldAppendOrderData
} from './orderConfirmationPolicy.js';
import { extractProductKeywords, hasSpecificProductSearchIntent } from './productKeywords.js';
import {
    violatesNoMatchGrounding,
    buildNoMatchFallbackMessage,
    isGenuineCatalogNoMatch,
    validateCatalogReplyGrounding,
} from './catalogGrounding.js';
import { isExplicitPhotoRequest } from './turnIntent.js';
import {
    applySalesGPTStage,
    FRESH_CONVERSATION_STAGE_ID,
} from './conversationStateSync.js';
import {
    ADD_TO_CART_ACTION,
    buildAddedToCartMessage,
    buildCartItemsFromProducts,
    buildCartSyncedMessage,
    cartHasItems,
    clearCart,
    clearDraftOnFocusChange,
    coerceSafeQuantity,
    detectsAddAnotherIntent,
    ensureCartForCheckout,
    ensureLineId,
    fillCartVariantsFromDraft,
    findProductsMentionedInText,
    formatCartSummary,
    getCartItems,
    isCheckoutReady,
    isDraftLineComplete,
    lockDraftIntoCart,
    messageSignalsBothProducts,
    normalizeCart,
    removeCartLineById,
    replaceCartItems,
    shouldSyncMultiProductCart,
    updateCartLineById,
} from './conversationCart.js';
import { resolveQuantityFromMessage } from './arabicQuantityWords.js';
import { classifyInterimCancelIntent } from './interimCancelMatchers.js';
import { matchCartLinesForRemoval } from './cartLineRemoval.js';
import {
    applyPendingToState,
    bindPendingBotQuestion,
    clearPendingBotQuestion,
    detectPendingBotQuestion,
    isExplicitPhotoRefusal,
    lastAssistantContent,
    readPendingFromState,
    resolveIncomingPendingBotQuestion,
    resolveIncomingPendingProductId,
    resolvePendingVariantAnswer,
} from './pendingBotQuestion.js';
import {
    buildAskWhichLineMessage,
    buildVariantUnchangedMessage,
    buildVariantUpdatedMessage,
    resolveVariantChange,
} from './resolveVariantChange.js';
import {
    buildGroundedCatalogFallback,
    buildOutOfStockMessage,
    isSellableProduct,
    resolveFocus,
} from './resolveFocus.js';
import { mayReplaceWithOrderTemplate } from './deterministicReplyGate.js';

// Re-export confirmation helpers so channel controllers keep a stable import path
export {
    customerAffirmsOrder,
    customerDeclinesMoreItems,
    customerCancelsOrder,
    isAffirmativeReply,
    botReplyAsksForConfirmation,
    botReplyAsksToAddMore,
    isProductInfoRequest,
    shouldAppendOrderData,
    AWAIT_CONFIRMATION_ACTION,
    CONFIRM_ORDER_ACTION
} from './orderConfirmationPolicy.js';

// ==================== TYPES ====================

export interface SalesGPTPipelineInput {
    merchantId: string;
    messageText: string;
    recentMessages: Message[];
    conversationState: ConversationState;
    merchantConfig: MerchantConfig;
    platform?: string;
}

export interface SalesGPTPipelineResult {
    replyText: string;
    intent: Intent;
    stage: Stage;
    entities: Record<string, any>;
    missingFields: string[];
    products: Product[];
    plan: {
        nextAction: NextAction;
        oneQuestion: string;
        ctaType: CtaType;
        recommendationStrategy: RecommendationStrategy;
        shouldOfferDiscount: boolean;
        handoffReason: string;
    };
    updatedState: ConversationState;
    aiCallsCount: number;
    language: Language;
    next_action?: string;
}

// ==================== LANGUAGE DETECTION ====================

const detectLanguage = (text: string): Language => {
    const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
    const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
    return arabicChars >= englishChars ? 'arabic' : 'english';
};

// ==================== ORDER COMPLETENESS ====================

/** True when the most recent assistant message explicitly asked for order confirmation. */
export function lastBotMessageAsksForConfirmation(recentMessages: Message[]): boolean {
    for (let i = recentMessages.length - 1; i >= 0; i--) {
        const msg = recentMessages[i];
        if (msg.role !== 'assistant') continue;
        return botReplyAsksForConfirmation(msg.content || '');
    }
    return false;
}

/** True when the most recent assistant message asked to add another product. */
export function lastBotMessageAsksToAddMore(recentMessages: Message[]): boolean {
    for (let i = recentMessages.length - 1; i >= 0; i--) {
        const msg = recentMessages[i];
        if (msg.role !== 'assistant') continue;
        return botReplyAsksToAddMore(msg.content || '');
    }
    return false;
}

interface CompletenessCheck {
    complete: boolean;
    missing: string[];
}

/** Validates checkout readiness: identity + cart (or lockable draft line). */
export function checkOrderCompleteness(
    state: ConversationState,
    product?: Product
): CompletenessCheck {
    return isCheckoutReady(state, product);
}

// ==================== IMAGE URL CONVERSION ====================

function convertImageUrlForBot(imageUrl: string | null, productId: string): string {
    if (!imageUrl || imageUrl === 'N/A') return '';
    const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || 'https://xo-bot.com';
    let cacheBuster = '';
    if (imageUrl && imageUrl.includes('product-image-')) {
        const match = imageUrl.match(/product-image-(\d+)-/);
        if (match && match[1]) cacheBuster = `?v=${match[1]}`;
    }
    return `${baseUrl}/api/products/${productId}/image${cacheBuster}`;
}

async function buildColorAwareImageTag(
    merchantId: string,
    product: Product,
    requestedColor: string | null | undefined,
    messageText: string
): Promise<string> {
    const resolved = await resolveProductImageForBot({
        merchantId,
        product,
        requestedColor,
        messageText
    });
    if (resolved.botImageUrl) return resolved.botImageUrl;
    return convertImageUrlForBot(product.imageUrl || null, product.id);
}

// Re-export for callers that imported from salesgpt
export { sanitizeCaptionWhenImageSent } from '../../response/image-caption.js';

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
function resolveProductOrderColor(params: {
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
    // Colorless SKUs never inherit a draft/AI color from another product.
    if (!catalogColors?.length) {
        return { color: null, replyText: params.replyText, policy: null };
    }

    const userMessages = collectUserMessageTexts(params.recentMessages, params.messageText);
    const policy = resolveOrderColor({
        catalogColors,
        currentMessage: params.messageText,
        userMessages,
        storedColor: params.conversationState.extracted_entities?.color,
        aiColor: params.aiColor ?? null
    });

    let replyText = params.replyText;

    if (policy.needsClarification && policy.ambiguous.length > 1) {
        const options = formatColorOptionsForDisplay(
            policy.ambiguous,
            params.language === 'english' ? 'english' : 'arabic'
        );
        replyText = params.language === 'arabic'
            ? `تقصد أي خيار لون؟ 🎨\n${options}`
            : `Which color option did you mean? 🎨\n${options}`;
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

/** Block order finalization when the product requires a catalog color that is missing/invalid. */
function gateConfirmWhenColorInvalid(params: {
    nextAction: string;
    product: Product | undefined;
    resolvedColor: string | null;
    language: Language;
    replyText: string;
    rejectedColor?: string | null;
}): { nextAction: string; replyText: string; awaitingConfirmation: boolean } {
    const catalogColors = params.product?.colors;
    const needsColor = Array.isArray(catalogColors) && catalogColors.length > 0;
    const colorOk = !needsColor || isColorInProductCatalog(params.resolvedColor, catalogColors);

    if (params.nextAction !== CONFIRM_ORDER_ACTION || colorOk) {
        return {
            nextAction: params.nextAction,
            replyText: params.replyText,
            awaitingConfirmation: params.nextAction === AWAIT_CONFIRMATION_ACTION
        };
    }

    const lang = params.language === 'english' ? 'english' : 'arabic';
    const replyText = params.resolvedColor
        ? buildUnavailableColorMessage(lang, catalogColors!, params.resolvedColor)
        : buildAskColorMessage(lang, catalogColors!);

    return {
        nextAction: AWAIT_CONFIRMATION_ACTION,
        replyText,
        awaitingConfirmation: true
    };
}

// ==================== MAIN SALESGPT PIPELINE ====================

/**
 * Process message using SalesGPT brain
 * Primary full-AI sales path used by the smart pipeline
 */
export const processWithSalesGPT = async (
    input: SalesGPTPipelineInput
): Promise<SalesGPTPipelineResult> => {
    const {
        merchantId,
        messageText,
        recentMessages,
        merchantConfig
    } = input;
    let conversationState = input.conversationState;

    const startTime = Date.now();

    // Detect language
    const language: Language = conversationState.language || detectLanguage(messageText);

    logger.info('🧠 SalesGPT pipeline started', {
        merchantId,
        messageLength: messageText.length,
        language
    });

    // ==================== STEP 1: Product focus (resolveFocus) ====================
    let products: Product[] = [];
    let activeProductId: string | null = null;
    /** True when a real catalog hit came from the current message / pending / last bot / cart. */
    let searchMatchedQuery = false;

    const catalogForMention = await getTopProducts(merchantId, 40);
    const mentionedInMessage = findProductsMentionedInText(messageText, catalogForMention);
    const hadSpecificSearchIntent = hasSpecificProductSearchIntent({
        messageText,
        mentionedInMessageCount: mentionedInMessage.length,
        productQuery: conversationState.extracted_entities?.product_query,
    });

    // Keyword search only expands "named in message" candidates — never overrides resolveFocus order.
    let namedInMessage = mentionedInMessage;
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
                console.log('✅ SalesGPT: Found products from keywords:', {
                    keyword,
                    count: searchResults.length,
                    topProduct: searchResults[0]?.name,
                });
                break;
            }
        }
    }

    // Photo with no product name → recent user mention counts as named-in-message.
    const asksForPhoto = isExplicitPhotoRequest(messageText);
    if (asksForPhoto && namedInMessage.length === 0) {
        for (let i = recentMessages.length - 1; i >= 0 && i >= recentMessages.length - 8; i--) {
            const msg = recentMessages[i];
            if (msg.role !== 'user') continue;
            const fromHistory = findProductsMentionedInText(msg.content || '', catalogForMention);
            if (fromHistory.length > 0) {
                namedInMessage = fromHistory;
                console.log('📸 SalesGPT: Photo focus from recent user mention:', fromHistory[0].name);
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
    // Ad-seed is the draft product_id — resolveFocus uses it only as last resort.
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

    if (focused.product) {
        products = [focused.product];
        activeProductId = focused.product.id;
        // Seed alone is context, not proof the current message matched catalog.
        if (focused.source !== 'seed' || namedInMessage.length > 0) {
            searchMatchedQuery = true;
        }
        if (focused.source === 'message') {
            console.log('🎯 SalesGPT: Products mentioned in message:', {
                names: namedInMessage.map((p) => p.name),
            });
        } else if (focused.source === 'seed') {
            console.log('🎯 SalesGPT: Using acquisition-seeded product:', focused.product.name);
        } else {
            console.log('📦 SalesGPT: Focus from', focused.source, focused.product.name);
        }
    }

    const noMatchForSpecificQuery = isGenuineCatalogNoMatch(
        hadSpecificSearchIntent,
        searchMatchedQuery
    );

    if (noMatchForSpecificQuery) {
        products = [];
        activeProductId = null;
    } else if (products.length === 0) {
        // Cold-start browse only — never a sticky seed substitute.
        products =
            catalogForMention.length > 0
                ? catalogForMention.slice(0, 5)
                : await getTopProducts(merchantId, 5);
        if (products[0]) activeProductId = products[0].id;
    }

    // Always attach compact catalog awareness for SaaS stores.
    const [catalogOverview, catalogMeta] = await Promise.all([
        getProductsOverview(merchantId, 30),
        getCatalogMeta(merchantId)
    ]);
    const catalogAwareness: CatalogAwareness = {
        overview: catalogOverview,
        meta: catalogMeta,
        activeProductId,
        isExploring: true,
        hadSpecificSearchIntent,
        searchMatchedQuery,
        noMatchForSpecificQuery,
    };

    // ==================== STEP 2: Create & Run SalesGPT Agent ====================

    const agentConfig: SalesGPTConfig = {
        merchantId,
        merchantConfig,
        language,
        useTools: true,
        verbose: process.env.NODE_ENV !== 'production'
    };

    const agent = new SalesGPTAgent(agentConfig);

    // ==================== RETURNING CUSTOMER FAST-PATH ====================
    const lastOrder = conversationState.last_order;
    /**
     * Only the *first* user turn after we persist post-order reset has message_count === 0.
     * If we only checked discover/stage1, missing fields in JSONB could wrongly match mid-checkout
     * (last_order still present from an older completed order) → agent injects "new chat" and skips confirmation.
     */
    const isReturningAfterOrder = !!(
        lastOrder?.orderId &&
        lastOrder?.confirmedAt &&
        (conversationState.message_count ?? 0) === 0 &&
        // Persisted SalesGPT stage is the source of truth for returning-customer detection.
        (!conversationState.salesgpt_stage_id ||
            conversationState.salesgpt_stage_id === FRESH_CONVERSATION_STAGE_ID)
    );

    if (isReturningAfterOrder && lastOrder) {
        const orderContext = language === 'arabic'
            ? `[سياق: هذا العميل ${lastOrder.customerName ? `(${lastOrder.customerName}) ` : ''}لديه طلب سابق مؤكد رقم ${lastOrder.orderId} بتاريخ ${new Date(lastOrder.confirmedAt).toLocaleDateString('ar')} للمنتج: ${lastOrder.productName}. هذه محادثة جديدة — ابدأ بترحيب حار واسأل كيف يمكنك مساعدته مجدداً. لا تحاول تأكيد طلب جديد تلقائياً.]`
            : `[Context: This customer${lastOrder.customerName ? ` (${lastOrder.customerName})` : ''} has a previous confirmed order #${lastOrder.orderId} dated ${new Date(lastOrder.confirmedAt).toLocaleDateString('en')} for: ${lastOrder.productName}. This is a NEW conversation — start with a warm greeting and ask how you can help again. Do not auto-confirm a new order.]`;

        agent.restoreState([], { ...conversationState, extracted_entities: {} });
        agent.injectContextNote(orderContext);

        console.log('🔄 SalesGPT: Returning customer after confirmed order', {
            orderId: lastOrder.orderId,
            productName: lastOrder.productName
        });
    } else {
        agent.restoreState(recentMessages, conversationState);
    }

    agent.humanStep(messageText);

    let salesResult: SalesGPTResult;

    // ==================== DETERMINISTIC CONFIRMATION FAST-PATH ====================
    // Completeness is read from state *before* this turn — providing the last field
    // never finalizes here. Only an explicit yes/no while already ready does.
    const stageId = conversationState.salesgpt_stage_id?.trim();
    const wasInClosingFlow =
        !!conversationState.awaiting_order_confirmation ||
        (!!stageId && ['6', '7', '8'].includes(stageId)) ||
        lastBotMessageAsksForConfirmation(recentMessages);
    const botAskedConfirm = lastBotMessageAsksForConfirmation(recentMessages);
    const botAskedAddMore = lastBotMessageAsksToAddMore(recentMessages);
    const userAffirms = customerAffirmsOrder(messageText);
    const userDeclinesMore = customerDeclinesMoreItems(messageText);
    const completeness = checkOrderCompleteness(conversationState, products[0]);

    // Affirmative confirm OR decline of upsell/"anything else?" while order is complete → finalize.
    // Never finalize when the customer is asking for product details (e.g. "تمام، معلومات أكثر؟").
    const askingProductInfo = isProductInfoRequest(messageText);
    const addAnotherIntent = detectsAddAnotherIntent(messageText) && !askingProductInfo;

    const catalogColorsForConfirm = products[0]?.colors;
    const colorForFastPath = catalogColorsForConfirm?.length
        ? resolveProductOrderColor({
            product: products[0],
            messageText,
            recentMessages,
            conversationState,
            aiColor: null,
            language,
            replyText: ''
        }).color
        : conversationState.extracted_entities?.color ?? null;

    const fastPathColorReady =
        !catalogColorsForConfirm?.length ||
        isColorInProductCatalog(colorForFastPath, catalogColorsForConfirm);

    // ——— Variant correction BEFORE pending (positive color wins over negation) ———
    {
        const liveItems = getCartItems(conversationState).map(ensureLineId);
        const focusId =
            conversationState.extracted_entities?.product_id ||
            conversationState.last_recommended_products?.[0] ||
            products[0]?.id ||
            null;
        const productPool: Product[] = [];
        const seen = new Set<string>();
        for (const p of [
            ...mentionedInMessage,
            ...products,
            ...catalogForMention.filter((p) =>
                liveItems.some((line) => line.productId === p.id)
            ),
        ]) {
            if (!p?.id || seen.has(p.id)) continue;
            seen.add(p.id);
            productPool.push(p);
        }
        const variant = resolveVariantChange({
            messageText,
            cartLines: liveItems,
            products: productPool,
            focusProductId: focusId,
            mentionedProductIds: mentionedInMessage.map((p) => p.id),
        });

        if (variant.kind === 'apply') {
            const nextItems = updateCartLineById(liveItems, variant.lineId, {
                color: variant.color,
            }).map(ensureLineId);
            const cart = normalizeCart(
                { items: nextItems, status: 'building' },
                { storeCurrency: merchantConfig.storeCurrency || merchantConfig.currency }
            );
            const reply = buildVariantUpdatedMessage(
                language === 'english' ? 'english' : 'arabic',
                variant.color,
                variant.productName
            );
            const updatedVariant: ConversationState = applyPendingToState(
                {
                    ...conversationState,
                    cart,
                    extracted_entities: {
                        ...(conversationState.extracted_entities || {}),
                        product_id: variant.productId,
                        color: variant.color,
                    },
                    language,
                    awaiting_order_confirmation: false,
                    last_interaction: new Date().toISOString(),
                    message_count: (conversationState.message_count || 0) + 1,
                },
                clearPendingBotQuestion()
            );
            applySalesGPTStage(updatedVariant, '7');
            return {
                replyText: reply,
                intent: 'order' as Intent,
                stage: 'close' as Stage,
                entities: updatedVariant.extracted_entities || {},
                missingFields: [],
                products: productPool.filter((p) => p.id === variant.productId),
                plan: {
                    nextAction: 'recommend_products' as NextAction,
                    oneQuestion: reply,
                    ctaType: 'choose' as CtaType,
                    recommendationStrategy: null as RecommendationStrategy,
                    shouldOfferDiscount: false,
                    handoffReason: '',
                },
                updatedState: updatedVariant,
                aiCallsCount: 0,
                language,
                next_action: 'collect_info',
            };
        }

        if (variant.kind === 'unchanged') {
            const reply = buildVariantUnchangedMessage(
                language === 'english' ? 'english' : 'arabic',
                variant.color,
                variant.productName
            );
            const updatedSame: ConversationState = applyPendingToState(
                {
                    ...conversationState,
                    language,
                    last_interaction: new Date().toISOString(),
                    message_count: (conversationState.message_count || 0) + 1,
                },
                clearPendingBotQuestion()
            );
            return {
                replyText: reply,
                intent: 'order' as Intent,
                stage: 'close' as Stage,
                entities: updatedSame.extracted_entities || {},
                missingFields: [],
                products: productPool.filter((p) => p.id === variant.productId),
                plan: {
                    nextAction: 'recommend_products' as NextAction,
                    oneQuestion: reply,
                    ctaType: 'choose' as CtaType,
                    recommendationStrategy: null as RecommendationStrategy,
                    shouldOfferDiscount: false,
                    handoffReason: '',
                },
                updatedState: updatedSame,
                aiCallsCount: 0,
                language,
                next_action: 'collect_info',
            };
        }

        if (variant.kind === 'unavailable') {
            const reply = buildUnavailableColorMessage(
                language === 'english' ? 'english' : 'arabic',
                variant.catalogColors,
                variant.rejected
            );
            const updatedBad: ConversationState = applyPendingToState(
                {
                    ...conversationState,
                    language,
                    last_interaction: new Date().toISOString(),
                    message_count: (conversationState.message_count || 0) + 1,
                },
                clearPendingBotQuestion()
            );
            return {
                replyText: reply,
                intent: 'product_query' as Intent,
                stage: 'offer' as Stage,
                entities: updatedBad.extracted_entities || {},
                missingFields: [],
                products: productPool.filter((p) => p.id === variant.productId),
                plan: {
                    nextAction: 'recommend_products' as NextAction,
                    oneQuestion: reply,
                    ctaType: 'choose' as CtaType,
                    recommendationStrategy: null as RecommendationStrategy,
                    shouldOfferDiscount: false,
                    handoffReason: '',
                },
                updatedState: updatedBad,
                aiCallsCount: 0,
                language,
                next_action: 'collect_info',
            };
        }

        if (variant.kind === 'ask_which') {
            const reply = buildAskWhichLineMessage(
                language === 'english' ? 'english' : 'arabic',
                variant.productName
            );
            const updatedAsk: ConversationState = {
                ...conversationState,
                language,
                last_interaction: new Date().toISOString(),
                message_count: (conversationState.message_count || 0) + 1,
            };
            return {
                replyText: reply,
                intent: 'order' as Intent,
                stage: 'close' as Stage,
                entities: updatedAsk.extracted_entities || {},
                missingFields: [],
                products: productPool.filter((p) => p.id === variant.productId),
                plan: {
                    nextAction: 'recommend_products' as NextAction,
                    oneQuestion: reply,
                    ctaType: 'choose' as CtaType,
                    recommendationStrategy: null as RecommendationStrategy,
                    shouldOfferDiscount: false,
                    handoffReason: '',
                },
                updatedState: updatedAsk,
                aiCallsCount: 0,
                language,
                next_action: 'collect_info',
            };
        }
    }

    // ——— Pending color/size answer (before cancel / agent / image) ———
    {
        const storedPending = readPendingFromState(conversationState);
        const lastBot = lastAssistantContent(recentMessages);
        const pendingKind = resolveIncomingPendingBotQuestion({
            stored: storedPending.pending_bot_question,
            lastBotReply: lastBot,
        });
        const pendingProductId = resolveIncomingPendingProductId({
            pending: pendingKind,
            mentionedProductId: mentionedInMessage[0]?.id ?? null,
            lastBotProductId: products[0]?.id ?? null,
            storedProductId: storedPending.pending_bot_question_product_id,
        });
        const pendingProduct =
            (pendingProductId
                ? catalogForMention.find((p) => p.id === pendingProductId) ||
                  products.find((p) => p.id === pendingProductId)
                : null) || null;

        if (pendingKind && pendingProduct && isSellableProduct(pendingProduct)) {
            const resolved = resolvePendingVariantAnswer({
                pending: pendingKind,
                userMessage: messageText,
                product: pendingProduct,
            });

            if (resolved.kind === 'select') {
                let stateForSelect: ConversationState = {
                    ...conversationState,
                    extracted_entities: {
                        ...(conversationState.extracted_entities || {}),
                        product_id: pendingProduct.id,
                        product_query: pendingProduct.name,
                        color: resolved.color || conversationState.extracted_entities?.color,
                        size: resolved.size || conversationState.extracted_entities?.size,
                    },
                };
                // Ensure a cart line exists, then write the chosen variant onto THAT product only.
                stateForSelect = fillCartVariantsFromDraft(stateForSelect, pendingProduct);
                if (getCartItems(stateForSelect).length === 0) {
                    const locked = lockDraftIntoCart(
                        {
                            ...stateForSelect,
                            extracted_entities: {
                                ...(stateForSelect.extracted_entities || {}),
                                product_id: pendingProduct.id,
                                product_query: pendingProduct.name,
                                color: resolved.color,
                                size: resolved.size,
                            },
                        },
                        pendingProduct,
                        merchantConfig.storeCurrency || merchantConfig.currency
                    );
                    if (locked.locked) stateForSelect = locked.state;
                }
                let items = getCartItems(stateForSelect).map(ensureLineId);
                const targetIdx = items.findIndex((row) => row.productId === pendingProduct.id);
                if (targetIdx >= 0) {
                    const lineId = items[targetIdx].lineId!;
                    items = updateCartLineById(items, lineId, {
                        color: resolved.color ?? items[targetIdx].color,
                        size: resolved.size ?? items[targetIdx].size,
                    }).map(ensureLineId);
                }
                const cart = normalizeCart(
                    { items, status: 'building' },
                    { storeCurrency: merchantConfig.storeCurrency || merchantConfig.currency }
                );
                const reply =
                    language === 'arabic'
                        ? `تمام، ثبتّ${resolved.color ? ` اللون ${resolved.color}` : ''}${resolved.size ? ` المقاس ${resolved.size}` : ''} لـ ${pendingProduct.name}.`
                        : `Got it — recorded${resolved.color ? ` ${resolved.color}` : ''}${resolved.size ? ` size ${resolved.size}` : ''} for ${pendingProduct.name}.`;
                const updatedSelect: ConversationState = applyPendingToState(
                    {
                        ...stateForSelect,
                        cart,
                        language,
                        last_recommended_products: [
                            pendingProduct.id,
                            ...cart.items
                                .map((i) => i.productId)
                                .filter((id) => id !== pendingProduct.id),
                        ],
                        awaiting_order_confirmation: false,
                        last_interaction: new Date().toISOString(),
                        message_count: (conversationState.message_count || 0) + 1,
                    },
                    clearPendingBotQuestion()
                );
                applySalesGPTStage(updatedSelect, '7');
                return {
                    replyText: reply,
                    intent: 'order' as Intent,
                    stage: 'close' as Stage,
                    entities: updatedSelect.extracted_entities || {},
                    missingFields: [],
                    products: [pendingProduct],
                    plan: {
                        nextAction: 'recommend_products' as NextAction,
                        oneQuestion: reply,
                        ctaType: 'choose' as CtaType,
                        recommendationStrategy: null as RecommendationStrategy,
                        shouldOfferDiscount: false,
                        handoffReason: '',
                    },
                    updatedState: updatedSelect,
                    aiCallsCount: 0,
                    language,
                    next_action: 'present_product',
                };
            }

            if (resolved.kind === 'unavailable') {
                const reply = buildUnavailableColorMessage(
                    language === 'english' ? 'english' : 'arabic',
                    pendingProduct.colors || [],
                    resolved.rejected
                );
                const updatedUnavail: ConversationState = applyPendingToState(
                    {
                        ...conversationState,
                        language,
                        last_interaction: new Date().toISOString(),
                        message_count: (conversationState.message_count || 0) + 1,
                    },
                    clearPendingBotQuestion()
                );
                return {
                    replyText: reply,
                    intent: 'product_query' as Intent,
                    stage: 'offer' as Stage,
                    entities: updatedUnavail.extracted_entities || {},
                    missingFields: [],
                    products: [pendingProduct],
                    plan: {
                        nextAction: 'recommend_products' as NextAction,
                        oneQuestion: reply,
                        ctaType: 'choose' as CtaType,
                        recommendationStrategy: null as RecommendationStrategy,
                        shouldOfferDiscount: false,
                        handoffReason: '',
                    },
                    updatedState: updatedUnavail,
                    aiCallsCount: 0,
                    language,
                    next_action: 'collect_info',
                };
            }

            // Fall through: clear stale pending so later rails see a clean slate.
            conversationState = applyPendingToState(
                conversationState,
                clearPendingBotQuestion()
            );
        }
    }

    // ——— INTERIM cancel / remove-line rails (cartLineOps) ———
    {
        const cancelKind = classifyInterimCancelIntent(messageText);
        const liveItems = getCartItems(conversationState).map(ensureLineId);

        if (cancelKind === 'whole_cancel') {
            const cleared = clearCart(conversationState);
            const reply = buildOrderCancelledMessage(language);
            const updatedCancel: ConversationState = {
                ...cleared,
                last_intent: 'other',
                language,
                awaiting_order_confirmation: false,
                last_interaction: new Date().toISOString(),
                message_count: (conversationState.message_count || 0) + 1,
            };
            applySalesGPTStage(updatedCancel, '9');
            return {
                replyText: reply,
                intent: 'other' as Intent,
                stage: 'close' as Stage,
                entities: updatedCancel.extracted_entities || {},
                missingFields: [],
                products: [],
                plan: {
                    nextAction: 'handoff' as NextAction,
                    oneQuestion: reply,
                    ctaType: 'support' as CtaType,
                    recommendationStrategy: null as RecommendationStrategy,
                    shouldOfferDiscount: false,
                    handoffReason: '',
                },
                updatedState: updatedCancel,
                aiCallsCount: 0,
                language,
                next_action: 'end_conversation',
            };
        }

        if (cancelKind === 'partial_remove') {
            const matches = matchCartLinesForRemoval(messageText, liveItems);
            if (matches.length === 0) {
                const reply =
                    language === 'arabic'
                        ? 'هذا المنتج مو موجود بطلبك الحالي.'
                        : 'That item is not in your current order.';
                const updatedMiss: ConversationState = {
                    ...conversationState,
                    language,
                    last_interaction: new Date().toISOString(),
                    message_count: (conversationState.message_count || 0) + 1,
                };
                return {
                    replyText: reply,
                    intent: 'order' as Intent,
                    stage: 'close' as Stage,
                    entities: updatedMiss.extracted_entities || {},
                    missingFields: [],
                    products: [],
                    plan: {
                        nextAction: 'recommend_products' as NextAction,
                        oneQuestion: reply,
                        ctaType: 'choose' as CtaType,
                        recommendationStrategy: null as RecommendationStrategy,
                        shouldOfferDiscount: false,
                        handoffReason: '',
                    },
                    updatedState: updatedMiss,
                    aiCallsCount: 0,
                    language,
                    next_action: 'present_product',
                };
            }

            let nextItems = liveItems;
            for (const line of matches) {
                const id = ensureLineId(line).lineId;
                nextItems = removeCartLineById(nextItems, id).map(ensureLineId);
            }

            if (nextItems.length === 0) {
                const reply =
                    language === 'arabic'
                        ? 'تمام، شلت آخر منتج من طلبك. الطلب فاضي هلق — خبرني إذا بدك تختار شي تاني.'
                        : 'Okay, I removed the last item. Your order is empty now — tell me if you want to pick something else.';
                const emptied = clearCart(conversationState);
                const updatedEmpty: ConversationState = {
                    ...emptied,
                    language,
                    awaiting_order_confirmation: false,
                    last_interaction: new Date().toISOString(),
                    message_count: (conversationState.message_count || 0) + 1,
                };
                applySalesGPTStage(updatedEmpty, '4');
                return {
                    replyText: reply,
                    intent: 'browse' as Intent,
                    stage: 'offer' as Stage,
                    entities: updatedEmpty.extracted_entities || {},
                    missingFields: [],
                    products: [],
                    plan: {
                        nextAction: 'recommend_products' as NextAction,
                        oneQuestion: reply,
                        ctaType: 'choose' as CtaType,
                        recommendationStrategy: null as RecommendationStrategy,
                        shouldOfferDiscount: false,
                        handoffReason: '',
                    },
                    updatedState: updatedEmpty,
                    aiCallsCount: 0,
                    language,
                    next_action: 'present_product',
                };
            }

            const cart = normalizeCart(
                { items: nextItems, status: 'building' },
                { storeCurrency: merchantConfig.storeCurrency || merchantConfig.currency }
            );
            const summary = formatCartSummary(cart.items, language, {
                shippingPolicy: merchantConfig.shippingPolicy,
            });
            const removedNames = matches.map((m) => m.productName).join('، ');
            const reply =
                language === 'arabic'
                    ? `تمام، شلت ${removedNames} من طلبك.\n${summary}\n\nنقدر نضيف منتج ثاني، أو نكمّل الطلب؟`
                    : `Okay, I removed ${removedNames} from your order.\n${summary}\n\nWe can add another product, or finish the order.`;
            const updatedPartial: ConversationState = {
                ...conversationState,
                cart,
                last_recommended_products: cart.items.map((i) => i.productId),
                language,
                awaiting_order_confirmation: false,
                last_interaction: new Date().toISOString(),
                message_count: (conversationState.message_count || 0) + 1,
            };
            applySalesGPTStage(updatedPartial, '4');
            return {
                replyText: reply,
                intent: 'order' as Intent,
                stage: 'offer' as Stage,
                entities: updatedPartial.extracted_entities || {},
                missingFields: [],
                products: [],
                plan: {
                    nextAction: 'recommend_products' as NextAction,
                    oneQuestion: reply,
                    ctaType: 'choose' as CtaType,
                    recommendationStrategy: null as RecommendationStrategy,
                    shouldOfferDiscount: false,
                    handoffReason: '',
                },
                updatedState: updatedPartial,
                aiCallsCount: 0,
                language,
                next_action: ADD_TO_CART_ACTION,
            };
        }
    }

    // Multi-product order / cart correction: MERGE named products into cart (code-owned).
    // Existing lines stay; mentioned products add lines; quantities are not reset.
    if (
        !askingProductInfo &&
        !asksForPhoto &&
        shouldSyncMultiProductCart(messageText, mentionedInMessage)
    ) {
        let productsForCart = mentionedInMessage;
        // "التنين" with only one name matched → try to keep existing cart lines + new mention
        if (productsForCart.length < 2 && messageSignalsBothProducts(messageText)) {
            const fromCart = getCartItems(conversationState);
            for (const line of fromCart) {
                const p = catalogForMention.find((c) => c.id === line.productId);
                if (p && !productsForCart.some((x) => x.id === p.id)) {
                    productsForCart = [...productsForCart, p];
                }
            }
        }

        if (productsForCart.length >= 1) {
            const storeCurrency = merchantConfig.storeCurrency || merchantConfig.currency;
            const cartItems = buildCartItemsFromProducts(productsForCart, messageText, storeCurrency);
            // Prefer qty 1 when "both" phrasing made AI/heuristic think quantity=2
            const safeItems = cartItems.map((item) => ({
                ...item,
                quantity: coerceSafeQuantity(messageText, item.quantity) ?? item.quantity,
            }));
            const syncedState = replaceCartItems(conversationState, safeItems);
            const cart = normalizeCart(syncedState.cart, { storeCurrency });
            const reply = buildCartSyncedMessage(language, cart);
            const updatedMulti: ConversationState = {
                ...syncedState,
                cart,
                last_intent: 'order',
                language,
                awaiting_order_confirmation: false,
                last_order: isReturningAfterOrder ? undefined : conversationState.last_order,
                last_interaction: new Date().toISOString(),
                message_count: (conversationState.message_count || 0) + 1,
                last_recommended_products: cart.items.map((i) => i.productId),
                extracted_entities: {
                    ...(syncedState.extracted_entities || {}),
                    name: conversationState.extracted_entities?.name,
                    phone: conversationState.extracted_entities?.phone,
                    address: conversationState.extracted_entities?.address,
                },
            };
            applySalesGPTStage(updatedMulti, '4');

            logger.info('🛒 SalesGPT: multi-product cart sync', {
                merchantId,
                products: cart.items.map((i) => `${i.productName}×${i.quantity}`),
            });

            return {
                replyText: reply,
                intent: 'order' as Intent,
                stage: 'offer' as Stage,
                entities: updatedMulti.extracted_entities || {},
                missingFields: [],
                products: productsForCart,
                plan: {
                    nextAction: 'recommend_products' as NextAction,
                    oneQuestion: reply,
                    ctaType: 'choose' as CtaType,
                    recommendationStrategy: 'match_query' as RecommendationStrategy,
                    shouldOfferDiscount: false,
                    handoffReason: '',
                },
                updatedState: updatedMulti,
                aiCallsCount: 0,
                language,
                next_action: ADD_TO_CART_ACTION,
            };
        }
    }

    // Add-another fast-path: lock draft into cart, clear product draft, ask what's next.
    if (
        addAnotherIntent &&
        (isDraftLineComplete(
            {
                ...(conversationState.extracted_entities || {}),
                color: colorForFastPath || conversationState.extracted_entities?.color,
            },
            products[0]
        ).complete ||
            cartHasItems(conversationState))
    ) {
        const storeCurrency = merchantConfig.storeCurrency || merchantConfig.currency;
        // Focus product wins; never carry previous SKU color onto a new line.
        const focused = clearDraftOnFocusChange(
            conversationState.extracted_entities,
            products[0]
        );
        const draftEntities = {
            ...focused,
            color: products[0]?.colors?.length
                ? colorForFastPath || focused.color
                : undefined,
            product_id: products[0]?.id || focused.product_id,
            product_query: products[0]?.name || focused.product_query,
        };
        const draftReady = isDraftLineComplete(draftEntities, products[0]).complete;
        let stateForAdd: ConversationState = {
            ...conversationState,
            extracted_entities: draftEntities,
        };
        let lockedItem = null as ReturnType<typeof lockDraftIntoCart>['item'];

        if (draftReady) {
            const locked = lockDraftIntoCart(
                stateForAdd,
                products[0],
                storeCurrency
            );
            if (locked.locked) {
                stateForAdd = locked.state;
                lockedItem = locked.item;
            }
        }

        if (lockedItem || cartHasItems(stateForAdd)) {
            const cart = normalizeCart(stateForAdd.cart, { storeCurrency });
            const displayItem =
                lockedItem ||
                cart.items[cart.items.length - 1]!;
            const thankAdd = buildAddedToCartMessage(language, displayItem, cart);
            const updatedStateAdd: ConversationState = {
                ...stateForAdd,
                cart,
                last_intent: 'browse',
                language,
                awaiting_order_confirmation: false,
                last_order: isReturningAfterOrder ? undefined : conversationState.last_order,
                last_interaction: new Date().toISOString(),
                message_count: (conversationState.message_count || 0) + 1,
            };
            applySalesGPTStage(updatedStateAdd, '4');

            logger.info('🛒 SalesGPT: add_to_cart fast-path', {
                merchantId,
                product: displayItem.productName,
                cartSize: getCartItems(updatedStateAdd).length,
            });

            return {
                replyText: thankAdd,
                intent: 'browse' as Intent,
                stage: 'offer' as Stage,
                entities: updatedStateAdd.extracted_entities || {},
                missingFields: [],
                products: [],
                plan: {
                    nextAction: 'recommend_products' as NextAction,
                    oneQuestion: thankAdd,
                    ctaType: 'choose' as CtaType,
                    recommendationStrategy: 'match_query' as RecommendationStrategy,
                    shouldOfferDiscount: false,
                    handoffReason: '',
                },
                updatedState: updatedStateAdd,
                aiCallsCount: 0,
                language,
                next_action: ADD_TO_CART_ACTION,
            };
        }
    }

    if (
        wasInClosingFlow &&
        completeness.complete &&
        fastPathColorReady &&
        !askingProductInfo &&
        !addAnotherIntent &&
        (userAffirms || (userDeclinesMore && botAskedAddMore && !botAskedConfirm))
    ) {
        const e = conversationState.extracted_entities || {};
        const productName = products[0]?.name || e.product_query || '';
        const confirmedColor = colorForFastPath ?? e.color;

        let checkoutState = ensureCartForCheckout(
            {
                ...conversationState,
                extracted_entities: {
                    ...e,
                    color: confirmedColor,
                    product_query: productName || e.product_query,
                    product_id: products[0]?.id || e.product_id,
                },
            },
            products[0],
            merchantConfig.storeCurrency || merchantConfig.currency
        );
        const cartItems = getCartItems(checkoutState);
        const cartSummary = formatCartSummary(cartItems, language);
        const thankMsg = buildOrderConfirmedMessage(language, {
            name: e.name,
            phone: e.phone,
            address: e.address,
            product_name:
                cartItems.length > 1
                    ? (language === 'arabic' ? `${cartItems.length} منتجات` : `${cartItems.length} products`)
                    : (cartItems[0]?.productName || productName),
            color: confirmedColor,
            size: e.size,
            quantity: e.quantity
        });

        logger.info('⚡ SalesGPT: deterministic confirm_order fast-path', {
            merchantId,
            product: productName,
            cartItems: cartItems.length,
            missing: completeness.missing,
            trigger: userAffirms ? 'affirmative' : 'negative_no_more_additions',
            stageId: stageId || null
        });
        console.log('⚡ SalesGPT: confirm_order fast-path engaged', {
            messageLength: messageText.length,
            trigger: userAffirms ? 'yes' : 'no_decline_more',
            hasName: Boolean(e.name),
            hasPhone: Boolean(e.phone),
            hasAddress: Boolean(e.address),
            cartItems: cartItems.length,
            cartSummaryLength: cartSummary.length,
        });

        salesResult = {
            responseText: thankMsg,
            stageId: '8',
            stageName: 'Order Confirmation',
            intent: 'order',
            stage: 'close',
            collectedInfo: {
                product_name: cartItems[0]?.productName || productName,
                product_id: cartItems[0]?.productId || products[0]?.id,
                color: confirmedColor,
                size: e.size,
                quantity: e.quantity || 1,
                name: e.name,
                phone: e.phone,
                address: e.address
            },
            nextAction: CONFIRM_ORDER_ACTION,
            aiCallsCount: 0
        };

        const updatedStateFast: ConversationState = {
            ...checkoutState,
            last_intent: 'order',
            language,
            awaiting_order_confirmation: false,
            last_order: isReturningAfterOrder ? undefined : conversationState.last_order,
            extracted_entities: {
                ...(checkoutState.extracted_entities || {}),
                name: e.name,
                phone: e.phone,
                address: e.address,
                // Keep a primary product hint for legacy notes; ORDER_DATA uses cart
                product_query: cartItems[0]?.productName || productName,
                product_id: cartItems[0]?.productId || products[0]?.id,
                color: cartItems[0]?.color || confirmedColor,
                size: cartItems[0]?.size || e.size,
                quantity: cartItems[0]?.quantity || e.quantity,
            },
            last_recommended_products: cartItems.map((i) => i.productId),
            last_interaction: new Date().toISOString(),
            message_count: (conversationState.message_count || 0) + 1
        };
        applySalesGPTStage(updatedStateFast, '8');

        const processingTimeFast = Date.now() - startTime;
        logger.info('🧠 SalesGPT pipeline completed (fast-path)', {
            merchantId,
            processingTimeMs: processingTimeFast,
            aiCallsCount: 0
        });

        return {
            replyText: thankMsg,
            intent: 'order',
            stage: 'close',
            entities: {
                ...(updatedStateFast.extracted_entities || {}),
            },
            missingFields: [],
            products,
            plan: {
                nextAction: 'confirm_order' as NextAction,
                oneQuestion: thankMsg,
                ctaType: 'confirm' as CtaType,
                recommendationStrategy: 'match_query' as RecommendationStrategy,
                shouldOfferDiscount: false,
                handoffReason: ''
            },
            updatedState: updatedStateFast,
            aiCallsCount: 0,
            language,
            next_action: CONFIRM_ORDER_ACTION
        };
    }

    if (wasInClosingFlow && userAffirms && !completeness.complete) {
        logger.warn('SalesGPT: user confirmed but order is incomplete', {
            merchantId,
            missing: completeness.missing
        });
    }
    // Negative + incomplete while in closing flow → fall through to agent.step() to collect fields.

    try {
        salesResult = await agent.step(messageText, products, catalogAwareness);
        if (
            catalogAwareness.noMatchForSpecificQuery &&
            violatesNoMatchGrounding(salesResult.responseText, catalogOverview, language)
        ) {
            const discardedResponseText = salesResult.responseText;
            logger.warn('SalesGPT: no-match grounding replaced hallucinated catalog reply', {
                merchantId,
                discardedResponseText,
            });
            const storeName = merchantConfig.storeName || merchantConfig.store_name || '';
            salesResult.responseText = buildNoMatchFallbackMessage({
                language,
                persona: merchantConfig.persona,
                salespersonName: storeName ? `مساعد ${storeName}` : 'مساعد المتجر',
                storeName,
                catalogOverview,
            });
        } else if (products[0] && !isSellableProduct(products[0])) {
            // OOS focus: admit existence + unavailability; never offer colors/sizes.
            salesResult.responseText = buildOutOfStockMessage(
                language === 'english' ? 'english' : 'arabic',
                products[0].name
            );
            salesResult.nextAction = 'present_product';
            salesResult.collectedInfo = {
                ...salesResult.collectedInfo,
                color: undefined,
                size: undefined,
            };
        } else {
            const grounding = validateCatalogReplyGrounding({
                responseText: salesResult.responseText,
                products,
                customerMessage: messageText,
                catalogOverview,
            });
            if (!grounding.valid) {
                logger.warn('SalesGPT: replaced reply with ungrounded catalog claims', {
                    merchantId,
                    reasons: grounding.reasons,
                });
                salesResult.responseText = buildGroundedCatalogFallback(
                    products,
                    language === 'english' ? 'english' : 'arabic'
                );
            }
        }
    } catch (error) {
        logger.error('SalesGPT agent failed', error as Error, { merchantId });
        console.error('❌ SalesGPT error:', error);

        salesResult = {
            responseText: language === 'arabic'
                ? 'عذراً، واجهنا مشكلة تقنية. كيف يمكنني مساعدتك؟'
                : 'Sorry, we encountered a technical issue. How can I help you?',
            stageId: '1',
            stageName: 'Introduction',
            intent: 'other',
            stage: 'discover',
            collectedInfo: {},
            nextAction: 'greet',
            aiCallsCount: 0
        };
    }

    // ==================== STEP 3: Handle Image Requests ====================
    let finalReplyText = salesResult.responseText;

    // Attach images ONLY when the CURRENT message explicitly asks to see a photo.
    // Never as a side-effect of color selection or a previous bot offer.
    const shouldAttachImage =
        isExplicitPhotoRequest(messageText) &&
        !isExplicitPhotoRefusal(messageText);

    if (shouldAttachImage && catalogAwareness.noMatchForSpecificQuery) {
        // Do not attach a random catalog photo after a genuine catalog miss.
        finalReplyText = stripFalseImageDeliveryClaims(finalReplyText);
    } else if (shouldAttachImage) {
        // Resolve the product the customer asked to see — never blindly use a stale products[0].
        const imageProduct =
            mentionedInMessage[0] ||
            (salesResult.collectedInfo.product_name
                ? findProductsMentionedInText(
                      String(salesResult.collectedInfo.product_name),
                      catalogForMention
                  )[0]
                : undefined) ||
            (activeProductId
                ? products.find((p) => p.id === activeProductId) ||
                  catalogForMention.find((p) => p.id === activeProductId)
                : undefined) ||
            products[0];

        if (imageProduct?.imageUrl) {
            const requestedColor =
                salesResult.collectedInfo.color ||
                conversationState.extracted_entities?.color ||
                null;
            const imageUrlForBot = await buildColorAwareImageTag(
                merchantId,
                imageProduct,
                requestedColor,
                messageText
            );
            const caption = sanitizeCaptionWhenImageSent(
                salesResult.responseText,
                language,
                imageProduct.name
            );
            finalReplyText = `${caption}\n\n[IMAGE: ${imageUrlForBot}]`;
            // Keep focus on the product whose image we sent
            products = [imageProduct, ...products.filter((p) => p.id !== imageProduct.id)];
            activeProductId = imageProduct.id;
            console.log('📸 SalesGPT color-aware image:', {
                product: imageProduct.name,
                productId: imageProduct.id,
                requestedColor,
                imageUrlForBot,
                captionLength: caption.length,
            });
        } else if (products.length > 1 && !imageProduct) {
            const productList = products.slice(0, 3).map(p => p.name).join('، ');
            finalReplyText = language === 'arabic'
                ? `في أكثر من منتج: ${productList}. شو المنتج اللي بدك صورته؟`
                : `Multiple products found: ${productList}. Which one do you want to see?`;
        } else if (!imageProduct) {
            finalReplyText = language === 'arabic'
                ? `عذراً، ما عندي المنتج المطلوب 😔 جرّب اسم تاني أو اسأل "شو عندك؟"`
                : `Sorry, product not found 😔 Try another name or ask "what do you have?"`;
        } else {
            // Product found but no image URL — strip false "here's the photo" claims
            finalReplyText = stripFalseImageDeliveryClaims(finalReplyText);
        }
    } else {
        // Price/specs/etc. — never leave hallucinated image-delivery phrases in the reply
        finalReplyText = stripFalseImageDeliveryClaims(finalReplyText);
    }

    // ==================== STEP 4: Build Updated Conversation State ====================
    // Strict catalog-bound color — never on OOS products; user history beats AI.
    const focusProduct = products[0] && isSellableProduct(products[0]) ? products[0] : null;
    const colorResolution = resolveProductOrderColor({
        product: focusProduct || undefined,
        messageText,
        recentMessages,
        conversationState,
        aiColor: focusProduct ? salesResult.collectedInfo.color : null,
        language,
        replyText: finalReplyText
    });
    let resolvedColor = focusProduct ? colorResolution.color : null;
    finalReplyText = colorResolution.replyText;
    if (resolvedColor) {
        salesResult.collectedInfo.color = resolvedColor;
    } else if (focusProduct?.colors?.length) {
        salesResult.collectedInfo.color = undefined;
    } else {
        salesResult.collectedInfo.color = undefined;
        salesResult.collectedInfo.size = undefined;
    }

    const storeCurrency = merchantConfig.storeCurrency || merchantConfig.currency;
    // Drop previous SKU variants when catalog focus moved (e.g. watch → shirt).
    const focusedEntities = clearDraftOnFocusChange(
        conversationState.extracted_entities,
        products[0]
    );

    const updatedState: ConversationState = {
        ...conversationState,
        last_intent: salesResult.intent,
        salesgpt_stage_id: salesResult.stageId,
        language,
        last_order: isReturningAfterOrder ? undefined : conversationState.last_order,
        awaiting_order_confirmation: salesResult.nextAction === AWAIT_CONFIRMATION_ACTION,
        cart: normalizeCart(conversationState.cart, { storeCurrency }),
        extracted_entities: {
            ...focusedEntities,
            product_query:
                sanitizeCollectedText(salesResult.collectedInfo.product_name) ||
                sanitizeCollectedText(focusedEntities.product_query) ||
                sanitizeCollectedText(products[0]?.name),
            // Focused catalog product wins over a stale draft product_id.
            product_id:
                (products[0]?.id ? String(products[0].id) : undefined) ||
                sanitizeCollectedText(salesResult.collectedInfo.product_id) ||
                sanitizeCollectedText(focusedEntities.product_id),
            color: resolvedColor || undefined,
            size: focusProduct
                ? sanitizeCollectedText(salesResult.collectedInfo.size) ||
                  sanitizeCollectedText(focusedEntities.size)
                : undefined,
            quantity: (() => {
                const fromAi = coerceSafeQuantity(
                    messageText,
                    salesResult.collectedInfo.quantity
                );
                if (fromAi !== undefined) return fromAi;
                if (messageSignalsBothProducts(messageText)) return undefined;
                const focusName =
                    focusProduct?.name ||
                    sanitizeCollectedText(salesResult.collectedInfo.product_name) ||
                    sanitizeCollectedText(focusedEntities.product_query);
                if (focusName) {
                    const fromWords = resolveQuantityFromMessage(messageText, focusName);
                    if (fromWords != null && fromWords > 0) {
                        return coerceSafeQuantity(messageText, fromWords) ?? fromWords;
                    }
                }
                return focusedEntities.quantity;
            })(),
            name:
                sanitizeCollectedText(salesResult.collectedInfo.name) ||
                sanitizeCollectedText(focusedEntities.name),
            phone:
                sanitizeCollectedText(salesResult.collectedInfo.phone) ||
                sanitizeCollectedText(focusedEntities.phone),
            address:
                sanitizeCollectedText(salesResult.collectedInfo.address) ||
                sanitizeCollectedText(focusedEntities.address)
        },
        last_interaction: new Date().toISOString(),
        message_count: (conversationState.message_count || 0) + 1
    };
    applySalesGPTStage(updatedState, salesResult.stageId);

    // Write resolved color/size onto the matching cart line immediately (not only at confirm).
    // Never create or mutate lines for out-of-stock products.
    if (focusProduct) {
        const filledVariants = fillCartVariantsFromDraft(updatedState, focusProduct);
        updatedState.cart = filledVariants.cart;
    }

    // Save product to history (draft focus)
    if (products.length > 0) {
        updatedState.last_recommended_products = [products[0].id];
    }

    // ==================== STEP 5: Return Result ====================
    // next_action is already policy-gated in the agent: confirm_order only after
    // explicit customer finalization; otherwise await_confirmation.
    const confirmGate = gateConfirmWhenColorInvalid({
        nextAction: salesResult.nextAction,
        product: focusProduct || undefined,
        resolvedColor,
        language,
        replyText: finalReplyText,
        rejectedColor: colorResolution.policy?.rejectedAiColor
    });
    let effectiveNextAction = confirmGate.nextAction;
    finalReplyText = confirmGate.replyText;

    // Model signaled add-another → lock draft into cart (deterministic write).
    // Skip when the message already named multiple products (handled by cart sync).
    // WHY: affirming while checkout-ready must finalize, not lock an upsell SKU
    // the model invented after «هل تود إضافة…؟» (S10 «نعم أكد» → قميص).
    const affirmingCheckoutReady =
        customerAffirmsOrder(messageText) &&
        checkOrderCompleteness(updatedState, focusProduct).complete;
    const modelWantsAdd =
        !affirmingCheckoutReady &&
        !shouldSyncMultiProductCart(messageText, mentionedInMessage) &&
        (salesResult.customerRequest?.wantsAddAnother === true ||
            detectsAddAnotherIntent(messageText, salesResult.customerRequest?.wantsAddAnother));
    if (
        focusProduct &&
        modelWantsAdd &&
        effectiveNextAction !== CONFIRM_ORDER_ACTION &&
        (isDraftLineComplete(updatedState.extracted_entities, focusProduct).complete ||
            cartHasItems(updatedState))
    ) {
        const qtySafe = coerceSafeQuantity(
            messageText,
            updatedState.extracted_entities?.quantity
        );
        const stateForLock: ConversationState = {
            ...updatedState,
            extracted_entities: {
                ...(updatedState.extracted_entities || {}),
                quantity: qtySafe,
            },
        };
        const locked = lockDraftIntoCart(
            stateForLock,
            focusProduct,
            merchantConfig.storeCurrency || merchantConfig.currency
        );
        if (locked.locked && locked.item) {
            Object.assign(updatedState, locked.state);
            finalReplyText = buildAddedToCartMessage(
                language,
                locked.item,
                normalizeCart(locked.state.cart, { storeCurrency })
            );
            effectiveNextAction = ADD_TO_CART_ACTION;
            updatedState.awaiting_order_confirmation = false;
            updatedState.last_intent = 'browse';
            applySalesGPTStage(updatedState, '4');
        }
    }

    // Before await/confirm: promote complete draft into cart so ORDER_DATA is cart-backed.
    if (
        focusProduct &&
        (effectiveNextAction === AWAIT_CONFIRMATION_ACTION ||
            effectiveNextAction === CONFIRM_ORDER_ACTION)
    ) {
        const checkoutReady = ensureCartForCheckout(
            updatedState,
            focusProduct,
            merchantConfig.storeCurrency || merchantConfig.currency
        );
        updatedState.cart = checkoutReady.cart;
        if (checkoutReady.extracted_entities) {
            // Preserve identity; after ensureCart draft product fields may be cleared
            updatedState.extracted_entities = {
                ...checkoutReady.extracted_entities,
                name: updatedState.extracted_entities?.name || checkoutReady.extracted_entities.name,
                phone: updatedState.extracted_entities?.phone || checkoutReady.extracted_entities.phone,
                address:
                    updatedState.extracted_entities?.address || checkoutReady.extracted_entities.address,
            };
        }
        const items = getCartItems(updatedState);
        if (items.length > 0) {
            updatedState.last_recommended_products = items.map((i) => i.productId);
            // Keep entity hints for channel notes / identity
            const primary = items[0];
            updatedState.extracted_entities = {
                ...(updatedState.extracted_entities || {}),
                product_query: primary.productName,
                product_id: primary.productId,
                color: primary.color,
                size: primary.size,
                quantity: primary.quantity,
            };
            // Pre-confirmation copy must show priced per-currency lines from the cart.
            if (effectiveNextAction === AWAIT_CONFIRMATION_ACTION) {
                const e = updatedState.extracted_entities || {};
                finalReplyText = buildAwaitConfirmationMessage(
                    language,
                    {
                        name: e.name,
                        phone: e.phone,
                        address: e.address,
                        product_name: primary.productName,
                        color: primary.color,
                        size: primary.size,
                        quantity: primary.quantity,
                    },
                    formatCartSummary(items, language, {
                        shippingPolicy: merchantConfig.shippingPolicy,
                    })
                );
            }
        }
    }

    if (effectiveNextAction === AWAIT_CONFIRMATION_ACTION) {
        applySalesGPTStage(updatedState, '8');
        updatedState.awaiting_order_confirmation = true;
    }
    if (effectiveNextAction === CONFIRM_ORDER_ACTION) {
        updatedState.awaiting_order_confirmation = false;
    }

    // Color ask template ONLY on order-ish turns — never greeting/price/browse.
    // (HOTFIX 2E: unconditional force rewrote «كم سعر ساعة؟» / «السلام عليكم».)
    const focusForPending = focusProduct;
    const mayForceColorAsk = mayReplaceWithOrderTemplate({
        nextAction: effectiveNextAction,
    });
    if (
        mayForceColorAsk &&
        focusForPending &&
        focusForPending.colors?.length &&
        isDraftLineComplete(updatedState.extracted_entities, focusForPending).missing.includes(
            'color'
        )
    ) {
        if (!detectPendingBotQuestion(finalReplyText)) {
            finalReplyText = buildAskColorMessage(
                language === 'english' ? 'english' : 'arabic',
                focusForPending.colors
            );
            effectiveNextAction = 'collect_info';
        }
    } else if (
        focusForPending &&
        !(focusForPending.colors && focusForPending.colors.length > 0) &&
        /أي لون|الألوان المتاحة|which color|available colors/i.test(finalReplyText)
    ) {
        // Shirt etc. — strip invented color questions from the model.
        finalReplyText = finalReplyText
            .replace(/[^.!\n]*?(?:أي لون|الألوان المتاحة|which color|available colors)[^.!\n]*[.!]?\s*/gi, '')
            .trim() || finalReplyText;
    }

    // Bind or clear pending_bot_question from the outbound template (never free LLM inference alone).
    {
        const pendingBind = bindPendingBotQuestion(
            finalReplyText,
            updatedState,
            focusForPending
        );
        Object.assign(updatedState, pendingBind);
    }

    const processingTime = Date.now() - startTime;

    logger.info('🧠 SalesGPT pipeline completed', {
        merchantId,
        intent: salesResult.intent,
        stage: salesResult.stage,
        stageId: salesResult.stageId,
        nextAction: effectiveNextAction,
        cartItems: getCartItems(updatedState).length,
        aiCallsCount: salesResult.aiCallsCount,
        processingTimeMs: processingTime
    });

    console.log('✅ SalesGPT decision:', {
        intent: salesResult.intent,
        stage: salesResult.stage,
        stageId: updatedState.salesgpt_stage_id || salesResult.stageId,
        nextAction: effectiveNextAction,
        collectedInfo: salesResult.collectedInfo,
        cartItems: getCartItems(updatedState).length,
        aiCalls: salesResult.aiCallsCount
    });

    const isFinalConfirm = effectiveNextAction === CONFIRM_ORDER_ACTION;

    return {
        replyText: finalReplyText,
        intent: salesResult.intent,
        stage: updatedState.current_stage || salesResult.stage,
        entities: {
            ...(updatedState.extracted_entities || {}),
            product_query: salesResult.collectedInfo.product_name || updatedState.extracted_entities?.product_query,
            color: salesResult.collectedInfo.color || updatedState.extracted_entities?.color,
            size: salesResult.collectedInfo.size || updatedState.extracted_entities?.size,
            quantity: salesResult.collectedInfo.quantity || updatedState.extracted_entities?.quantity,
            product_id: salesResult.collectedInfo.product_id || updatedState.extracted_entities?.product_id
        },
        missingFields: [],
        products,
        plan: {
            nextAction: (isFinalConfirm ? 'confirm_order' : 'recommend_products') as NextAction,
            oneQuestion: salesResult.responseText,
            ctaType: (isFinalConfirm ? 'confirm' : 'choose') as CtaType,
            recommendationStrategy: 'match_query' as RecommendationStrategy,
            shouldOfferDiscount: false,
            handoffReason: ''
        },
        updatedState,
        aiCallsCount: salesResult.aiCallsCount,
        language,
        next_action: effectiveNextAction
    };
};

// ==================== EXPORTS ====================

export { SalesGPTAgent } from './agent.js';
export type { SalesGPTConfig, SalesGPTResult } from './agent.js';
export { CONVERSATION_STAGES, getStageDescription, mapStageIdToStage } from './stages.js';
export {
  applySalesGPTStage,
  applyFreshConversationStage,
  applyHandoffStage,
  conversationStageForDb,
  deriveStageFromSalesGPTStageId,
  FRESH_CONVERSATION_STAGE_ID,
} from './conversationStateSync.js';
export { getSalesGPTTools, executeTool } from './tools.js';
export { buildSalesGPTSystemPrompt } from './prompts.js';
export {
  ADD_TO_CART_ACTION,
  getCartItems,
  ensureCartForCheckout,
  lockDraftIntoCart,
  normalizeCart,
  findProductsMentionedInText,
  coerceSafeQuantity,
} from './conversationCart.js';
export {
  isExplicitPhotoRequest,
  resolveTurnIntent,
  type TurnIntent,
} from './turnIntent.js';
