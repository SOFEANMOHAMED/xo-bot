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
import { resolveColorEntity, formatColorOptionsForDisplay } from '../../catalog/color-options.js';
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
    isAffirmativeReply,
    isNegativeReply,
    botReplyAsksForConfirmation,
    buildOrderConfirmedMessage,
    isProductInfoRequest,
    AWAIT_CONFIRMATION_ACTION,
    CONFIRM_ORDER_ACTION,
    shouldAppendOrderData
} from './orderConfirmationPolicy.js';

// Re-export confirmation helpers so channel controllers keep a stable import path
export {
    isAffirmativeReply,
    isNegativeReply,
    botReplyAsksForConfirmation,
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

// ==================== HELPER: Extract keywords ====================

const extractProductKeywords = (messageText: string): string[] => {
    if (!messageText || messageText.trim().length === 0) return [];
    const text = messageText.trim().toLowerCase();

    const stopWords = [
        'بدي', 'ابي', 'اريد', 'ابغى', 'عاوز', 'اشتري', 'احجز', 'اطلب',
        'شو', 'ايش', 'كم', 'وين', 'متى', 'كيف', 'هل',
        'سعر', 'ثمن', 'تكلفة', 'قيمة',
        'عندكم', 'عندك', 'لديكم', 'معكم', 'موجود', 'متوفر',
        'السلام', 'عليكم', 'مرحبا', 'اهلا', 'هلا', 'صباح', 'مساء',
        'من', 'الى', 'في', 'على', 'عن', 'مع', 'هذا', 'هذه', 'ذلك',
        'نعم', 'اي', 'اه', 'طيب', 'تمام', 'ماشي',
        'لا', 'لأ', 'مو', 'ما', 'مش',
        'صورة', 'صور', 'وريني', 'فرجيني', 'ارني',
        'want', 'need', 'buy', 'purchase', 'order', 'get',
        'what', 'how', 'where', 'when', 'which',
        'price', 'cost', 'available', 'have', 'do', 'you',
        'the', 'a', 'an', 'is', 'are',
        'yes', 'no', 'ok', 'okay',
        'image', 'picture', 'photo', 'show', 'see'
    ];

    const words = text
        .replace(/[.,;:!?()]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2 && !stopWords.includes(w) && !/^\d+$/.test(w));

    return [...new Set(words)].slice(0, 5);
};

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

interface CompletenessCheck {
    complete: boolean;
    missing: string[];
}

/** Validates we have all fields required to create the order (name, phone, address, product, color/size when applicable). */
export function checkOrderCompleteness(
    state: ConversationState,
    product?: Product
): CompletenessCheck {
    const e = state.extracted_entities || {};
    const missing: string[] = [];
    if (!e.name) missing.push('name');
    if (!e.phone) missing.push('phone');
    if (!e.address) missing.push('address');

    const hasProduct = !!(
        product ||
        (state.last_recommended_products && state.last_recommended_products.length > 0) ||
        e.product_query ||
        e.product_id
    );
    if (!hasProduct) missing.push('product');

    if (product) {
        const hasColors = Array.isArray(product.colors) && product.colors.length > 0;
        const hasSizes = Array.isArray(product.sizes) && product.sizes.length > 0;
        if (hasColors && !e.color) missing.push('color');
        if (hasSizes && !e.size) missing.push('size');
    }

    return { complete: missing.length === 0, missing };
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

    // Strategy 0: explicit entity query has highest priority for switching focus
    if (conversationState.extracted_entities?.product_query) {
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
        products = await getTopProducts(merchantId, 5);
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
        (!conversationState.current_stage || conversationState.current_stage === 'discover') &&
        (!conversationState.salesgpt_stage_id || conversationState.salesgpt_stage_id === '1')
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
    const userSaidYes = isAffirmativeReply(messageText);
    const userSaidNo = isNegativeReply(messageText);
    const completeness = checkOrderCompleteness(conversationState, products[0]);

    // Affirmative confirm OR decline of upsell/"anything else?" while order is complete → finalize.
    // Never finalize when the customer is asking for product details (e.g. "تمام، معلومات أكثر؟").
    const askingProductInfo = isProductInfoRequest(messageText);
    if (
        wasInClosingFlow &&
        completeness.complete &&
        (userSaidYes || userSaidNo) &&
        !askingProductInfo
    ) {
        const e = conversationState.extracted_entities || {};
        const productName = products[0]?.name || e.product_query || '';
        const thankMsg = buildOrderConfirmedMessage(language, {
            name: e.name,
            phone: e.phone,
            address: e.address,
            product_name: productName,
            color: e.color,
            size: e.size,
            quantity: e.quantity
        });

        logger.info('⚡ SalesGPT: deterministic confirm_order fast-path', {
            merchantId,
            product: productName,
            missing: completeness.missing,
            trigger: userSaidYes ? 'affirmative' : 'negative_no_more_additions',
            stageId: stageId || null
        });
        console.log('⚡ SalesGPT: confirm_order fast-path engaged', {
            messageLength: messageText.length,
            trigger: userSaidYes ? 'yes' : 'no',
            hasName: Boolean(e.name),
            hasPhone: Boolean(e.phone),
            hasAddress: Boolean(e.address),
        });

        salesResult = {
            responseText: thankMsg,
            stageId: '8',
            stageName: 'Order Confirmation',
            intent: 'order',
            stage: 'close',
            collectedInfo: {
                product_name: productName,
                product_id: products[0]?.id,
                color: e.color,
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
            ...conversationState,
            last_intent: 'order',
            current_stage: 'close',
            salesgpt_stage_id: '8',
            language,
            awaiting_order_confirmation: false,
            last_order: isReturningAfterOrder ? undefined : conversationState.last_order,
            extracted_entities: {
                ...(conversationState.extracted_entities || {}),
                product_query: productName || conversationState.extracted_entities?.product_query,
                product_id: products[0]?.id || conversationState.extracted_entities?.product_id,
                color: e.color,
                size: e.size,
                quantity: e.quantity,
                name: e.name,
                phone: e.phone,
                address: e.address
            },
            last_interaction: new Date().toISOString(),
            message_count: (conversationState.message_count || 0) + 1
        };
        if (products.length > 0) updatedStateFast.last_recommended_products = [products[0].id];

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
                product_query: productName,
                color: e.color,
                size: e.size,
                quantity: e.quantity,
                product_id: products[0]?.id
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

    if (wasInClosingFlow && userSaidYes && !completeness.complete) {
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
        if (products.length === 1 && products[0].imageUrl) {
            const requestedColor =
                salesResult.collectedInfo.color ||
                conversationState.extracted_entities?.color ||
                null;
            const imageUrlForBot = await buildColorAwareImageTag(
                merchantId,
                products[0],
                requestedColor,
                messageText
            );
            const caption = sanitizeCaptionWhenImageSent(
                salesResult.responseText,
                language,
                products[0].name
            );
            finalReplyText = `${caption}\n\n[IMAGE: ${imageUrlForBot}]`;
            console.log('📸 SalesGPT color-aware image:', {
                product: products[0].name,
                requestedColor,
                imageUrlForBot,
                captionLength: caption.length,
            });
        } else if (products.length > 1) {
            const productList = products.slice(0, 3).map(p => p.name).join('، ');
            finalReplyText = language === 'arabic'
                ? `في أكثر من منتج: ${productList}. شو المنتج اللي بدك صورته؟`
                : `Multiple products found: ${productList}. Which one do you want to see?`;
        } else if (products.length === 0) {
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
    // Resolve color against product options (compound options stay whole)
    let resolvedColor =
        salesResult.collectedInfo.color || conversationState.extracted_entities?.color || null;
    if (products[0]?.colors?.length && (resolvedColor || messageText)) {
        const colorResolution = resolveColorEntity(
            resolvedColor,
            products[0].colors,
            messageText
        );
        if (colorResolution.needsClarification && colorResolution.ambiguous.length > 1) {
            const options = formatColorOptionsForDisplay(
                colorResolution.ambiguous,
                language === 'english' ? 'english' : 'arabic'
            );
            finalReplyText = language === 'arabic'
                ? `تقصد أي خيار لون؟ 🎨\n${options}`
                : `Which color option did you mean? 🎨\n${options}`;
            resolvedColor = null;
        } else if (colorResolution.color) {
            resolvedColor = colorResolution.color;
            salesResult.collectedInfo.color = colorResolution.color;
        }
    }

    const updatedState: ConversationState = {
        ...conversationState,
        last_intent: salesResult.intent,
        current_stage: salesResult.stage,
        salesgpt_stage_id: salesResult.stageId,
        language,
        last_order: isReturningAfterOrder ? undefined : conversationState.last_order,
        awaiting_order_confirmation: salesResult.nextAction === AWAIT_CONFIRMATION_ACTION,
        extracted_entities: {
            ...(conversationState.extracted_entities || {}),
            product_query: salesResult.collectedInfo.product_name || conversationState.extracted_entities?.product_query,
            color: resolvedColor || undefined,
            size: salesResult.collectedInfo.size || conversationState.extracted_entities?.size,
            quantity: salesResult.collectedInfo.quantity || conversationState.extracted_entities?.quantity,
            name: salesResult.collectedInfo.name || conversationState.extracted_entities?.name,
            phone: salesResult.collectedInfo.phone || conversationState.extracted_entities?.phone,
            address: salesResult.collectedInfo.address || conversationState.extracted_entities?.address
        },
        last_interaction: new Date().toISOString(),
        message_count: (conversationState.message_count || 0) + 1
    };

    // Save product to history
    if (products.length > 0) {
        updatedState.last_recommended_products = [products[0].id];
    }

    // ==================== STEP 5: Return Result ====================
    // next_action is already policy-gated in the agent: confirm_order only after
    // explicit customer finalization; otherwise await_confirmation.
    const effectiveNextAction = salesResult.nextAction;
    if (effectiveNextAction === AWAIT_CONFIRMATION_ACTION) {
        updatedState.salesgpt_stage_id = '8';
        updatedState.current_stage = 'close';
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
        aiCallsCount: salesResult.aiCallsCount,
        processingTimeMs: processingTime
    });

    console.log('✅ SalesGPT decision:', {
        intent: salesResult.intent,
        stage: salesResult.stage,
        stageId: updatedState.salesgpt_stage_id || salesResult.stageId,
        nextAction: effectiveNextAction,
        collectedInfo: salesResult.collectedInfo,
        aiCalls: salesResult.aiCallsCount
    });

    const isFinalConfirm = effectiveNextAction === CONFIRM_ORDER_ACTION;

    return {
        replyText: finalReplyText,
        intent: salesResult.intent,
        stage: salesResult.stage,
        entities: {
            product_query: salesResult.collectedInfo.product_name,
            color: salesResult.collectedInfo.color,
            size: salesResult.collectedInfo.size,
            quantity: salesResult.collectedInfo.quantity,
            product_id: salesResult.collectedInfo.product_id
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
export { getSalesGPTTools, executeTool } from './tools.js';
export { buildSalesGPTSystemPrompt } from './prompts.js';
