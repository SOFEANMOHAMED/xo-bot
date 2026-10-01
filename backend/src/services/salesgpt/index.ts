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
    isColorInProductCatalog,
    buildUnavailableColorMessage,
    buildAskColorMessage,
} from './orderColorPolicy.js';
import type {
    Message,
    ConversationState,
    Product,
    Language,
    MerchantConfig,
    Intent,
    Stage,
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
    resolveConfirmFinalize,
    AWAIT_CONFIRMATION_ACTION,
    CONFIRM_ORDER_ACTION,
    shouldAppendOrderData
} from './orderConfirmationPolicy.js';
import {
    violatesNoMatchGrounding,
    buildNoMatchFallbackMessage,
    validateCatalogReplyGrounding,
    sanitizeUngroundedColorClaims,
} from './catalogGrounding.js';
import { detectsWantsAlternativesIntent } from './customerRequest.js';
import { resolvePhotoDecision } from './turnIntent.js';
import {
    isExplicitProductInterestAsk,
    recordExplicitProductInterest,
} from '../abandonedCheckout/productInterestAsk.js';
import { logReplyOwnership } from './replyOwnership.js';
import {
    buildCartEmptiedMessage,
    buildLineNotFoundMessage,
    buildLineRemovedMessage,
    buildPendingSelectMessage,
} from './replyPolicy.js';
import {
    applySalesGPTStage,
    conversationStageForDb,
    FRESH_CONVERSATION_STAGE_ID,
} from './conversationStateSync.js';
import { matchFaqForTurn } from './faqMatcher.js';
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
    replaceCartItems,
    shouldSyncMultiProductCart,
    updateCartLineById,
} from './conversationCart.js';
import { resolveQuantity } from './arabicQuantityWords.js';
import {
  classifyInterimCancelIntent,
  isInterimPartialRemoveVerb,
} from './interimCancelMatchers.js';
import { matchCartLinesForProductNegation } from './cartLineRemoval.js';
import {
    applyPendingToState,
    bindPendingBotQuestion,
    clearPendingBotQuestion,
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
} from './resolveFocus.js';
import {
    axisById,
    buildAskVariantMessage,
    missingAxes,
    setLineVariant,
} from './variantEngine/index.js';
import {
    buildInterpreterCandidates,
    groundInterpreterReply,
    effectiveNextActionFromTurnFacts,
    runInterpreterTurn,
    type InterpreterActionType,
    type InterpreterApplyResult,
} from './interpreter/index.js';
import {
    applyImageDecision,
    finalizeOutboundReply,
    gateConfirmWhenColorInvalid,
    resolveBareSizeFromMessage,
    resolveProductOrderColor,
    resolveTurnFocus,
    scrubInvalidProductColorState,
    variantSelectionForProduct,
} from './pipelineSteps/index.js';

// Re-export confirmation helpers so channel controllers keep a stable import path
export {
    customerAffirmsOrder,
    customerDeclinesMoreItems,
    customerCancelsOrder,
    botReplyAsksForConfirmation,
    botReplyAsksToAddMore,
    isProductInfoRequest,
    shouldAppendOrderData,
    resolveConfirmFinalize,
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
    updatedState: ConversationState;
    aiCallsCount: number;
    language: Language;
    next_action?: string;
}

// ==================== LANGUAGE DETECTION ====================

function ownReply(
    phase: Parameters<typeof logReplyOwnership>[0]['phase'],
    reason: string,
    nextAction: string | undefined,
    replyText: string
): string {
    logReplyOwnership({ phase, reason, nextAction, replyText });
    return replyText;
}

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

// Image URL + color/size helpers live in ./pipelineSteps/

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
    const focus = await resolveTurnFocus({
        merchantId,
        messageText,
        recentMessages,
        conversationState,
    });
    let products = focus.products;
    let activeProductId = focus.activeProductId;
    const focusSource = focus.focusSource;
    const catalogForMention = focus.catalogForMention;
    const namedInMessage = focus.namedInMessage;
    const mentionedInMessage = focus.mentionedInMessage;
    const asksForPhoto = focus.asksForPhoto;
    const pendingKindEarly = focus.pendingKindEarly;
    const pendingProductIdEarly = focus.pendingProductIdEarly;
    const catalogAwareness = focus.catalogAwareness;
    const noMatchForSpecificQuery = focus.noMatchForSpecificQuery;
    const catalogOverview = catalogAwareness.overview;

    const interpreterSkip = new Set<InterpreterActionType>();
    let interpreterApplied: InterpreterApplyResult | null = null;
    const cartItemsBeforeInterpreter = getCartItems(conversationState).map(ensureLineId);
    {
        const built = await buildInterpreterCandidates({
            merchantId,
            message: messageText,
            recentMessages,
            conversationState,
            catalog: catalogForMention,
            focusProductId: activeProductId,
            mentioned: namedInMessage,
            pendingKind: pendingKindEarly,
            pendingProductId: pendingProductIdEarly,
        });
        const turn = await runInterpreterTurn({
            input: built.input,
            state: conversationState,
            productsById: built.productsById,
            storeCurrency: merchantConfig.storeCurrency || merchantConfig.currency,
        });
        interpreterApplied = turn.applied;
        for (const type of turn.skippedOldTypes) interpreterSkip.add(type);
        if (turn.applied) {
            conversationState = turn.applied.state;

            // Focus priority:
            //   1) product named in this customer message
            //   2) post-linked / seed (already in resolveTurnFocus)
            //   3) interpreter explicit set_focus / add_product / ask_product_info+productId
            // Never let a stale inherited interpreter focusProductId yank focus
            // away from a product the customer just named.
            const messageProduct = namedInMessage[0] || null;
            const interpreterWantsFocus =
                !!turn.applied.focusProductId &&
                !noMatchForSpecificQuery &&
                turn.applied.focusExplicitlyChanged;

            if (messageProduct) {
                products = [messageProduct];
                activeProductId = messageProduct.id;
                catalogAwareness.activeProductId = messageProduct.id;
                conversationState = {
                    ...conversationState,
                    extracted_entities: {
                        ...(conversationState.extracted_entities || {}),
                        product_id: messageProduct.id,
                        product_query: messageProduct.name,
                    },
                };
                if (
                    interpreterWantsFocus &&
                    turn.applied.focusProductId !== messageProduct.id
                ) {
                    logger.info('SalesGPT: message product beats interpreter focus', {
                        merchantId,
                        messageProductId: messageProduct.id,
                        interpreterFocusId: turn.applied.focusProductId,
                        focusSource,
                    });
                }
            } else if (interpreterWantsFocus && turn.applied.focusProductId) {
                const focusedProduct = built.productsById.get(turn.applied.focusProductId);
                if (focusedProduct) {
                    products = [focusedProduct];
                    activeProductId = focusedProduct.id;
                    catalogAwareness.activeProductId = focusedProduct.id;
                }
            }
        }
    }

    // Interpreter-owned cancel — short-circuit (old interim cancelled rail skipped).
    if (interpreterApplied?.applied.includes('cancel_order')) {
        const reply = ownReply(
            'early_rail',
            'interpreter_cancel',
            'end_conversation',
            buildOrderCancelledMessage(language)
        );
        const updatedCancel: ConversationState = {
            ...conversationState,
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
            updatedState: updatedCancel,
            aiCallsCount: 0,
            language,
            next_action: 'end_conversation',
        };
    }

    // Interpreter-owned remove_line — templates that used to live in the INTERIM rail.
    // Product negation («مو الساعة» / «ما بدي الساعة») while also requesting another
    // product must update the cart and continue — not short-circuit the turn.
    if (interpreterApplied?.applied.includes('remove_line')) {
        const negatedBefore = matchCartLinesForProductNegation(
            messageText,
            cartItemsBeforeInterpreter
        );
        const wasProductNegation =
            negatedBefore.length > 0 && !isInterimPartialRemoveVerb(messageText);
        const wantedOtherProduct = [...namedInMessage, ...mentionedInMessage].some(
            (p) => !negatedBefore.some((n) => n.productId === p.id)
        );
        if (wasProductNegation && wantedOtherProduct) {
            const wanted =
                namedInMessage.find(
                    (p) => !negatedBefore.some((n) => n.productId === p.id)
                ) ||
                mentionedInMessage.find(
                    (p) => !negatedBefore.some((n) => n.productId === p.id)
                );
            if (wanted) {
                products = [wanted];
                activeProductId = wanted.id;
                catalogAwareness.activeProductId = wanted.id;
                conversationState = {
                    ...conversationState,
                    extracted_entities: {
                        ...(conversationState.extracted_entities || {}),
                        product_id: wanted.id,
                        product_query: wanted.name,
                    },
                    last_recommended_products: [
                        wanted.id,
                        ...(conversationState.last_recommended_products || []).filter(
                            (id) => id !== wanted.id
                        ),
                    ],
                };
            }
            // Fall through — cart already updated by interpreter apply.
        } else {
        const afterIds = new Set(
            getCartItems(conversationState).map((row) => ensureLineId(row).lineId)
        );
        const removed = cartItemsBeforeInterpreter.filter(
            (row) => row.lineId && !afterIds.has(row.lineId)
        );
        const remaining = getCartItems(conversationState).map(ensureLineId);
        if (remaining.length === 0) {
            const reply = ownReply(
                'early_rail',
                'interpreter_cart_empty',
                'present_product',
                buildCartEmptiedMessage(language)
            );
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
                updatedState: updatedEmpty,
                aiCallsCount: 0,
                language,
                next_action: 'present_product',
            };
        }
        const cart = normalizeCart(
            { items: remaining, status: 'building' },
            { storeCurrency: merchantConfig.storeCurrency || merchantConfig.currency }
        );
        const summary = formatCartSummary(cart.items, language, {
            shippingPolicy: merchantConfig.shippingPolicy,
        });
        const removedNames = removed.map((m) => m.productName).join('، ') || (
            language === 'arabic' ? 'المنتج' : 'the item'
        );
        const reply = ownReply(
            'early_rail',
            'interpreter_cart_remove',
            ADD_TO_CART_ACTION,
            buildLineRemovedMessage({
                language,
                removedNames,
                cartSummary: summary,
            })
        );
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
            updatedState: updatedPartial,
            aiCallsCount: 0,
            language,
            next_action: ADD_TO_CART_ACTION,
        };
        }
    }

    // Partial-remove with no matching cart line (whitelist ask_clarification sentinel).
    if (
        interpreterApplied?.applied.includes('ask_clarification') &&
        interpreterApplied.clarification &&
        classifyInterimCancelIntent(messageText) === 'partial_remove'
    ) {
        const reply = ownReply(
            'early_rail',
            'interpreter_line_not_found',
            'present_product',
            buildLineNotFoundMessage(language)
        );
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
            updatedState: updatedMiss,
            aiCallsCount: 0,
            language,
            next_action: 'present_product',
        };
    }

    // Interpreter-owned pending color/size select — priced summary (old pending rail).
    if (
        interpreterApplied?.applied.includes('select_color') ||
        interpreterApplied?.applied.includes('select_size')
    ) {
        const focusId =
            interpreterApplied.focusProductId ||
            conversationState.extracted_entities?.product_id ||
            products[0]?.id ||
            null;
        const pendingProduct =
            (focusId
                ? catalogForMention.find((p) => p.id === focusId) ||
                  products.find((p) => p.id === focusId)
                : null) || null;
        if (pendingProduct && isSellableProduct(pendingProduct)) {
            const cart = normalizeCart(conversationState.cart, {
                storeCurrency: merchantConfig.storeCurrency || merchantConfig.currency,
            });
            const summary = formatCartSummary(cart.items, language, {
                shippingPolicy: merchantConfig.shippingPolicy,
            });
            const e = conversationState.extracted_entities || {};
            const reply = ownReply(
                'early_rail',
                'interpreter_pending_select',
                'present_product',
                buildPendingSelectMessage({
                    language,
                    productName: pendingProduct.name,
                    color: e.color,
                    size: e.size,
                    cartSummary: summary,
                })
            );
            const updatedSelect: ConversationState = applyPendingToState(
                {
                    ...conversationState,
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
                updatedState: updatedSelect,
                aiCallsCount: 0,
                language,
                next_action: 'present_product',
            };
        }
    }

    // ==================== STEP 2: Create & Run SalesGPT Agent ====================
    // Drop stale colors from prior experiments that are not on this product's catalog.
    conversationState = scrubInvalidProductColorState(conversationState, products[0]);

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

        logger.info('SalesGPT: Returning customer after confirmed order', {
            orderId: lastOrder.orderId,
            productName: lastOrder.productName,
        });
    } else {
        agent.restoreState(recentMessages, conversationState);
    }

    agent.humanStep(messageText);

    let salesResult: SalesGPTResult | undefined;
    const skipAgent = Boolean(interpreterApplied?.handoffHuman);
    if (skipAgent) {
        salesResult = {
            responseText:
                language === 'arabic'
                    ? 'حاضر، رح أحولك لموظف.\n<ESCALATE>'
                    : 'Sure — I will connect you with a teammate.\n<ESCALATE>',
            stageId: '9',
            stageName: 'Close',
            intent: 'complaint',
            stage: 'handoff',
            collectedInfo: {},
            nextAction: 'end_conversation',
            aiCallsCount: 0,
        };
    }

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
    const userAffirms = Boolean(interpreterApplied?.affirmsOrder)
        ? true
        : customerAffirmsOrder(messageText);
    const userDeclinesMore = Boolean(interpreterApplied?.deniesOrder)
        ? true
        : customerDeclinesMoreItems(messageText);
    const completeness = checkOrderCompleteness(conversationState, products[0]);

    // Affirmative confirm OR decline of upsell/"anything else?" while order is complete → finalize.
    // Never finalize when the customer is asking for product details (e.g. "تمام، معلومات أكثر؟").
    const askingProductInfo =
        interpreterSkip.has('ask_product_info') || isProductInfoRequest(messageText);
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

    // ——— Variant correction BEFORE pending (any axis via variantEngine) ———
    // Skip when interpreter already applied select_color / select_size.
    // correct_variant alone does not skip: if the LLM only filled color on a
    // size correction, the engine can still write size onto the cart line.
    if (
        !interpreterSkip.has('ask_product_info') &&
        !interpreterSkip.has('select_color') &&
        !interpreterSkip.has('select_size')
    ) {
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
            let nextItems = liveItems.map((row) =>
                row.lineId === variant.lineId
                    ? setLineVariant(row, variant.axisId, variant.value)
                    : row
            );
            if (variant.axisId === 'color') {
                nextItems = updateCartLineById(nextItems, variant.lineId, {
                    color: variant.value,
                }).map(ensureLineId);
            } else if (variant.axisId === 'size') {
                nextItems = updateCartLineById(nextItems, variant.lineId, {
                    size: variant.value,
                }).map(ensureLineId);
            } else {
                nextItems = nextItems.map(ensureLineId);
            }
            const cart = normalizeCart(
                { items: nextItems, status: 'building' },
                { storeCurrency: merchantConfig.storeCurrency || merchantConfig.currency }
            );
            const reply = buildVariantUpdatedMessage(
                language === 'english' ? 'english' : 'arabic',
                variant.value,
                variant.productName,
                cart.items,
                {
                    shippingPolicy: merchantConfig.shippingPolicy,
                    axisId: variant.axisId,
                }
            );
            const entityPatch: Record<string, string> = {
                product_id: variant.productId,
            };
            if (variant.axisId === 'color') entityPatch.color = variant.value;
            if (variant.axisId === 'size') entityPatch.size = variant.value;
            const wasAwaiting = Boolean(conversationState.awaiting_order_confirmation);
            const updatedVariant: ConversationState = applyPendingToState(
                {
                    ...conversationState,
                    cart,
                    extracted_entities: {
                        ...(conversationState.extracted_entities || {}),
                        ...entityPatch,
                    },
                    language,
                    awaiting_order_confirmation: wasAwaiting,
                    last_interaction: new Date().toISOString(),
                    message_count: (conversationState.message_count || 0) + 1,
                },
                clearPendingBotQuestion()
            );
            // If checkout was ready, keep confirmation flow with refreshed summary.
            const stillReady = checkOrderCompleteness(
                updatedVariant,
                productPool.find((p) => p.id === variant.productId) || products[0]
            ).complete;
            let finalReply = reply;
            let nextActionOut: string = 'collect_info';
            if (wasAwaiting && stillReady) {
                const e = updatedVariant.extracted_entities || {};
                finalReply = buildAwaitConfirmationMessage(language, {
                    name: e.name,
                    phone: e.phone,
                    address: e.address,
                    product_name: variant.productName || e.product_query,
                    color: cart.items[0]?.color || e.color,
                    size: cart.items[0]?.size || e.size,
                    quantity: cart.items[0]?.quantity || e.quantity,
                }, formatCartSummary(cart.items, language, {
                    shippingPolicy: merchantConfig.shippingPolicy,
                }));
                updatedVariant.awaiting_order_confirmation = true;
                nextActionOut = AWAIT_CONFIRMATION_ACTION;
                applySalesGPTStage(updatedVariant, '8');
            } else {
                applySalesGPTStage(updatedVariant, '7');
            }
            return {
                replyText: finalReply,
                intent: 'order' as Intent,
                stage: 'close' as Stage,
                entities: updatedVariant.extracted_entities || {},
                missingFields: [],
                products: productPool.filter((p) => p.id === variant.productId),
                updatedState: updatedVariant,
                aiCallsCount: 0,
                language,
                next_action: nextActionOut,
            };
        }

        if (variant.kind === 'unchanged') {
            const reply = buildVariantUnchangedMessage(
                language === 'english' ? 'english' : 'arabic',
                variant.value,
                variant.productName,
                variant.axisId
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
                updatedState: updatedBad,
                aiCallsCount: 0,
                language,
                next_action: 'collect_info',
            };
        }

        if (variant.kind === 'ask_which') {
            const reply = buildAskWhichLineMessage(
                language === 'english' ? 'english' : 'arabic',
                variant.productName,
                variant.axisId
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
                updatedState: updatedAsk,
                aiCallsCount: 0,
                language,
                next_action: 'collect_info',
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

        // Named product needs a variant — ask via existing ask_variant templates.
        // Never echo a stale cart line as a fake "added" confirmation.
        if (!lockedItem && products[0] && !draftReady) {
            const draftMissing = isDraftLineComplete(draftEntities, products[0]).missing;
            const lang = language === 'english' ? 'english' : 'arabic';
            let askText = '';
            if (draftMissing.includes('color') && products[0].colors?.length) {
                askText = buildAskColorMessage(lang, products[0].colors);
            } else if (draftMissing.includes('size')) {
                const sizeAxis = axisById(products[0], 'size');
                if (sizeAxis) askText = buildAskVariantMessage(lang, sizeAxis);
            }
            if (askText) {
                let updatedAsk: ConversationState = {
                    ...stateForAdd,
                    last_intent: 'browse',
                    language,
                    awaiting_order_confirmation: false,
                    last_order: isReturningAfterOrder
                        ? undefined
                        : conversationState.last_order,
                    last_interaction: new Date().toISOString(),
                    message_count: (conversationState.message_count || 0) + 1,
                    last_recommended_products: [products[0].id],
                };
                applySalesGPTStage(updatedAsk, '4');
                updatedAsk = applyPendingToState(
                    updatedAsk,
                    bindPendingBotQuestion(askText, updatedAsk, products[0])
                );
                logger.info('🛒 SalesGPT: add-another needs variant', {
                    merchantId,
                    product: products[0].name,
                    missing: draftMissing,
                });
                return {
                    replyText: askText,
                    intent: 'browse' as Intent,
                    stage: 'offer' as Stage,
                    entities: updatedAsk.extracted_entities || {},
                    missingFields: draftMissing,
                    products: [products[0]],
                    updatedState: updatedAsk,
                    aiCallsCount: 0,
                    language,
                    next_action: 'collect_info',
                };
            }
        }

        if (lockedItem) {
            const cart = normalizeCart(stateForAdd.cart, { storeCurrency });
            const thankAdd = buildAddedToCartMessage(language, lockedItem, cart);
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
                product: lockedItem.productName,
                cartSize: getCartItems(updatedStateAdd).length,
            });

            return {
                replyText: thankAdd,
                intent: 'browse' as Intent,
                stage: 'offer' as Stage,
                entities: updatedStateAdd.extracted_entities || {},
                missingFields: [],
                products: [],
                updatedState: updatedStateAdd,
                aiCallsCount: 0,
                language,
                next_action: ADD_TO_CART_ACTION,
            };
        }

        // Bare "add another" with no new SKU locked — confirm current cart only when
        // the focused product is already the last cart line (or no new focus).
        if (cartHasItems(stateForAdd)) {
            const cart = normalizeCart(stateForAdd.cart, { storeCurrency });
            const displayItem = cart.items[cart.items.length - 1]!;
            const focusIsNewSku =
                !!products[0] && products[0].id !== displayItem.productId;
            if (!focusIsNewSku) {
                const thankAdd = buildAddedToCartMessage(language, displayItem, cart);
                const updatedStateAdd: ConversationState = {
                    ...stateForAdd,
                    cart,
                    last_intent: 'browse',
                    language,
                    awaiting_order_confirmation: false,
                    last_order: isReturningAfterOrder
                        ? undefined
                        : conversationState.last_order,
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
                    updatedState: updatedStateAdd,
                    aiCallsCount: 0,
                    language,
                    next_action: ADD_TO_CART_ACTION,
                };
            }
        }
    }

    const confirmFinalize = resolveConfirmFinalize({
        effectivelyComplete: completeness.complete,
        fieldsWereCompleteBeforeTurn: completeness.complete,
        botAskedConfirm: wasInClosingFlow || botAskedConfirm,
        botAskedAddMore,
        userAffirms,
        userDeclinesMore,
        askingProductInfo,
        addAnotherIntent,
        colorReady: fastPathColorReady,
        variantsReady: products[0]
            ? missingAxes(
                  products[0],
                  variantSelectionForProduct(conversationState, products[0])
              ).length === 0
            : true,
    });

    if (confirmFinalize.finalize) {
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

        logger.info('SalesGPT: deterministic confirm_order fast-path', {
            merchantId,
            product: productName,
            cartItems: cartItems.length,
            missing: completeness.missing,
            trigger: confirmFinalize.reason,
            stageId: stageId || null,
            messageLength: messageText.length,
            hasName: Boolean(e.name),
            hasPhone: Boolean(e.phone),
            hasAddress: Boolean(e.address),
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
        if (!skipAgent) {
        const faqMatch = await matchFaqForTurn({ merchantId, messageText, recentMessages });
        if (faqMatch) {
            const reply = ownReply('early_rail', 'faq_match', undefined, faqMatch.answer);
            const updatedFaqState: ConversationState = {
                ...conversationState,
                language,
                last_interaction: new Date().toISOString(),
                message_count: (conversationState.message_count || 0) + 1,
            };
            logger.info('SalesGPT: FAQ match fast-path', {
                merchantId,
                faqId: faqMatch.id,
            });
            return {
                replyText: reply,
                intent: 'other' as Intent,
                stage: conversationStageForDb(updatedFaqState),
                entities: updatedFaqState.extracted_entities || {},
                missingFields: [],
                products,
                updatedState: updatedFaqState,
                aiCallsCount: 0,
                language,
            };
        }
        salesResult = await agent.step(messageText, products, catalogAwareness);
        ownReply(
            'agent_draft',
            'agent_step',
            salesResult.nextAction,
            salesResult.responseText
        );
        // Model may re-emit a stale color from history; drop it when not on catalog.
        if (
            salesResult.collectedInfo?.color &&
            products[0] &&
            !(
                products[0].colors?.length &&
                isColorInProductCatalog(salesResult.collectedInfo.color, products[0].colors)
            )
        ) {
            salesResult.collectedInfo = {
                ...salesResult.collectedInfo,
                color: undefined,
            };
        }
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
            const conversationColors = [
                conversationState.extracted_entities?.color,
                ...getCartItems(conversationState).map((item) => item.color),
                salesResult.collectedInfo?.color,
            ].filter((color): color is string => Boolean(color && String(color).trim()));

            const groundingInput = {
                responseText: salesResult.responseText,
                products,
                customerMessage: messageText,
                conversationColors,
                catalogOverview,
            };
            const grounding = validateCatalogReplyGrounding(groundingInput);
            if (!grounding.valid) {
                const storeCurrency =
                    merchantConfig.storeCurrency || merchantConfig.currency || null;
                // Prefer surgical color strip so price/currency/tone survive.
                if (grounding.reasons.includes('ungrounded_color')) {
                    const repaired = sanitizeUngroundedColorClaims(
                        salesResult.responseText,
                        {
                            products,
                            customerMessage: messageText,
                            conversationColors,
                            catalogOverview,
                        }
                    );
                    const recheck = validateCatalogReplyGrounding({
                        ...groundingInput,
                        responseText: repaired.text,
                    });
                    if (recheck.valid && repaired.text.trim().length > 0) {
                        logger.warn('SalesGPT: stripped ungrounded color claims from reply', {
                            merchantId,
                            stripped: repaired.stripped,
                            reasons: grounding.reasons,
                        });
                        salesResult.responseText = repaired.text;
                    } else {
                        logger.warn('SalesGPT: replaced reply with ungrounded catalog claims', {
                            merchantId,
                            reasons: grounding.reasons,
                        });
                        salesResult.responseText = buildGroundedCatalogFallback(
                            products,
                            language === 'english' ? 'english' : 'arabic',
                            storeCurrency
                        );
                    }
                } else {
                    logger.warn('SalesGPT: replaced reply with ungrounded catalog claims', {
                        merchantId,
                        reasons: grounding.reasons,
                    });
                    salesResult.responseText = buildGroundedCatalogFallback(
                        products,
                        language === 'english' ? 'english' : 'arabic',
                        storeCurrency
                    );
                }
            }
        }
        }
    } catch (error) {
        logger.error('SalesGPT agent failed', error as Error, { merchantId });

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
    if (!salesResult) {
        throw new Error('SalesGPT: salesResult missing after agent turn');
    }
    if (interpreterApplied) {
        const focusForFacts = products[0];
        const selectionForFacts = focusForFacts
            ? variantSelectionForProduct(conversationState, focusForFacts)
            : {};
        const missingVariantAxes = focusForFacts
            ? missingAxes(focusForFacts, selectionForFacts).length > 0
            : false;
        salesResult.nextAction = effectiveNextActionFromTurnFacts(
            {
                applied: interpreterApplied.applied,
                handoffHuman: interpreterApplied.handoffHuman,
                wantsPhoto: interpreterApplied.wantsPhoto,
                refusesPhoto: interpreterApplied.refusesPhoto,
                affirmsOrder: interpreterApplied.affirmsOrder,
                deniesOrder: interpreterApplied.deniesOrder,
                browseCatalog: interpreterApplied.browseCatalog,
                infoKind: interpreterApplied.infoKind,
                clarification: interpreterApplied.clarification,
                checkoutReady: checkOrderCompleteness(conversationState, products[0]).complete,
                missingVariantAxes,
                cartEmpty: getCartItems(conversationState).length === 0,
                finalizedOrder: salesResult.nextAction === CONFIRM_ORDER_ACTION,
            },
            salesResult.nextAction
        );
    }
    let finalReplyText = salesResult.responseText;

    // Attach images ONLY when resolvePhotoDecision says so (interpreter owns when flipped).
    const photoDecision = resolvePhotoDecision({
        messageText,
        interpreterOwnsRefuse: interpreterSkip.has('refuse_photo'),
        interpreterOwnsRequest: interpreterSkip.has('request_photo'),
        interpreterRefusesPhoto: Boolean(interpreterApplied?.refusesPhoto),
        interpreterWantsPhoto: interpreterApplied?.wantsPhoto,
    });
    const shouldAttachImage = photoDecision.attachImage;
    {
        const imaged = await applyImageDecision({
            merchantId,
            messageText,
            language,
            shouldAttachImage,
            noMatchForSpecificQuery: Boolean(catalogAwareness.noMatchForSpecificQuery),
            responseText: salesResult.responseText,
            collectedProductName: salesResult.collectedInfo.product_name,
            collectedColor: salesResult.collectedInfo.color,
            storedColor: conversationState.extracted_entities?.color,
            collectedSize: salesResult.collectedInfo.size,
            storedSize: conversationState.extracted_entities?.size,
            activeProductId,
            products,
            mentionedInMessage,
            catalogForMention,
        });
        finalReplyText = imaged.replyText;
        products = imaged.products;
        activeProductId = imaged.activeProductId;
    }

    const storeNameForGround = merchantConfig.storeName || merchantConfig.store_name || '';
    finalReplyText = groundInterpreterReply({
        replyText: finalReplyText,
        language,
        imageAttached: /\[IMAGE:/i.test(finalReplyText),
        noMatchForSpecificQuery: Boolean(catalogAwareness.noMatchForSpecificQuery),
        catalogOverview,
        salespersonName: storeNameForGround ? `مساعد ${storeNameForGround}` : 'مساعد المتجر',
        storeName: storeNameForGround,
        allowAlternatives: detectsWantsAlternativesIntent(messageText),
        activeProductNames: products.map((p) => p.name).filter(Boolean),
    });

    // ==================== STEP 4: Build Updated Conversation State ====================
    // Strict catalog-bound color — never on OOS products; user history beats AI.
    const focusProduct = products[0] && isSellableProduct(products[0]) ? products[0] : null;
    const skipVariantExtract = interpreterSkip.has('ask_product_info');
    const colorResolution = skipVariantExtract
        ? {
            color: conversationState.extracted_entities?.color ?? null,
            replyText: finalReplyText,
            policy: null,
        }
        : resolveProductOrderColor({
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
    } else {
        // Colorless SKU: drop inherited/AI color only. Never clear size here
        // (shirt/perfume size lives on a product with no colors).
        salesResult.collectedInfo.color = undefined;
    }
    const resolvedSizeFromMessage = skipVariantExtract
        ? null
        : resolveBareSizeFromMessage(focusProduct, messageText);
    if (resolvedSizeFromMessage) {
        salesResult.collectedInfo.size = resolvedSizeFromMessage;
    }

    const storeCurrency = merchantConfig.storeCurrency || merchantConfig.currency;
    // Drop previous SKU variants when catalog focus moved (e.g. watch → shirt).
    const focusedEntities = clearDraftOnFocusChange(
        conversationState.extracted_entities,
        products[0]
    );

    let updatedState: ConversationState = {
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
                // Model never writes quantity — interpreter set_quantity or resolveQuantity only.
                if (interpreterSkip.has('set_quantity')) {
                    return focusedEntities.quantity;
                }
                if (messageSignalsBothProducts(messageText)) return undefined;
                const focusName =
                    focusProduct?.name ||
                    sanitizeCollectedText(salesResult.collectedInfo.product_name) ||
                    sanitizeCollectedText(focusedEntities.product_query);
                if (focusName) {
                    const fromWords = resolveQuantity(messageText, focusName);
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

    // Arm per-product interest reminder only on explicit product Q&A (not ad-seed greetings).
    {
        const interestProduct =
            namedInMessage[0] ||
            mentionedInMessage[0] ||
            (products[0] && isSellableProduct(products[0]) ? products[0] : null);
        const explicitAsk =
            Boolean(interestProduct?.id) &&
            !noMatchForSpecificQuery &&
            (interpreterSkip.has('ask_product_info') ||
                isExplicitProductInterestAsk(messageText));
        if (explicitAsk && interestProduct?.id) {
            updatedState = recordExplicitProductInterest(updatedState, interestProduct.id);
        }
    }

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
        state: updatedState,
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
        checkOrderCompleteness(updatedState, focusProduct || undefined).complete;
    const modelWantsAdd =
        !affirmingCheckoutReady &&
        !shouldSyncMultiProductCart(messageText, mentionedInMessage) &&
        detectsAddAnotherIntent(messageText);
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
        } else if (
            !isDraftLineComplete(updatedState.extracted_entities, focusProduct).complete
        ) {
            const draftMissing = isDraftLineComplete(
                updatedState.extracted_entities,
                focusProduct
            ).missing;
            const lang = language === 'english' ? 'english' : 'arabic';
            let askText = '';
            if (draftMissing.includes('color') && focusProduct.colors?.length) {
                askText = buildAskColorMessage(lang, focusProduct.colors);
            } else if (draftMissing.includes('size')) {
                const sizeAxis = axisById(focusProduct, 'size');
                if (sizeAxis) askText = buildAskVariantMessage(lang, sizeAxis);
            }
            if (askText) {
                finalReplyText = askText;
                effectiveNextAction = 'collect_info';
                updatedState.awaiting_order_confirmation = false;
                updatedState.last_intent = 'browse';
                applySalesGPTStage(updatedState, '4');
            }
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
            // Await / variant / identity templates compose once below.
        }
    }

    if (effectiveNextAction === AWAIT_CONFIRMATION_ACTION) {
        applySalesGPTStage(updatedState, '8');
        updatedState.awaiting_order_confirmation = true;
    }
    if (effectiveNextAction === CONFIRM_ORDER_ACTION) {
        updatedState.awaiting_order_confirmation = false;
    }

    const finalized = finalizeOutboundReply({
        language,
        messageText,
        effectiveNextAction,
        replyText: finalReplyText,
        updatedState,
        focusProduct,
        turnIntent: salesResult.turnIntent,
        shippingPolicy: merchantConfig.shippingPolicy,
    });
    finalReplyText = finalized.replyText;
    effectiveNextAction = finalized.nextAction;
    updatedState = finalized.updatedState;
    const composed = finalized.composed;

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

    logger.debug('SalesGPT decision', {
        intent: salesResult.intent,
        stage: salesResult.stage,
        stageId: updatedState.salesgpt_stage_id || salesResult.stageId,
        nextAction: effectiveNextAction,
        hasProductName: Boolean(salesResult.collectedInfo.product_name),
        hasColor: Boolean(salesResult.collectedInfo.color),
        hasSize: Boolean(salesResult.collectedInfo.size),
        cartItems: getCartItems(updatedState).length,
        aiCalls: salesResult.aiCallsCount,
    });

    ownReply('final', composed.replySource, effectiveNextAction, finalReplyText);

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
  resolvePhotoDecision,
  resolveTurnIntent,
  type PhotoDecision,
  type TurnIntent,
} from './turnIntent.js';
