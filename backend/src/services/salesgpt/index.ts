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
    isProductInfoRequest,
    sanitizeCollectedText,
    AWAIT_CONFIRMATION_ACTION,
    CONFIRM_ORDER_ACTION,
    shouldAppendOrderData
} from './orderConfirmationPolicy.js';
import { extractProductKeywords } from './productKeywords.js';
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
    coerceSafeQuantity,
    detectsAddAnotherIntent,
    ensureCartForCheckout,
    fillCartVariantsFromDraft,
    findProductsMentionedInText,
    formatCartSummary,
    getCartItems,
    isCheckoutReady,
    isDraftLineComplete,
    lockDraftIntoCart,
    messageSignalsBothProducts,
    normalizeCart,
    replaceCartItems,
    shouldSyncMultiProductCart,
} from './conversationCart.js';

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
    if (!catalogColors?.length) {
        const fallback =
            params.aiColor ||
            params.conversationState.extracted_entities?.color ||
            null;
        return { color: fallback, replyText: params.replyText, policy: null };
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
        conversationState,
        merchantConfig
    } = input;

    const startTime = Date.now();

    // Detect language
    const language: Language = conversationState.language || detectLanguage(messageText);

    logger.info('🧠 SalesGPT pipeline started', {
        merchantId,
        messageLength: messageText.length,
        language
    });

    // ==================== STEP 1: Product Search ====================
    // Active product = focus for deep details. Catalog overview is ALWAYS attached
    // so the model can answer alternatives truthfully without keyword gates.
    let products: Product[] = [];
    let activeProductId: string | null = conversationState.last_recommended_products?.[0] || null;

    // Prefetch a wide catalog slice for name→message matching (images + multi-buy).
    const catalogForMention = await getTopProducts(merchantId, 40);
    const mentionedInMessage = findProductsMentionedInText(messageText, catalogForMention);

    // Strategy -1: seeded product from ad/post/comment acquisition (recommended start, not exclusive)
    const seededProductId = conversationState.extracted_entities?.product_id;
    if (seededProductId) {
        const seeded = await getProductById(merchantId, seededProductId);
        if (seeded) {
            products = [seeded];
            activeProductId = seeded.id;
            console.log('🎯 SalesGPT: Using acquisition-seeded product:', seeded.name);
        }
    }

    // Strategy 0a: products named in the CURRENT message win (fixes wrong photo / focus).
    if (mentionedInMessage.length > 0) {
        products = mentionedInMessage;
        activeProductId = mentionedInMessage[0].id;
        console.log('🎯 SalesGPT: Products mentioned in message:', {
            names: mentionedInMessage.map((p) => p.name),
        });
    }

    // Strategy 0: explicit entity query has highest priority for switching focus
    if (mentionedInMessage.length === 0 && conversationState.extracted_entities?.product_query) {
        products = await searchProducts(merchantId, conversationState.extracted_entities.product_query, undefined, 5);
        if (products[0]) activeProductId = products[0].id;
    }

    // Strategy 1: keyword extraction when we still have no focus product
    if (products.length === 0) {
        const smartKeywords = extractProductKeywords(messageText);
        const meaningfulKeywords = smartKeywords.filter(k => k.length >= 3);
        if (meaningfulKeywords.length > 0) {
            const sortedKeywords = [...meaningfulKeywords].sort((a, b) => b.length - a.length);
            for (const keyword of sortedKeywords) {
                const searchResults = await searchProducts(merchantId, keyword, { inStockOnly: false }, 5);
                if (searchResults.length > 0) {
                    products = searchResults;
                    activeProductId = searchResults[0]?.id || activeProductId;
                    console.log('✅ SalesGPT: Found products from keywords:', {
                        keyword,
                        count: products.length,
                        topProduct: searchResults[0]?.name
                    });
                    break;
                }
            }
        }
    }

    // Strategy 1b: photo request with no product name → prefer last discussed product
    // by scanning recent user turns for catalog names (not stale wrong products[0]).
    const asksForPhoto = isExplicitPhotoRequest(messageText);
    if (asksForPhoto && mentionedInMessage.length === 0) {
        for (let i = recentMessages.length - 1; i >= 0 && i >= recentMessages.length - 8; i--) {
            const msg = recentMessages[i];
            if (msg.role !== 'user') continue;
            const fromHistory = findProductsMentionedInText(msg.content || '', catalogForMention);
            if (fromHistory.length > 0) {
                products = fromHistory;
                activeProductId = fromHistory[0].id;
                console.log('📸 SalesGPT: Photo focus from recent user mention:', fromHistory[0].name);
                break;
            }
        }
    }

    // Strategy 2: From conversation history
    if (products.length === 0 && conversationState.last_recommended_products?.[0]) {
        const productId = conversationState.last_recommended_products[0];
        const product = await getProductById(merchantId, productId);
        if (product) {
            products = [product];
            activeProductId = product.id;
            console.log('📦 SalesGPT: Retrieved product from history:', product.name);
        }
    }

    // Strategy 3: Top products when still empty (browse / cold start)
    if (products.length === 0) {
        products = catalogForMention.length > 0 ? catalogForMention.slice(0, 5) : await getTopProducts(merchantId, 5);
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
        isExploring: true
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

    // Multi-product order / cart correction: rebuild cart from named products (code-owned).
    // Fixes: "التنين القميص والساعة" → two lines qty1; "قميص واحد وساعة" → replace cart.
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
            const currency = merchantConfig.storeCurrency || merchantConfig.currency;
            const cartItems = buildCartItemsFromProducts(productsForCart, messageText, currency);
            // Prefer qty 1 when "both" phrasing made AI/heuristic think quantity=2
            const safeItems = cartItems.map((item) => ({
                ...item,
                quantity: coerceSafeQuantity(messageText, item.quantity) ?? item.quantity,
            }));
            const syncedState = replaceCartItems(conversationState, safeItems);
            const cart = normalizeCart(syncedState.cart);
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
        const draftEntities = {
            ...(conversationState.extracted_entities || {}),
            color: colorForFastPath || conversationState.extracted_entities?.color,
            product_id: products[0]?.id || conversationState.extracted_entities?.product_id,
            product_query:
                products[0]?.name || conversationState.extracted_entities?.product_query,
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
                merchantConfig.storeCurrency || merchantConfig.currency
            );
            if (locked.locked) {
                stateForAdd = locked.state;
                lockedItem = locked.item;
            }
        }

        if (lockedItem || cartHasItems(stateForAdd)) {
            const cart = normalizeCart(stateForAdd.cart);
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

    // Attach images only when agent already gated send_image via model wants_photo.
    const shouldAttachImage = salesResult.nextAction === 'send_image';

    if (shouldAttachImage) {
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
    // Strict catalog-bound color — user history beats AI (prevents hallucinated overwrite)
    const colorResolution = resolveProductOrderColor({
        product: products[0],
        messageText,
        recentMessages,
        conversationState,
        aiColor: salesResult.collectedInfo.color,
        language,
        replyText: finalReplyText
    });
    let resolvedColor = colorResolution.color;
    finalReplyText = colorResolution.replyText;
    if (resolvedColor) {
        salesResult.collectedInfo.color = resolvedColor;
    } else if (products[0]?.colors?.length) {
        salesResult.collectedInfo.color = undefined;
    }

    const updatedState: ConversationState = {
        ...conversationState,
        last_intent: salesResult.intent,
        salesgpt_stage_id: salesResult.stageId,
        language,
        last_order: isReturningAfterOrder ? undefined : conversationState.last_order,
        awaiting_order_confirmation: salesResult.nextAction === AWAIT_CONFIRMATION_ACTION,
        cart: normalizeCart(conversationState.cart),
        extracted_entities: {
            ...(conversationState.extracted_entities || {}),
            product_query:
                sanitizeCollectedText(salesResult.collectedInfo.product_name) ||
                sanitizeCollectedText(conversationState.extracted_entities?.product_query),
            product_id:
                sanitizeCollectedText(salesResult.collectedInfo.product_id) ||
                sanitizeCollectedText(conversationState.extracted_entities?.product_id) ||
                (products[0]?.id ? String(products[0].id) : undefined),
            color: resolvedColor || undefined,
            size:
                sanitizeCollectedText(salesResult.collectedInfo.size) ||
                sanitizeCollectedText(conversationState.extracted_entities?.size),
            quantity: (() => {
                const fromAi = coerceSafeQuantity(
                    messageText,
                    salesResult.collectedInfo.quantity
                );
                if (fromAi !== undefined) return fromAi;
                if (messageSignalsBothProducts(messageText)) return undefined;
                return conversationState.extracted_entities?.quantity;
            })(),
            name:
                sanitizeCollectedText(salesResult.collectedInfo.name) ||
                sanitizeCollectedText(conversationState.extracted_entities?.name),
            phone:
                sanitizeCollectedText(salesResult.collectedInfo.phone) ||
                sanitizeCollectedText(conversationState.extracted_entities?.phone),
            address:
                sanitizeCollectedText(salesResult.collectedInfo.address) ||
                sanitizeCollectedText(conversationState.extracted_entities?.address)
        },
        last_interaction: new Date().toISOString(),
        message_count: (conversationState.message_count || 0) + 1
    };
    applySalesGPTStage(updatedState, salesResult.stageId);

    // Write resolved color/size onto the matching cart line immediately (not only at confirm).
    const filledVariants = fillCartVariantsFromDraft(updatedState, products[0]);
    updatedState.cart = filledVariants.cart;

    // Save product to history (draft focus)
    if (products.length > 0) {
        updatedState.last_recommended_products = [products[0].id];
    }

    // ==================== STEP 5: Return Result ====================
    // next_action is already policy-gated in the agent: confirm_order only after
    // explicit customer finalization; otherwise await_confirmation.
    const confirmGate = gateConfirmWhenColorInvalid({
        nextAction: salesResult.nextAction,
        product: products[0],
        resolvedColor,
        language,
        replyText: finalReplyText,
        rejectedColor: colorResolution.policy?.rejectedAiColor
    });
    let effectiveNextAction = confirmGate.nextAction;
    finalReplyText = confirmGate.replyText;

    // Model signaled add-another → lock draft into cart (deterministic write).
    // Skip when the message already named multiple products (handled by cart sync).
    const modelWantsAdd =
        !shouldSyncMultiProductCart(messageText, mentionedInMessage) &&
        (salesResult.customerRequest?.wantsAddAnother === true ||
            detectsAddAnotherIntent(messageText, salesResult.customerRequest?.wantsAddAnother));
    if (
        modelWantsAdd &&
        effectiveNextAction !== CONFIRM_ORDER_ACTION &&
        (isDraftLineComplete(updatedState.extracted_entities, products[0]).complete ||
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
            products[0],
            merchantConfig.storeCurrency || merchantConfig.currency
        );
        if (locked.locked && locked.item) {
            Object.assign(updatedState, locked.state);
            finalReplyText = buildAddedToCartMessage(
                language,
                locked.item,
                normalizeCart(locked.state.cart)
            );
            effectiveNextAction = ADD_TO_CART_ACTION;
            updatedState.awaiting_order_confirmation = false;
            updatedState.last_intent = 'browse';
            applySalesGPTStage(updatedState, '4');
        }
    }

    // Before await/confirm: promote complete draft into cart so ORDER_DATA is cart-backed.
    if (
        effectiveNextAction === AWAIT_CONFIRMATION_ACTION ||
        effectiveNextAction === CONFIRM_ORDER_ACTION
    ) {
        const checkoutReady = ensureCartForCheckout(
            updatedState,
            products[0],
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
        }
    }

    if (effectiveNextAction === AWAIT_CONFIRMATION_ACTION) {
        applySalesGPTStage(updatedState, '8');
        updatedState.awaiting_order_confirmation = true;
    }
    if (effectiveNextAction === CONFIRM_ORDER_ACTION) {
        updatedState.awaiting_order_confirmation = false;
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
