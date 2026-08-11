/**
 * SalesGPT Agent - Main controller for the Sales Bot Brain
 * TypeScript port of SalesGPT Python project, adapted for SaaS e-commerce
 * 
 * This is the CORE brain that replaces the old AI orchestrator.
 * It manages conversation stages, generates responses, and uses tools.
 */

import { generateJSON, trackAICall } from '../../ai/gemini-client.js';
import { getStageDescription, mapStageIdToStage } from './stages.js';
import {
    buildSalesGPTSystemPrompt,
    getSalesGPTPersonaMeta,
} from './prompts.js';
import { getSalesGPTTools, executeTool, type ToolContext, type SalesGPTTool } from './tools.js';
import {
    searchProducts,
    getTopProducts,
    getProductById,
    type ProductOverviewRow,
    type CatalogMetaSummary
} from '../../catalog/product-search.js';
import type {
    Message,
    ConversationState,
    Product,
    Language,
    MerchantConfig,
    Intent,
    Stage
} from '../../core/types.js';
import { logger } from '../../utils/logger.js';
import { getCurrencyDisplayName } from '../../utils/currencyDisplayName.js';
import { detectEscalationMarker, stripInternalControlMarkers } from '../../response/sanitize-reply.js';
import {
    isProductInfoRequest,
    resolveOrderNextAction,
    sanitizeProductDescriptionForPrompt
} from './orderConfirmationPolicy.js';
import {
    hasCustomerRequestBlock,
    normalizeCustomerRequest,
    type CustomerRequestSignals
} from './customerRequest.js';
import { formatColorOptionsForDisplay } from '../../catalog/color-options.js';

/** Values the sales-response model may return in JSON `next_action` */
const SALESGPT_MODEL_NEXT_ACTIONS = new Set([
  'greet',
  'discover_needs',
  'present_product',
  'handle_objection',
  'close_sale',
  'collect_info',
  'await_confirmation',
  'confirm_order',
  'send_image',
  'end_conversation'
]);

/**
 * Single source of truth: next_action → SalesGPT stage (1–9).
 * Stage is derived — never decided by a separate AI call.
 *
 * await_confirmation and confirm_order both map to stage 8, but only
 * confirm_order may persist ORDER_DATA (see orderConfirmationPolicy).
 */
const NEXT_ACTION_TO_STAGE_ID: Record<string, string> = {
  greet: '1',
  discover_needs: '2',
  present_product: '4',
  send_image: '4',
  handle_objection: '5',
  close_sale: '6',
  collect_info: '7',
  await_confirmation: '8',
  confirm_order: '8',
  end_conversation: '9'
};

/** @deprecated Prefer model customer_request.wants_photo — kept for channel/image helpers only. */
export const SALESGPT_IMAGE_REQUEST_RE =
  /(صورة|صور|وريني|شوفيني|فرجيني|ارني|image|picture|photo|show\s*me)/i;

function normalizeSalesGPTNextAction(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .replace(/\s+/g, '_');
  if (SALESGPT_MODEL_NEXT_ACTIONS.has(t)) return t;
  return undefined;
}

function intentFromSalesGPTNextAction(action: string): Intent {
  switch (action) {
    case 'greet':
      return 'greeting';
    case 'discover_needs':
      return 'browse';
    case 'present_product':
      return 'product_query';
    case 'send_image':
      return 'product_query';
    case 'handle_objection':
      return 'other';
    case 'close_sale':
    case 'collect_info':
    case 'await_confirmation':
    case 'confirm_order':
      return 'order';
    case 'end_conversation':
      return 'other';
    default:
      return 'other';
  }
}

function stageIdFromNextAction(action: string, fallbackStageId: string): string {
  return NEXT_ACTION_TO_STAGE_ID[action] || fallbackStageId;
}

// ==================== TYPES ====================

export interface SalesGPTConfig {
    merchantId: string;
    merchantConfig: MerchantConfig;
    language: Language;
    useTools: boolean;
    verbose: boolean;
}

export interface SalesGPTState {
    conversationStageId: string;
    currentConversationStage: string;
    conversationHistory: string[];
    collectedInfo: {
        product_name?: string;
        product_id?: string;
        color?: string;
        size?: string;
        quantity?: number;
        name?: string;
        phone?: string;
        address?: string;
    };
    /** Persisted from ConversationState — ready for customer yes */
    awaitingOrderConfirmation?: boolean;
}

export interface SalesGPTResult {
    responseText: string;
    stageId: string;
    stageName: string;
    intent: Intent;
    stage: Stage;
    collectedInfo: SalesGPTState['collectedInfo'];
    nextAction: string;
    toolUsed?: string;
    toolOutput?: string;
    aiCallsCount: number;
    /** Structured understanding from the model for this turn. */
    customerRequest?: CustomerRequestSignals;
}

/**
 * Optional, lightweight catalog awareness passed alongside the
 * focused (active) products. Keeps the agent aware of what else the
 * merchant sells without dumping the full catalog.
 */
export interface CatalogAwareness {
    overview: ProductOverviewRow[];
    meta?: CatalogMetaSummary;
    activeProductId?: string | null;
    isExploring?: boolean;
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

// ==================== SALESGPT AGENT CLASS ====================

export class SalesGPTAgent {
    private config: SalesGPTConfig;
    private state: SalesGPTState;
    private tools: SalesGPTTool[];
    private aiCallsCount: number = 0;
    private currentProductsHaveColors: boolean = false;
    private currentProductsHaveSizes: boolean = false;

    constructor(config: SalesGPTConfig) {
        this.config = config;
        this.tools = config.useTools ? getSalesGPTTools() : [];
        this.state = {
            conversationStageId: "1",
            currentConversationStage: getStageDescription("1", config.language),
            conversationHistory: [],
            collectedInfo: {}
        };
    }

    // ==================== SEED AGENT ====================

    /**
     * Initialize/reset the agent for a new conversation
     */
    seedAgent(): void {
        this.state.conversationStageId = "1";
        this.state.currentConversationStage = getStageDescription("1", this.config.language);
        this.state.conversationHistory = [];
        this.state.collectedInfo = {};
        this.aiCallsCount = 0;
    }

    /**
     * Restore agent state from conversation history
     */
    restoreState(
        recentMessages: Message[],
        conversationState: ConversationState
    ): void {
        // Restore conversation history
        this.state.conversationHistory = recentMessages.map(m => {
            const prefix = m.role === 'user' ? 'المستخدم' : this.getSalespersonName();
            return `${prefix}: ${m.content} <END_OF_TURN>`;
        });

        // Restore collected info from conversation state
        if (conversationState.extracted_entities) {
            this.state.collectedInfo = {
                ...this.state.collectedInfo,
                product_name: conversationState.extracted_entities.product_query,
                color: conversationState.extracted_entities.color,
                size: conversationState.extracted_entities.size,
                quantity: conversationState.extracted_entities.quantity,
                name: conversationState.extracted_entities.name,
                phone: conversationState.extracted_entities.phone,
                address: conversationState.extracted_entities.address
            };
        }

        this.state.awaitingOrderConfirmation = !!conversationState.awaiting_order_confirmation;

        // Restore SalesGPT numeric stage (1–9) when persisted — avoids mapping close→6 only
        const persisted = conversationState.salesgpt_stage_id?.trim();
        if (persisted && /^[1-9]$/.test(persisted)) {
            this.state.conversationStageId = persisted;
            this.state.currentConversationStage = getStageDescription(
                persisted,
                this.config.language
            );
        } else if (conversationState.current_stage) {
            const stageMap: Record<string, string> = {
                discover: '2',
                offer: '4',
                objection: '5',
                close: '6',
                handoff: '9',
                clarify: '2'
            };
            this.state.conversationStageId = stageMap[conversationState.current_stage] || '1';
            this.state.currentConversationStage = getStageDescription(
                this.state.conversationStageId,
                this.config.language
            );
        }
    }

    // ==================== HUMAN STEP ====================

    /**
     * Process human input and add to conversation history
     */
    humanStep(humanInput: string): void {
        const formatted = `المستخدم: ${humanInput} <END_OF_TURN>`;
        this.state.conversationHistory.push(formatted);
    }

    /**
     * Inject a system context note into conversation history.
     * Use for returning customers — call AFTER restoreState, BEFORE humanStep.
     */
    injectContextNote(note: string): void {
        this.state.conversationHistory.push(`نظام: ${note} <END_OF_TURN>`);
    }

    // ==================== GENERATE RESPONSE (MAIN STEP) ====================

    /**
     * Generate the next sales response - the main brain function.
     * Single AI call: response + next_action + extracted_info.
     * Stage is derived from next_action (no separate stage-analyzer call).
     */
    async step(
        messageText: string,
        products: Product[],
        catalog?: CatalogAwareness
    ): Promise<SalesGPTResult> {
        const startTime = Date.now();
        let toolUsed: string | undefined;
        let toolOutput: string | undefined;
        const previousStageId = this.state.conversationStageId;

        // Step 1: Tools — when no products were loaded upstream, always search (no keyword gate).
        let toolContext: string = '';
        if (this.config.useTools && products.length === 0) {
            const ctx: ToolContext = {
                merchantId: this.config.merchantId,
                merchantConfig: this.config.merchantConfig,
                products
            };
            toolUsed = 'ProductSearch';
            toolOutput = await executeTool('ProductSearch', messageText, ctx);
            toolContext = `\n\nنتيجة البحث عن المنتجات:\n${toolOutput}`;
        }

        // Step 2: Build product context (active + catalog awareness)
        const productContext = this.buildProductContext(products, catalog);

        this.currentProductsHaveColors = products.some(p => p.colors && p.colors.length > 0);
        this.currentProductsHaveSizes = products.some(p => p.sizes && p.sizes.length > 0);

        // Snapshot completeness BEFORE this turn's AI extraction merges new fields.
        const fieldsWereCompleteBeforeTurn = this.getOrderFieldCompleteness().complete;
        const wasAwaitingConfirmation =
            previousStageId === '8' ||
            !!this.state.awaitingOrderConfirmation;

        // Step 3: One AI call — response + next_action + extracted_info + customer_request
        let {
            responseText: response,
            aiNextAction,
            customerRequest
        } = await this.generateSalesResponse(
            messageText,
            productContext,
            toolContext
        );

        // Step 4: next_action is the sole decision source (fallback only if model omits it)
        let nextAction: string;
        let intent: Intent;
        const normalizedAiAction = normalizeSalesGPTNextAction(aiNextAction);

        if (normalizedAiAction) {
            nextAction = normalizedAiAction;
            intent = intentFromSalesGPTNextAction(normalizedAiAction);
        } else {
            const fallback = this.determineIntentAndAction(messageText, previousStageId);
            nextAction = fallback.nextAction;
            intent = fallback.intent;
            logger.debug('SalesGPT: AI next_action missing — using stage fallback', {
                previousStageId,
                nextAction
            });
        }

        // Step 4.1: Image safety — honor send_image only when classified as a photo ask.
        // Prefer model signal; regex fallback only if the model omitted customer_request entirely.
        const allowSendImage =
            customerRequest === null
                ? SALESGPT_IMAGE_REQUEST_RE.test(messageText)
                : customerRequest.wantsPhoto;
        if (nextAction === 'send_image' && !allowSendImage) {
            nextAction = 'present_product';
            intent = 'product_query';
            logger.debug('SalesGPT: ignored send_image without photo intent', {
                aiNextAction,
                messagePreview: messageText.substring(0, 80)
            });
        }

        // Step 4.1b: Alternatives → stay in product presentation (never invent "only one product").
        if (customerRequest?.wantsAlternatives && nextAction === 'collect_info') {
            nextAction = 'present_product';
            intent = 'product_query';
        }

        // Step 4.2: Order rails — confirm_order ONLY after explicit customer finalization
        // while we were already ready. AI alone must never finalize.
        const orderCompleteness = this.getOrderFieldCompleteness();
        const resolvedOrder = resolveOrderNextAction({
            aiNextAction: nextAction,
            fieldsComplete: orderCompleteness.complete,
            fieldsWereCompleteBeforeTurn,
            wasAwaitingConfirmation,
            userMessage: messageText,
            language: this.config.language,
            collectedInfo: { ...this.state.collectedInfo },
            responseText: response,
            // undefined → policy falls back to heuristic; boolean → model owns the classification
            modelAsksProductInfo:
                customerRequest === null ? undefined : customerRequest.asksProductInfo
        });
        if (resolvedOrder.nextAction !== nextAction || resolvedOrder.responseText !== response) {
            logger.debug('SalesGPT: order confirmation policy applied', {
                from: nextAction,
                to: resolvedOrder.nextAction,
                reason: resolvedOrder.reason,
                missing: orderCompleteness.missing,
                fieldsWereCompleteBeforeTurn,
                wasAwaitingConfirmation,
                customerRequest
            });
        }
        nextAction = resolvedOrder.nextAction;
        response = resolvedOrder.responseText;
        if (
            nextAction === 'confirm_order' ||
            nextAction === 'await_confirmation' ||
            nextAction === 'collect_info'
        ) {
            intent = 'order';
        } else if (nextAction === 'present_product') {
            intent = 'product_query';
        } else if (customerRequest?.wantsAlternatives) {
            intent = 'browse';
        }

        // Step 4.3: <ESCALATE> in model reply → end_conversation / human handoff
        if (detectEscalationMarker(response)) {
            nextAction = 'end_conversation';
            intent = 'complaint';
            logger.info('SalesGPT: <ESCALATE> detected — forcing end_conversation');
        }

        // Step 5: Derive stage from next_action (single source of truth)
        const newStageId = stageIdFromNextAction(nextAction, previousStageId);
        this.state.conversationStageId = newStageId;
        this.state.currentConversationStage = getStageDescription(newStageId, this.config.language);

        if (this.config.verbose && newStageId !== previousStageId) {
            logger.debug(`Stage derived from next_action=${nextAction}: ${previousStageId} → ${newStageId}`);
        }

        // Step 6: Add response to history (without leaking control markers into context)
        const agentName = this.getSalespersonName();
        const historySafeResponse = stripInternalControlMarkers(response);
        this.state.conversationHistory.push(
            `${agentName}: ${historySafeResponse} <END_OF_TURN>`
        );

        const stage = mapStageIdToStage(this.state.conversationStageId) as Stage;

        logger.info('SalesGPT step completed', {
            stageId: this.state.conversationStageId,
            intent,
            stage,
            nextAction,
            customerRequest,
            aiCalls: this.aiCallsCount,
            processingMs: Date.now() - startTime
        });

        return {
            responseText: response,
            stageId: this.state.conversationStageId,
            stageName: this.state.currentConversationStage,
            intent,
            stage,
            collectedInfo: { ...this.state.collectedInfo },
            nextAction,
            toolUsed,
            toolOutput,
            aiCallsCount: this.aiCallsCount,
            customerRequest: customerRequest ?? undefined
        };
    }

    /** Whether order-critical fields are complete for this merchant's active product options. */
    private getOrderFieldCompleteness(): { complete: boolean; missing: string[] } {
        const { name, phone, address, product_name, color, size } = this.state.collectedInfo;
        const missing: string[] = [];
        if (!product_name) missing.push('product_name');
        if (!name) missing.push('name');
        if (!phone) missing.push('phone');
        if (!address) missing.push('address');
        if (this.currentProductsHaveColors && !color) missing.push('color');
        if (this.currentProductsHaveSizes && !size) missing.push('size');
        return { complete: missing.length === 0, missing };
    }

    // ==================== PRIVATE METHODS ====================

    private getSalespersonName(): string {
        const storeName = this.config.merchantConfig.storeName ||
            this.config.merchantConfig.store_name || 'المتجر';
        return `مساعد ${storeName}`;
    }

    /**
     * Merge new info into collected info (never overwrite with empty)
     */
    private mergeCollectedInfo(newInfo: Partial<SalesGPTState['collectedInfo']>): void {
        for (const [key, value] of Object.entries(newInfo)) {
            if (value === null || value === undefined || value === '') continue;
            if (key === 'quantity') {
                const n = typeof value === 'number' ? value : parseInt(String(value), 10);
                if (!Number.isNaN(n) && n > 0) {
                    (this.state.collectedInfo as any).quantity = n;
                }
                continue;
            }
            (this.state.collectedInfo as any)[key] = value;
        }
    }

    /**
     * Build product context string for the AI prompt.
     *
     * Two distinct sections so the model never confuses "what we are
     * actively selling right now" with "what else exists in the store":
     *   1) 🎯 Active product(s) — full details (price/stock/colors/sizes/...)
     *   2) 📚 Catalog overview — compact list (awareness only)
     *
     * Catalog overview is multi-tenant safe (merchant-scoped data) and
     * size-bounded, so it stays SaaS-friendly even with hundreds of products.
     */
    private buildProductContext(
        products: Product[],
        catalog?: CatalogAwareness
    ): string {
        const currencyCode = this.config.merchantConfig.storeCurrency || 'USD';
        const isArabic = this.config.language === 'arabic';
        const currencyLabel = getCurrencyDisplayName(currencyCode, isArabic ? 'arabic' : 'english');

        const sections: string[] = [];

        // ----- 1) Active product(s) – full details -----
        if (products.length > 0) {
            const active = products.map(p => {
                let info = `📦 ${p.name}\n`;
                info += isArabic
                    ? `   💰 السعر: ${p.price} ${getCurrencyDisplayName(p.currency || currencyCode, 'arabic')}\n`
                    : `   💰 Price: ${p.price} ${getCurrencyDisplayName(p.currency || currencyCode, 'english')}\n`;

                if (p.description) {
                    const fullDescription = sanitizeProductDescriptionForPrompt(p.description);
                    info += isArabic
                        ? `   📝 الوصف الكامل (مصدر الإقناع الوحيد للمميزات — استخرج منه 2–3 فوائد عند العرض/الاعتراض، وانقله بأمانة عند طلب التفاصيل):\n   ${fullDescription}\n`
                        : `   📝 Full description (sole source of selling points — extract 2–3 benefits when presenting/handling objections; quote faithfully when asked for details):\n   ${fullDescription}\n`;
                }
                if (p.stock !== undefined) {
                    info += isArabic
                        ? `   📊 المخزون: ${p.stock > 0 ? `${p.stock} قطعة` : 'غير متوفر'}\n`
                        : `   📊 Stock: ${p.stock > 0 ? `${p.stock} pcs` : 'Out of stock'}\n`;
                }
                if (p.colors && p.colors.length > 0) {
                    const optionsLabel = formatColorOptionsForDisplay(
                        p.colors,
                        isArabic ? 'arabic' : 'english'
                    );
                    info += isArabic
                        ? `   🎨 خيارات الألوان (كل رقم = خيار واحد، قد يكون لونين معاً): ${optionsLabel}\n`
                        : `   🎨 Color options (each number = one option, may combine colors): ${optionsLabel}\n`;
                }
                if (p.sizes && p.sizes.length > 0) {
                    info += isArabic
                        ? `   📏 المقاسات: ${p.sizes.join('، ')}\n`
                        : `   📏 Sizes: ${p.sizes.join(', ')}\n`;
                }
                if (p.has_variants && p.options && p.options.length > 0) {
                    p.options.forEach(opt => {
                        info += `   🔢 ${opt.name}: ${opt.values.join('، ')}\n`;
                    });
                }
                if (p.imageUrl) {
                    info += isArabic ? `   📸 صورة متوفرة\n` : `   📸 Image available\n`;
                }
                return info;
            }).join('\n');

            const header = isArabic
                ? '🎯 المنتج النشط للمتابعة (استخدم تفاصيله للسؤال/التأكيد):'
                : '🎯 Active product in focus (use these details for follow-ups/confirmation):';
            sections.push(`${header}\n${active}`);
        }

        // ----- 2) Catalog overview – awareness only -----
        if (catalog && catalog.overview && catalog.overview.length > 0) {
            // Hide the active product from the overview to avoid duplication
            const activeIds = new Set(products.map(p => p.id));
            if (catalog.activeProductId) activeIds.add(catalog.activeProductId);

            const filtered = catalog.overview.filter(row => !activeIds.has(row.id));
            if (filtered.length > 0) {
                const lines = filtered.slice(0, 30).map(row => {
                    const priceLabel = getCurrencyDisplayName(
                        row.currency || currencyCode,
                        isArabic ? 'arabic' : 'english'
                    );
                    const stockTag = row.inStock
                        ? (isArabic ? 'متوفر' : 'in stock')
                        : (isArabic ? 'غير متوفر' : 'out of stock');
                    const variantsTag: string[] = [];
                    if (row.hasColors) variantsTag.push(isArabic ? 'ألوان' : 'colors');
                    if (row.hasSizes) variantsTag.push(isArabic ? 'مقاسات' : 'sizes');
                    const variants = variantsTag.length > 0
                        ? ` | ${variantsTag.join('+')}`
                        : '';
                    const category = row.category ? ` | ${row.category}` : '';
                    return `- ${row.name}${category} | ${row.price} ${priceLabel} | ${stockTag}${variants}`;
                }).join('\n');

                const totalSuffix = catalog.meta && catalog.meta.totalProducts > filtered.length
                    ? (isArabic
                        ? `\n(إجمالي المنتجات في المتجر: ${catalog.meta.totalProducts} — هذه أبرز ${filtered.length} منتجاً)`
                        : `\n(Total catalog: ${catalog.meta.totalProducts} — showing top ${filtered.length})`)
                    : '';

                const header = isArabic
                    ? '📚 منتجات أخرى في كتالوج هذا التاجر (حقائق — استخدمها للإجابة عن البدائل بصدق):'
                    : '📚 Other products in this merchant catalog (facts — use them to answer alternatives truthfully):';
                sections.push(`${header}\n${lines}${totalSuffix}`);
            }
        }

        // ----- Catalog size truth (always, even when overview is empty after filtering) -----
        if (catalog?.meta && typeof catalog.meta.totalProducts === 'number') {
            const total = catalog.meta.totalProducts;
            const activeCount = products.length;
            if (isArabic) {
                sections.push(
                    `📊 إجمالي منتجات المتجر: ${total}.` +
                    (total > activeCount
                        ? ` يوجد منتجات غير المنتج النشط — ممنوع القول «عندنا منتج واحد فقط» أو إنكار وجود بدائل.`
                        : total <= 1
                            ? ` هذا فعلاً العدد الكلي في كتالوج هذا التاجر.`
                            : '')
                );
            } else {
                sections.push(
                    `📊 Store product count: ${total}.` +
                    (total > activeCount
                        ? ` Other products exist beyond the active one — never claim you only have one product or deny alternatives.`
                        : total <= 1
                            ? ` That is the real total for this merchant catalog.`
                            : '')
                );
            }
        }

        // ----- 3) Catalog meta (categories) when no overview rows exist -----
        if (
            sections.length === 0 &&
            catalog &&
            catalog.meta &&
            catalog.meta.categories.length > 0
        ) {
            const cats = catalog.meta.categories
                .map(c => `${c.name} (${c.count})`)
                .join('، ');
            const header = isArabic
                ? '📚 تصنيفات متوفرة في المتجر:'
                : '📚 Available categories in store:';
            sections.push(`${header}\n${cats}`);
        }

        return sections.join('\n\n');
    }

    /**
     * Generate the actual sales response using AI.
     * customerRequest is null when the model omitted the block (callers may fall back).
     */
    private async generateSalesResponse(
        messageText: string,
        productContext: string,
        toolContext: string
    ): Promise<{
        responseText: string;
        aiNextAction?: string;
        customerRequest: CustomerRequestSignals | null;
    }> {
        const agentName = this.getSalespersonName();
        const storeName = this.config.merchantConfig.storeName ||
            this.config.merchantConfig.store_name || 'المتجر';
        const currencyCode = this.config.merchantConfig.storeCurrency || 'USD';
        const isArabic = this.config.language === 'arabic';
        const currencyLabelAr = getCurrencyDisplayName(currencyCode, 'arabic');
        const currencyLabelEn = getCurrencyDisplayName(currencyCode, 'english');

        // Build collected info summary
        const collectedSummary = Object.entries(this.state.collectedInfo)
            .filter(([_, v]) => v !== null && v !== undefined)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');

        // Tenant-scoped persona + custom system prompt from merchant Settings
        const personaMeta = getSalesGPTPersonaMeta(this.config.merchantConfig.persona);
        const customSystemPrompt = (this.config.merchantConfig.systemPrompt || '').trim();

        // Build the comprehensive prompt
        const systemPrompt = buildSalesGPTSystemPrompt({
            salesperson_name: agentName,
            salesperson_role: isArabic ? personaMeta.roleAr : personaMeta.roleEn,
            company_name: storeName,
            company_business: this.config.merchantConfig.additionalNotes || (isArabic ? 'متجر إلكتروني متميز' : 'Premium online store'),
            company_values: isArabic ? 'جودة عالية، خدمة ممتازة، رضا العميل' : 'High quality, excellent service, customer satisfaction',
            conversation_purpose: isArabic ? 'مساعدة العميل في اختيار المنتج المناسب وإتمام عملية الشراء' : 'Help the customer choose the right product and complete the purchase',
            conversation_type: isArabic ? 'محادثة نصية' : 'text chat',
            language: this.config.language,
            storeCurrency: currencyCode,
            persona: personaMeta.key,
            customSystemPrompt,
            policies: {
                shippingPolicy: this.config.merchantConfig.shippingPolicy,
                deliveryTime: this.config.merchantConfig.deliveryTime,
                paymentMethods: this.config.merchantConfig.paymentMethods,
                returnPolicy: this.config.merchantConfig.returnPolicy,
                additionalNotes: this.config.merchantConfig.additionalNotes
            }
        });

        const conversationHistoryText = this.state.conversationHistory.join('\n');

        // Build conditional color/size instructions based on actual product data
        const hasColors = this.currentProductsHaveColors;
        const hasSizes = this.currentProductsHaveSizes;

        let arColorSizeRules = '';
        let enColorSizeRules = '';

        if (hasColors || hasSizes) {
            if (hasColors) {
                arColorSizeRules += '- 🚨 هذا المنتج فيه خيارات ألوان! كل عنصر في قائمة الألوان خيار واحد للبيع (قد يحتوي لونين معاً مثل «أسود وبني»). لا تفصل الألوان داخل الخيار الواحد ولا تعرضها كألوان مستقلة.\n';
                arColorSizeRules += '- إذا لم يختار العميل خيار لون → اسأله واعرض الخيارات المرقّمة من بيانات المنتج كما هي\n';
                enColorSizeRules += '- 🚨 This product has color options! Each entry is ONE sellable option (may combine two colors e.g. "black & brown"). Never split a compound option into separate colors.\n';
                enColorSizeRules += '- If customer hasn\'t chosen a color option → ask and show the numbered options from product data as-is\n';
            }
            if (hasSizes) {
                arColorSizeRules += '- 🚨 هذا المنتج فيه مقاسات متعددة! إذا لم يختار العميل مقاساً → يجب أن تسأله عن المقاس المفضل قبل إتمام الطلب (اعرض المقاسات المتاحة من بيانات المنتج)\n';
                enColorSizeRules += '- 🚨 This product has multiple sizes! If customer hasn\'t chosen one → you MUST ask for their preferred size before completing the order (show available sizes from product data)\n';
            }
            arColorSizeRules += '- 🚨 لا تؤكد الطلب نهائياً إلا بعد اختيار ' + (hasColors && hasSizes ? 'اللون والمقاس' : hasColors ? 'اللون' : 'المقاس') + '\n';
            arColorSizeRules += '- إذا كل المعلومات مكتملة (اسم + هاتف + عنوان + منتج' + (hasColors ? ' + اللون' : '') + (hasSizes ? ' + المقاس' : '') + ') → اعرض ملخص الطلب واطلب تأكيداً صريحاً (next_action: await_confirmation). لا تستخدم confirm_order قبل أن يقول العميل نعم/أكد\n';
            enColorSizeRules += '- 🚨 NEVER confirm an order without ' + (hasColors && hasSizes ? 'color and size' : hasColors ? 'color' : 'size') + ' selection\n';
            enColorSizeRules += '- If all info complete (name + phone + address + product' + (hasColors ? ' + color' : '') + (hasSizes ? ' + size' : '') + ') → show a summary and ask for explicit confirmation (next_action: await_confirmation). NEVER use confirm_order until the customer says yes/confirm\n';
        } else {
            arColorSizeRules = '- ⚠️ هذا المنتج ليس فيه ألوان ولا مقاسات. لا تسأل العميل عن لون أو مقاس نهائياً!\n- إذا كل المعلومات مكتملة (اسم + هاتف + عنوان + منتج) → اعرض الملخص واطلب تأكيداً صريحاً (next_action: await_confirmation). ممنوع confirm_order قبل موافقة العميل\n';
            enColorSizeRules = '- ⚠️ This product does NOT have colors or sizes. Do NOT ask the customer about color or size at all!\n- If all info complete (name + phone + address + product) → show a summary and ask for explicit confirmation (next_action: await_confirmation). NEVER use confirm_order until the customer says yes/confirm\n';
        }

        const askingProductInfo = isProductInfoRequest(messageText);

        const customerRequestSchema = `"customer_request": {
    "wants_alternatives": true/false,
    "asks_product_info": true/false,
    "wants_photo": true/false,
    "ready_to_confirm": true/false
  }`;

        const userPrompt = isArabic
            ? `المرحلة الحالية: ${this.state.currentConversationStage}

المعلومات المجمعة حتى الآن: ${collectedSummary || 'لا يوجد'}

${productContext || 'لا توجد منتجات في السياق.'}
${toolContext}

تاريخ المحادثة:
${conversationHistoryText || 'هذه أول رسالة'}

رسالة العميل الحالية: "${messageText}"

📝 تعليمات مهمة:
- افهم نية العميل من المعنى الكامل للرسالة (لهجة، صياغة، سؤال ضمني) — لا تعتمد على كلمات مفتاحية حرفية.
- املأ customer_request بأمانة حسب فهمك للرسالة الحالية فقط.
- 🎯 إقناع من الوصف: عند present_product / handle_objection / close_sale استخرج 2–3 فوائد من **الوصف الكامل** للمنتج النشط. لا تختلق مميزات.
- إذا asks_product_info=true → next_action="present_product" وانقل من الوصف الكامل. ممنوع ملخص تأكيد الطلب.
- إذا wants_alternatives=true → أجب بصدق من **📚 منتجات أخرى** و/أو إجمالي المنتجات. اقترح 1–3 بدائل بأسعارها. ممنوع إنكار وجود منتجات أخرى إذا ظهر في السياق أكثر من منتج أو إجمالي > 1.
- إذا wants_photo=true فقط → next_action="send_image".
- ready_to_confirm=true فقط عندما يوافق العميل صراحة على تثبيت الطلب (نعم/أكد)، وليس عند لفظة مجاملة مثل «تمام» داخل سؤال آخر.
- إذا العميل قدم اسماً/هاتفاً/عنواناً → اشكره ثم اسأل المعلومة التالية أو اعرض ملخصاً لـ await_confirmation.
- في extracted_info: املأ من تاريخ المحادثة والرسالة الحالية معاً؛ null لما لم يُذكر.

🧭 سياسة الكتالوج:
- المنتج النشط للتفاصيل العميقة؛ باقي الكتالوج للإجابة عن البدائل بصدق.
- لا تخلط أسعار/أوصاف بين منتجين.
- لا تعرض كل الكتالوج دفعة واحدة إلا إذا طلب العميل ذلك صراحة.
${arColorSizeRules}- عند ذكر السعر استخدم اسم العملة المذكور مع كل منتج.
- لا تختلق معلومات.
- ردود قصيرة (2–4 جمل) إلا عند asks_product_info فاستخدم الوصف بوضوح.

أعد JSON فقط:
{
  "response_text": "ردك المباشر للعميل",
  "next_action": "greet | discover_needs | present_product | handle_objection | close_sale | collect_info | await_confirmation | confirm_order | send_image | end_conversation",
  ${customerRequestSchema},
  "extracted_info": {
    "product_name": "إذا ذُكر أو null",
    "color": "إذا ذُكر أو null",
    "size": "إذا ذُكر أو null",
    "quantity": "رقم أو null",
    "name": "إذا ذُكر أو null",
    "phone": "إذا ذُكر أو null",
    "address": "إذا ذُكر أو null"
  }
}`
            : `Current stage: ${this.state.currentConversationStage}

Collected info so far: ${collectedSummary || 'None'}

${productContext || 'No products in context.'}
${toolContext}

Conversation history:
${conversationHistoryText || 'This is the first message'}

Current customer message: "${messageText}"

📝 Important instructions:
- Understand intent from full meaning (dialect, phrasing, implied questions) — never rely on literal keyword lists.
- Fill customer_request honestly from the current message only.
- 🎯 Persuade from the description: on present_product / handle_objection / close_sale extract 2–3 benefits from the active product's full description. Never invent features.
- If asks_product_info=true → next_action="present_product" and use the full description. No order-confirmation summary.
- If wants_alternatives=true → answer truthfully from **📚 Other products** and/or total product count. Suggest 1–3 alternatives with prices. Never deny other products when context shows more than one or total > 1.
- If wants_photo=true only → next_action="send_image".
- ready_to_confirm=true only when the customer explicitly affirms placing the order — not polite fillers like "ok" inside another question.
- If customer provided name/phone/address → acknowledge, then ask next missing field or show await_confirmation summary.
- In extracted_info: fill from history + current message; null when absent.

🧭 Catalog policy:
- Active product for deep detail; rest of catalog for truthful alternatives.
- Never mix prices/descriptions across products.
- Do not dump the full catalog unless the customer explicitly asks for it.
${enColorSizeRules}- Use each product's currency name as shown.
- Never invent information.
- Keep replies short (2–4 sentences) unless asks_product_info — then use the description clearly.

Return JSON only:
{
  "response_text": "your direct response to the customer",
  "next_action": "greet | discover_needs | present_product | handle_objection | close_sale | collect_info | await_confirmation | confirm_order | send_image | end_conversation",
  ${customerRequestSchema},
  "extracted_info": {
    "product_name": "if mentioned or null",
    "color": "if mentioned or null",
    "size": "if mentioned or null",
    "quantity": "number or null",
    "name": "if mentioned or null",
    "phone": "if mentioned or null",
    "address": "if mentioned or null"
  }
}`;

        trackAICall();
        this.aiCallsCount++;

        const result = await generateJSON<{
            response_text: string;
            next_action: string;
            customer_request?: unknown;
            extracted_info: Partial<SalesGPTState['collectedInfo']>;
        }>(userPrompt, {
            systemInstruction: systemPrompt,
            temperature: 0.3,
            maxOutputTokens: askingProductInfo ? 1200 : 700
        });

        if (result.success && result.data) {
            if (result.data.extracted_info) {
                this.mergeCollectedInfo(result.data.extracted_info);
            }
            const rawRequest = result.data.customer_request;
            const customerRequest = hasCustomerRequestBlock(rawRequest)
                ? normalizeCustomerRequest(rawRequest)
                : null;
            return {
                responseText: result.data.response_text || (isArabic ? 'كيف يمكنني مساعدتك؟' : 'How can I help you?'),
                aiNextAction: result.data.next_action,
                customerRequest
            };
        }

        return {
            responseText: isArabic
                ? 'أهلاً وسهلاً! 😊 كيف يمكنني مساعدتك اليوم؟'
                : 'Hello! 😊 How can I help you today?',
            aiNextAction: undefined,
            customerRequest: null
        };
    }

    /**
     * Stage-only fallback when the model omits next_action (no keyword intent matching).
     */
    private determineIntentAndAction(
        _messageText: string,
        stageId: string
    ): { intent: Intent; nextAction: string } {
        if (['6', '7', '8'].includes(stageId)) {
            const { name, phone, address, product_name, color, size } = this.state.collectedInfo;
            const needsColor = this.currentProductsHaveColors && !color;
            const needsSize = this.currentProductsHaveSizes && !size;
            if (name && phone && address && product_name && !needsColor && !needsSize) {
                return { intent: 'order', nextAction: 'await_confirmation' };
            }
            return { intent: 'order', nextAction: stageId === '6' ? 'close_sale' : 'collect_info' };
        }

        if (stageId === '5') {
            return { intent: 'other', nextAction: 'handle_objection' };
        }

        if (['3', '4'].includes(stageId)) {
            return { intent: 'product_query', nextAction: 'present_product' };
        }

        if (stageId === '2') {
            return { intent: 'browse', nextAction: 'discover_needs' };
        }

        if (stageId === '1') {
            return { intent: 'greeting', nextAction: 'greet' };
        }

        if (stageId === '9') {
            return { intent: 'other', nextAction: 'end_conversation' };
        }

        return { intent: 'other', nextAction: 'discover_needs' };
    }
}
