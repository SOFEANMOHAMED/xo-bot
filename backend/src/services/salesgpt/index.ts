/**
 * SalesGPT Module Index
 * Main entry point that integrates SalesGPT with the existing XoBot pipeline
 * 
 * This module replaces the old AI orchestrator with SalesGPT's
 * stage-based sales conversation management
 */

import {
    SalesGPTAgent,
    SALESGPT_IMAGE_REQUEST_RE,
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

const CATALOG_EXPLORE_PATTERNS: RegExp[] = [
    /شو\s*(في|عندك|متوفر|كمان|غير)/i,
    /(منتجات|اصناف|تصنيفات|غيره|غيرها|بديل|بدائل|باقي)/i,
    /what\s+(do\s+you\s+have|else|other|more)/i,
    /(other\s+products|alternatives|categories|catalog)/i
];

const isCatalogExploreRequest = (text: string): boolean => {
    if (!text) return false;
    return CATALOG_EXPLORE_PATTERNS.some(p => p.test(text));
};

// ==================== DETERMINISTIC ORDER CONFIRMATION GATE ====================

/**
 * Detect if the user's message is affirmative (yes / confirm / agree / correct).
 * Intentionally permissive: must not *require* strict end-of-string matching.
 */
const AFFIRMATIVE_TOKENS = [
    'نعم', 'أيوا', 'ايوا', 'أي', 'اي', 'تمام', 'موافق', 'ماشي', 'طيب',
    'أكيد', 'اكيد', 'بالتأكيد', 'اوكي', 'اوكيه', 'ممتاز', 'صح', 'صحيح',
    'ok', 'okay', 'yes', 'yep', 'yeah', 'sure', 'agree', 'agreed', 'correct', 'right'
];

const NEGATIVE_TOKENS = [
    'لا', 'لأ', 'مش', 'مو', 'ما بدي', 'لا بدي', 'ارفض', 'إرفض', 'إلغاء', 'الغي',
    'no', 'not', 'nope', 'cancel', 'reject', 'stop'
];

const CONFIRM_VERB_PATTERNS: RegExp[] = [
    /(أكد|اكد|أأكد|اؤكد|أؤكد|تأكيد)\s*(الطلب|طلبي|الأوردر)?/i,
    /(بدي|أريد|ابي|عاوز|رح)\s*(أكد|اكد|أأكد|اؤكد|أؤكد|تأكيد)/i,
    /(confirm|place|submit|finalize)\s*(the\s+)?(order|it|my\s+order)?/i
];

function normalizeArabic(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .replace(/[\u064B-\u0652]/g, '') // remove diacritics
        .replace(/[إأآا]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[!,.،؟?]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function containsAnyToken(text: string, tokens: string[]): boolean {
    const normalized = normalizeArabic(text);
    const normalizedTokens = tokens.map(t => normalizeArabic(t));
    const words = new Set(normalized.split(' '));
    return normalizedTokens.some(token =>
        token.includes(' ')
            ? normalized.includes(token)
            : words.has(token)
    );
}

/** Permissive affirmative detection that covers "اي صحيح", "اي تمام", "اي بدي أكد الطلب", "ok", "sure", … */
export function isAffirmativeReply(messageText: string): boolean {
    if (!messageText) return false;
    if (containsAnyToken(messageText, NEGATIVE_TOKENS)) return false;
    if (containsAnyToken(messageText, AFFIRMATIVE_TOKENS)) return true;
    return CONFIRM_VERB_PATTERNS.some(p => p.test(messageText));
}

/**
 * Permissive negative detection ("لا", "لا شكرا", "nope", …).
 * Used when the customer declines an upsell / "anything else?" while still finalizing the order.
 */
export function isNegativeReply(messageText: string): boolean {
    if (!messageText) return false;
    if (containsAnyToken(messageText, AFFIRMATIVE_TOKENS)) return false;
    return containsAnyToken(messageText, NEGATIVE_TOKENS);
}

/**
 * True when an assistant text is still *asking* the customer to confirm
 * (e.g. "جاهز للتأكيد. هل ترغب في تأكيد الطلب؟" / "Would you like to confirm…?")
 * — as opposed to actually announcing the confirmation ("تم تأكيد طلبك" / "order confirmed").
 */
export function botReplyAsksForConfirmation(text: string): boolean {
    if (!text) return false;
    const normalized = normalizeArabic(text);

    // If it's already an *announcement* of confirmation, it is NOT a question.
    if (/تم\s+(تاكيد|تأكيد|تأكيدُ)\s+(طلبك|الطلب)/.test(normalized)) return false;
    if (/تأكدنا|تم\s+تسجيل\s+طلبك/.test(normalized)) return false;
    if (/order\s+(has\s+been\s+)?confirmed|order\s+placed|order\s+received/i.test(text)) return false;

    // Arabic question cues
    if (/جاهز\s*(ة)?\s*(للتاكيد|للتأكيد)/.test(text)) return true;
    if (/(هل\s+(ترغب|تريد|تود)|تحب).{0,20}(تاكيد|تأكيد)/.test(normalized)) return true;
    if (/(هل\s+(ترغب|تريد|تود)).{0,15}(الطلب)/.test(normalized)) return true;
    if (/(تاكيد|تأكيد)\s+الطلب\??\s*$/.test(normalized)) return true;
    if (/اكد\s+الطلب\??\s*$/.test(normalized)) return true;

    // English question cues
    if (/confirm\s+(your\s+|the\s+)?order\s*\??/i.test(text) && /\?/.test(text)) return true;
    if (/would\s+you\s+like\s+to\s+(confirm|place)/i.test(text)) return true;
    if (/shall\s+i\s+(confirm|place)/i.test(text)) return true;

    return false;
}

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
 * This replaces processWithFullAI in the smart pipeline
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
        messagePreview: messageText.substring(0, 50),
        language
    });

    // ==================== STEP 1: Product Search ====================
    let products: Product[] = [];
    let activeProductId: string | null = conversationState.last_recommended_products?.[0] || null;
    const isCatalogExplore = isCatalogExploreRequest(messageText);
    const wantsOtherProducts =
        isCatalogExplore ||
        /(بدل|غيره|منتج آخر|منتجات أخرى|something else|another product|other products)/i.test(
            messageText
        );

    // Strategy -1: seeded product from ad/post/comment acquisition (recommended start, not exclusive)
    const seededProductId = conversationState.extracted_entities?.product_id;
    if (seededProductId && !wantsOtherProducts) {
        const seeded = await getProductById(merchantId, seededProductId);
        if (seeded) {
            products = [seeded];
            activeProductId = seeded.id;
            console.log('🎯 SalesGPT: Using acquisition-seeded product:', seeded.name);
        }
    }

    // Strategy 0: explicit entity query has highest priority
    if (conversationState.extracted_entities?.product_query) {
        products = await searchProducts(merchantId, conversationState.extracted_entities.product_query, undefined, 5);
    }

    // Strategy 1: Smart keyword extraction from current message
    if (products.length === 0 || wantsOtherProducts) {
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

    // Strategy 2: From conversation history only when user is NOT exploring catalog
    if (products.length === 0 && !isCatalogExplore && conversationState.last_recommended_products?.[0]) {
        const productId = conversationState.last_recommended_products[0];
        const product = await getProductById(merchantId, productId);
        if (product) {
            products = [product];
            activeProductId = product.id;
            console.log('📦 SalesGPT: Retrieved product from history:', product.name);
        }
    }

    // Strategy 3: Browse requests fallback
    const isImageRequest = SALESGPT_IMAGE_REQUEST_RE.test(messageText);
    const explicitBrowse =
        messageText.includes('شو') || messageText.includes('ماذا') ||
        messageText.includes('what') || messageText.includes('عندك') ||
        messageText.includes('متوفر');
    if (products.length === 0 && !isImageRequest && (isCatalogExplore || explicitBrowse)) {
        products = await getTopProducts(merchantId, 5);
        if (products[0]) activeProductId = products[0].id;
    }

    // Always attach compact catalog awareness for SaaS stores.
    // This keeps the agent aware of alternatives without flooding tokens.
    const [catalogOverview, catalogMeta] = await Promise.all([
        getProductsOverview(merchantId, 30),
        getCatalogMeta(merchantId)
    ]);
    const catalogAwareness: CatalogAwareness = {
        overview: catalogOverview,
        meta: catalogMeta,
        activeProductId,
        isExploring: isCatalogExplore
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
    // Closing/order-collection stages (or legacy text cue) + yes OR "no more additions"
    // with complete fields → emit confirm_order locally (0 AI calls).
    // Stage id is primary: AI closing questions drift ("قبل ما أكمل الطلب؟") and break text-regex.
    const stageId = conversationState.salesgpt_stage_id?.trim();
    const wasInClosingFlow =
        (!!stageId && ['6', '7', '8'].includes(stageId)) ||
        lastBotMessageAsksForConfirmation(recentMessages);
    const userSaidYes = isAffirmativeReply(messageText);
    const userSaidNo = isNegativeReply(messageText);
    const completeness = checkOrderCompleteness(conversationState, products[0]);

    // Affirmative confirm OR decline of upsell/"anything else?" while order is complete → finalize.
    if (wasInClosingFlow && completeness.complete && (userSaidYes || userSaidNo)) {
        const e = conversationState.extracted_entities || {};
        const productName = products[0]?.name || e.product_query || '';
        const thankMsg = language === 'arabic'
            ? `تم تأكيد طلبك ${e.name ? `يا ${e.name}` : ''} 🎉 رح نتواصل معك قريباً لترتيب التوصيل.`
            : `Your order has been confirmed${e.name ? `, ${e.name}` : ''}! 🎉 We'll contact you shortly to arrange delivery.`;

        logger.info('⚡ SalesGPT: deterministic confirm_order fast-path', {
            merchantId,
            product: productName,
            missing: completeness.missing,
            trigger: userSaidYes ? 'affirmative' : 'negative_no_more_additions',
            stageId: stageId || null
        });
        console.log('⚡ SalesGPT: confirm_order fast-path engaged', {
            userMessage: messageText.substring(0, 60),
            trigger: userSaidYes ? 'yes' : 'no',
            name: e.name,
            phone: e.phone,
            address: e.address
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
            nextAction: 'confirm_order',
            aiCallsCount: 0
        };

        // short-circuit
        const updatedStateFast: ConversationState = {
            ...conversationState,
            last_intent: 'order',
            current_stage: 'close',
            salesgpt_stage_id: '8',
            language,
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
            next_action: 'confirm_order'
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

    // Attach images only on explicit customer request (or AI send_image already gated in agent).
    const shouldAttachImage =
        isImageRequest || salesResult.nextAction === 'send_image';

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
                captionPreview: caption.substring(0, 80)
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
    const updatedState: ConversationState = {
        ...conversationState,
        last_intent: salesResult.intent,
        current_stage: salesResult.stage,
        salesgpt_stage_id: salesResult.stageId,
        language,
        last_order: isReturningAfterOrder ? undefined : conversationState.last_order,
        extracted_entities: {
            ...(conversationState.extracted_entities || {}),
            product_query: salesResult.collectedInfo.product_name || conversationState.extracted_entities?.product_query,
            color: salesResult.collectedInfo.color || conversationState.extracted_entities?.color,
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
    const processingTime = Date.now() - startTime;

    logger.info('🧠 SalesGPT pipeline completed', {
        merchantId,
        intent: salesResult.intent,
        stage: salesResult.stage,
        stageId: salesResult.stageId,
        nextAction: salesResult.nextAction,
        aiCallsCount: salesResult.aiCallsCount,
        processingTimeMs: processingTime
    });

    console.log('✅ SalesGPT decision:', {
        intent: salesResult.intent,
        stage: salesResult.stage,
        stageId: salesResult.stageId,
        nextAction: salesResult.nextAction,
        collectedInfo: salesResult.collectedInfo,
        aiCalls: salesResult.aiCallsCount
    });

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
            nextAction: (salesResult.nextAction === 'confirm_order' ? 'confirm_order' : 'recommend_products') as NextAction,
            oneQuestion: salesResult.responseText,
            ctaType: (salesResult.nextAction === 'confirm_order' ? 'confirm' : 'choose') as CtaType,
            recommendationStrategy: 'match_query' as RecommendationStrategy,
            shouldOfferDiscount: false,
            handoffReason: ''
        },
        updatedState,
        aiCallsCount: salesResult.aiCallsCount,
        language,
        next_action: salesResult.nextAction
    };
};

// ==================== EXPORTS ====================

export { SalesGPTAgent } from './agent.js';
export type { SalesGPTConfig, SalesGPTResult } from './agent.js';
export { CONVERSATION_STAGES, getStageDescription, mapStageIdToStage } from './stages.js';
export { getSalesGPTTools, executeTool } from './tools.js';
export { buildSalesGPTSystemPrompt } from './prompts.js';
