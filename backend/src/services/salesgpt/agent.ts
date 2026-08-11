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

/** Explicit photo request in the customer message (must match SalesGPT pipeline detector). */
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

        // Step 1: Tools (extraction happens in generateSalesResponse via extracted_info)
        let toolContext: string = '';
        if (this.config.useTools) {
            const needsProductSearch = this.shouldSearchProducts(messageText);
            if (needsProductSearch && products.length === 0) {
                const ctx: ToolContext = {
                    merchantId: this.config.merchantId,
                    merchantConfig: this.config.merchantConfig,
                    products
                };
                toolUsed = 'ProductSearch';
                toolOutput = await executeTool('ProductSearch', messageText, ctx);
                toolContext = `\n\nنتيجة البحث عن المنتجات:\n${toolOutput}`;
            }
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

        // Step 3: One AI call — response + next_action + extracted_info
        // Prompt still receives previous stage as guidance only (not a competing decision).
        let { responseText: response, aiNextAction } = await this.generateSalesResponse(
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

        // Step 4.1: Safety — never honor send_image without an explicit photo request
        if (nextAction === 'send_image' && !SALESGPT_IMAGE_REQUEST_RE.test(messageText)) {
            nextAction = 'present_product';
            intent = 'product_query';
            logger.debug('SalesGPT: ignored send_image without explicit image request', {
                aiNextAction,
                messagePreview: messageText.substring(0, 80)
            });
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
            responseText: response
        });
        if (resolvedOrder.nextAction !== nextAction || resolvedOrder.responseText !== response) {
            logger.debug('SalesGPT: order confirmation policy applied', {
                from: nextAction,
                to: resolvedOrder.nextAction,
                reason: resolvedOrder.reason,
                missing: orderCompleteness.missing,
                fieldsWereCompleteBeforeTurn,
                wasAwaitingConfirmation
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
            aiCallsCount: this.aiCallsCount
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

    private shouldSearchProducts(messageText: string): boolean {
        const searchTriggers = [
            /بحث|ابحث|دور|ابي|بدي|اريد|عندكم|شو عندكم|وريني|فرجيني/i,
            /search|find|show|looking for|do you have/i
        ];
        return searchTriggers.some(p => p.test(messageText));
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
                    ? '📚 نظرة عامة على باقي الكتالوج (مرجعية فقط — لا تعرض هذه القائمة للعميل ما لم يطلبها صراحةً):'
                    : '📚 Catalog overview (reference only — do not list these to the customer unless explicitly asked):';
                sections.push(`${header}\n${lines}${totalSuffix}`);
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
     * Generate the actual sales response using AI
     */
    private async generateSalesResponse(
        messageText: string,
        productContext: string,
        toolContext: string
    ): Promise<{ responseText: string; aiNextAction?: string }> {
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

        const userPrompt = isArabic
            ? `المرحلة الحالية: ${this.state.currentConversationStage}

المعلومات المجمعة حتى الآن: ${collectedSummary || 'لا يوجد'}

${productContext || 'لا توجد منتجات في السياق.'}
${toolContext}

تاريخ المحادثة:
${conversationHistoryText || 'هذه أول رسالة'}

رسالة العميل الحالية: "${messageText}"

📝 تعليمات مهمة:
- 🎯 إقناع من الوصف: عند present_product / handle_objection / close_sale (وعند اقتراح المنتج أول مرة) استخرج 2–3 فوائد من **الوصف الكامل** للمنتج النشط واربطها بحاجة العميل إن وُجدت. لا تختلق مميزات. لا تلصق الوصف كاملاً إلا عند طلب معلومات/تفاصيل.
- إذا طلب العميل معلومات / تفاصيل / وصف / مواصفات عن المنتج → next_action="present_product". انقل من **الوصف الكامل** بأمانة (يمكن 4–8 جمل عند الحاجة). ممنوع ملخص تأكيد الطلب أو «هل أكد؟» في هذه الرسالة. سؤال ختامي خفيف فقط إن لزم (مثل: هل تحب صورة أو تفضّل لون/مقاس؟).
- إذا العميل قدم اسماً أو هاتفاً أو عنواناً → اشكره وأكد الاستلام ثم اسأل عن المعلومة التالية المفقودة أو اعرض ملخص الطلب واطلب تأكيداً صريحاً
- عندما تكتمل كل الحقول ورسالة العميل ليست طلب معلومات → next_action="await_confirmation" مع ملخص + سؤال «هل أكد؟». ممنوع next_action="confirm_order" قبل أن يقول العميل نعم/أكد
- في **extracted_info**: املأ الحقول من **تاريخ المحادثة والرسالة الحالية معاً** (اسم، هاتف، عنوان، لون، مقاس، منتج). لا تقتصر على الرسالة الحالية فقط؛ إذا لم يُذكر حقل في أي منهما استخدم null.
- 📸 الصور: «صورة متوفرة» داخلية فقط. استخدم next_action="send_image" وامدح المنتج باختصار فقط إذا الرسالة الحالية طلبت صورة صراحةً (صورة/وريني/فرجيني/ارني). ممنوع قول «تفضل الصورة» أو الادعاء أن صورة أُرسلت إذا لم يطلبها. سؤال السعر/المواصفات → أجب دون ذكر صورة.

🧭 سياسة استخدام المنتجات والكتالوج:
- ركّز ردودك التفصيلية على **🎯 المنتج النشط** (السعر، الألوان، المقاسات، الوصف الكامل كمصدر الإقناع).
- إذا سأل العميل عن منتج آخر أو تصنيف آخر أو "غيره" أو "شو كمان" → اعتمد على **📚 نظرة عامة على الكتالوج** للإجابة بصدق ودون اختلاق، واقترح عليه أبرز خيار مناسب من القائمة.
- لا تقل أبداً "ليس لدينا" إذا كان المنتج موجوداً في النظرة العامة للكتالوج.
- لا تعرض القائمة الكاملة للكتالوج للعميل دفعة واحدة؛ اقترح 1-3 خيارات فقط من النظرة العامة.
- لا تخلط بيانات منتجين مختلفين (لا تنسخ سعر منتج إلى آخر).
${arColorSizeRules}- عند ذكر السعر استخدم **اسم العملة الخاص بكل منتج** كما هو مذكور بجواره (لا تستبدل عملة منتج بأخرى)
- لا تختلق معلومات
- كن متحمساً ومحترفاً
- اجعل الرد مختصراً (2-4 جمل) إلا عند طلب معلومات المنتج فاستخدم الوصف الكامل بوضوح

أعد ردك كالتالي (JSON):
{
  "response_text": "ردك المباشر للعميل",
  "next_action": "greet | discover_needs | present_product | handle_objection | close_sale | collect_info | await_confirmation | confirm_order | send_image | end_conversation",
  "extracted_info": {
    "product_name": "إذا ذُكر",
    "color": "إذا ذُكر",
    "size": "إذا ذُكر",
    "quantity": "رقم الكمية المطلوبة (رقم فقط، الافتراضي 1)",
    "name": "إذا ذُكر",
    "phone": "إذا ذُكر",
    "address": "إذا ذُكر"
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
- 🎯 Persuade from the description: on present_product / handle_objection / close_sale (and first product suggestion), extract 2–3 benefits from the active product's **full description** and tie them to the customer's need if known. Never invent features. Do not paste the full description unless they ask for details.
- If the customer asks for more info / details / description / specs → next_action="present_product". Faithfully use the **full description** (4–8 sentences when needed). Do NOT show an order-confirmation summary or ask "shall I confirm?" on this turn. Soft follow-up only if useful (photo / color / size).
- If customer provided name/phone/address → acknowledge, then ask for next missing info or show order summary and ask for explicit confirmation
- When all fields are complete AND the message is not a product-info request → next_action="await_confirmation" with a summary + "shall I confirm?". NEVER use next_action="confirm_order" until the customer says yes/confirm
- In **extracted_info**: fill fields from **conversation history AND the current message** (name, phone, address, color, size, product). Do not only read the latest turn; use null for fields not stated anywhere.
- 📸 Images: "Image available" is internal only. Use next_action="send_image" and briefly praise the product only if the current message explicitly asks for a photo (photo/image/show me/picture). Never say "Here's the photo!" or claim a photo was sent if they did not ask. Price/specs questions → answer with no photo mention.

🧭 Product & catalog policy:
- Keep detailed follow-up focused on the **🎯 active product** (price, options, stock, full description as the persuasion source).
- If customer asks for alternatives, categories, "other products", or "what else" → use the **📚 catalog overview** to answer truthfully and suggest 1-3 relevant options.
- Never say "we don't have it" if that product exists in the catalog overview.
- Do not dump the entire catalog to the customer unless explicitly requested.
- Never mix facts between products (e.g., wrong price/currency copied from another item).
${enColorSizeRules}- Use the **product-specific currency name** shown next to each item (never replace one product's currency with another).
- Never invent information
- Be enthusiastic and professional
- Keep response short (2-4 sentences) unless answering a product-info request — then use the full description clearly

Respond as JSON:
{
  "response_text": "your direct response to the customer",
  "next_action": "greet | discover_needs | present_product | handle_objection | close_sale | collect_info | await_confirmation | confirm_order | send_image | end_conversation",
  "extracted_info": {
    "product_name": "if mentioned",
    "color": "if mentioned",
    "size": "if mentioned",
    "quantity": "requested quantity number (number only, default 1)",
    "name": "if mentioned",
    "phone": "if mentioned",
    "address": "if mentioned"
  }
}`;

        trackAICall();
        this.aiCallsCount++;

        const result = await generateJSON<{
            response_text: string;
            next_action: string;
            extracted_info: Partial<SalesGPTState['collectedInfo']>;
        }>(userPrompt, {
            systemInstruction: systemPrompt,
            temperature: 0.4,
            maxOutputTokens: askingProductInfo ? 1200 : 600
        });

        if (result.success && result.data) {
            // Merge any newly extracted info
            if (result.data.extracted_info) {
                this.mergeCollectedInfo(result.data.extracted_info);
            }
            return {
                responseText: result.data.response_text || (isArabic ? 'كيف يمكنني مساعدتك؟' : 'How can I help you?'),
                aiNextAction: result.data.next_action
            };
        }

        // Fallback
        return {
            responseText: isArabic
                ? 'أهلاً وسهلاً! 😊 كيف يمكنني مساعدتك اليوم؟'
                : 'Hello! 😊 How can I help you today?',
            aiNextAction: undefined
        };
    }

    /**
     * Check if user is explicitly confirming an order
     */
    private isUserConfirmingOrder(messageText: string): boolean {
        const text = messageText.trim();
        const confirmPatterns = [
            /^(نعم|أيوا|أي|اي|تمام|موافق|ماشي|طيب|أكيد|بالتأكيد|اوكي|ok|okay|yes|yep|yeah|sure)[\s!،,.؟?]*$/i,
            /^(بدي|أريد|ابي|عاوز)\s*(أكد|اكد|تأكيد|أأكد|اأكد|أؤكد)/i,
            /^(أكد|اكد|نفذ|أتمم|اتمم)\s*(الطلب|طلبي|الأوردر)?[\s!،,.]*$/i,
            /^(confirm|place|submit)\s*(order|it)?[\s!,.]*$/i,
            /^(اي|أي)\s+(بدي|أريد)\s*(أكد|اكد|أأكد|تأكيد)/i,
            /^(نعم|اي|أي|أيوا)\s*(أكد|اكد|أأكد|اأكد|أؤكد|تأكيد|نفذ)/i
        ];
        return confirmPatterns.some(p => p.test(text));
    }

    /**
     * Determine intent and next action from stage and message
     */
    private determineIntentAndAction(
        messageText: string,
        stageId: string
    ): { intent: Intent; nextAction: string } {
        const text = messageText.toLowerCase();

        // Order-related
        if (['6', '7', '8'].includes(stageId)) {
            const { name, phone, address, product_name, color, size } = this.state.collectedInfo;
            const needsColor = this.currentProductsHaveColors && !color;
            const needsSize = this.currentProductsHaveSizes && !size;
            if (name && phone && address && product_name && !needsColor && !needsSize) {
                return { intent: 'order', nextAction: 'await_confirmation' };
            }
            return { intent: 'order', nextAction: stageId === '6' ? 'close_sale' : 'collect_info' };
        }

        // Objection
        if (stageId === '5') {
            if (/غالي|مرتفع|سعر|expensive|costly|price/i.test(text)) {
                return { intent: 'price', nextAction: 'handle_objection' };
            }
            return { intent: 'other', nextAction: 'handle_objection' };
        }

        // Product presentation
        if (['3', '4'].includes(stageId)) {
            return { intent: 'product_query', nextAction: 'present_product' };
        }

        // Needs discovery
        if (stageId === '2') {
            return { intent: 'browse', nextAction: 'discover_needs' };
        }

        // Greeting
        if (stageId === '1') {
            return { intent: 'greeting', nextAction: 'greet' };
        }

        // End
        if (stageId === '9') {
            return { intent: 'other', nextAction: 'end_conversation' };
        }

        // Default
        return { intent: 'other', nextAction: 'discover_needs' };
    }
}
