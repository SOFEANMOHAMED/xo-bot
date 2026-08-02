/**
 * SalesGPT Agent - Main controller for the Sales Bot Brain
 * TypeScript port of SalesGPT Python project, adapted for SaaS e-commerce
 * 
 * This is the CORE brain that replaces the old AI orchestrator.
 * It manages conversation stages, generates responses, and uses tools.
 */

import { generateJSON, generateSimple, trackAICall } from '../../ai/gemini-client.js';
import { CONVERSATION_STAGES, CONVERSATION_STAGES_EN, getStageDescription, mapStageIdToStage } from './stages.js';
import {
    STAGE_ANALYZER_INCEPTION_PROMPT,
    SALES_AGENT_INCEPTION_PROMPT,
    SALES_AGENT_TOOLS_PROMPT,
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

/** Values the sales-response model may return in JSON `next_action` */
const SALESGPT_MODEL_NEXT_ACTIONS = new Set([
  'greet',
  'discover_needs',
  'present_product',
  'handle_objection',
  'close_sale',
  'collect_info',
  'confirm_order',
  'send_image',
  'end_conversation'
]);

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
    case 'confirm_order':
      return 'order';
    case 'end_conversation':
      return 'other';
    default:
      return 'other';
  }
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

    // ==================== DETERMINE CONVERSATION STAGE ====================

    /**
     * Use AI to determine the current conversation stage
     */
    async determineConversationStage(): Promise<string> {
        const stages = this.config.language === 'arabic'
            ? CONVERSATION_STAGES
            : CONVERSATION_STAGES_EN;

        const stagesText = Object.entries(stages)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n');

        const prompt = STAGE_ANALYZER_INCEPTION_PROMPT
            .replace('{conversation_history}', this.state.conversationHistory.join('\n'))
            .replace('{current_stage_id}', this.state.conversationStageId)
            .replace('{conversation_stages}', stagesText);

        trackAICall();
        this.aiCallsCount++;

        const result = await generateSimple(prompt, {
            temperature: 0.1,
            maxOutputTokens: 10
        });

        if (result.success && result.text) {
            // Extract just the number
            const match = result.text.trim().match(/\d/);
            if (match) {
                const newStageId = match[0];
                if (stages[newStageId]) {
                    this.state.conversationStageId = newStageId;
                    this.state.currentConversationStage = getStageDescription(newStageId, this.config.language);

                    if (this.config.verbose) {
                        logger.debug(`Stage changed to: ${newStageId} - ${this.state.currentConversationStage.substring(0, 50)}`);
                    }
                }
            }
        }

        return this.state.conversationStageId;
    }

    // ==================== GENERATE RESPONSE (MAIN STEP) ====================

    /**
     * Generate the next sales response - the main brain function
     */
    async step(
        messageText: string,
        products: Product[],
        catalog?: CatalogAwareness
    ): Promise<SalesGPTResult> {
        const startTime = Date.now();
        let toolUsed: string | undefined;
        let toolOutput: string | undefined;

        // Step 1: Determine conversation stage
        await this.determineConversationStage();

        // Step 2: Tools (extraction happens in generateSalesResponse via extracted_info — single AI pass)
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

        // Step 3: Build product context (active + catalog awareness)
        const productContext = this.buildProductContext(products, catalog);

        this.currentProductsHaveColors = products.some(p => p.colors && p.colors.length > 0);
        this.currentProductsHaveSizes = products.some(p => p.sizes && p.sizes.length > 0);

        // Step 4: Response + structured fields (extracted_info) in one AI call
        const { responseText: response, aiNextAction } = await this.generateSalesResponse(
            messageText,
            productContext,
            toolContext
        );

        // Step 5: Rule-based baseline (stage + collected fields)
        let { intent, nextAction } = this.determineIntentAndAction(
            messageText,
            this.state.conversationStageId
        );

        // Step 5.5: AI `next_action` takes priority over stage-only rules
        const normalizedAiAction = normalizeSalesGPTNextAction(aiNextAction);
        if (normalizedAiAction) {
            // Never honor send_image unless the customer explicitly asked for a photo
            if (normalizedAiAction === 'send_image' && !SALESGPT_IMAGE_REQUEST_RE.test(messageText)) {
                nextAction = 'present_product';
                intent = 'product_query';
                logger.debug('SalesGPT: ignored send_image without explicit image request', {
                    aiNextAction,
                    messagePreview: messageText.substring(0, 80)
                });
            } else {
                nextAction = normalizedAiAction;
                intent = intentFromSalesGPTNextAction(normalizedAiAction);
                logger.debug('SalesGPT: using AI next_action over stage rules', {
                    aiNextAction,
                    normalized: normalizedAiAction,
                    intent
                });
            }
        }

        // Step 5.6: Explicit user confirmation if model did not emit confirm_order
        if (nextAction !== 'confirm_order' && this.isUserConfirmingOrder(messageText)) {
            const { name, phone, address, product_name } = this.state.collectedInfo;
            if (name && phone && address && product_name) {
                const needsColor = this.currentProductsHaveColors && !this.state.collectedInfo.color;
                const needsSize = this.currentProductsHaveSizes && !this.state.collectedInfo.size;
                if (!needsColor && !needsSize) {
                    nextAction = 'confirm_order';
                    intent = 'order';
                    console.log('✅ SalesGPT: User explicitly confirmed order (fallback)');
                }
            }
        }

        // Step 6: Add response to history
        const agentName = this.getSalespersonName();
        this.state.conversationHistory.push(
            `${agentName}: ${response} <END_OF_TURN>`
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
                    info += `   📝 ${p.description.substring(0, 100)}${p.description.length > 100 ? '...' : ''}\n`;
                }
                if (p.stock !== undefined) {
                    info += isArabic
                        ? `   📊 المخزون: ${p.stock > 0 ? `${p.stock} قطعة` : 'غير متوفر'}\n`
                        : `   📊 Stock: ${p.stock > 0 ? `${p.stock} pcs` : 'Out of stock'}\n`;
                }
                if (p.colors && p.colors.length > 0) {
                    info += isArabic
                        ? `   🎨 الألوان: ${p.colors.join('، ')}\n`
                        : `   🎨 Colors: ${p.colors.join(', ')}\n`;
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
                arColorSizeRules += '- 🚨 هذا المنتج فيه ألوان متعددة! إذا لم يختار العميل لوناً → يجب أن تسأله عن اللون المفضل قبل إتمام الطلب (اعرض الألوان المتاحة من بيانات المنتج)\n';
                enColorSizeRules += '- 🚨 This product has multiple colors! If customer hasn\'t chosen one → you MUST ask for their preferred color before completing the order (show available colors from product data)\n';
            }
            if (hasSizes) {
                arColorSizeRules += '- 🚨 هذا المنتج فيه مقاسات متعددة! إذا لم يختار العميل مقاساً → يجب أن تسأله عن المقاس المفضل قبل إتمام الطلب (اعرض المقاسات المتاحة من بيانات المنتج)\n';
                enColorSizeRules += '- 🚨 This product has multiple sizes! If customer hasn\'t chosen one → you MUST ask for their preferred size before completing the order (show available sizes from product data)\n';
            }
            arColorSizeRules += '- 🚨 لا تؤكد الطلب نهائياً إلا بعد اختيار ' + (hasColors && hasSizes ? 'اللون والمقاس' : hasColors ? 'اللون' : 'المقاس') + '\n';
            arColorSizeRules += '- إذا كل المعلومات مكتملة (اسم + هاتف + عنوان + منتج' + (hasColors ? ' + اللون' : '') + (hasSizes ? ' + المقاس' : '') + ') → أكد الطلب مباشرة 🎉\n';
            enColorSizeRules += '- 🚨 NEVER confirm an order without ' + (hasColors && hasSizes ? 'color and size' : hasColors ? 'color' : 'size') + ' selection\n';
            enColorSizeRules += '- If all info complete (name + phone + address + product' + (hasColors ? ' + color' : '') + (hasSizes ? ' + size' : '') + ') → confirm order directly 🎉\n';
        } else {
            arColorSizeRules = '- ⚠️ هذا المنتج ليس فيه ألوان ولا مقاسات. لا تسأل العميل عن لون أو مقاس نهائياً!\n- إذا كل المعلومات مكتملة (اسم + هاتف + عنوان + منتج) → أكد الطلب مباشرة 🎉\n';
            enColorSizeRules = '- ⚠️ This product does NOT have colors or sizes. Do NOT ask the customer about color or size at all!\n- If all info complete (name + phone + address + product) → confirm order directly 🎉\n';
        }

        const userPrompt = isArabic
            ? `المرحلة الحالية: ${this.state.currentConversationStage}

المعلومات المجمعة حتى الآن: ${collectedSummary || 'لا يوجد'}

${productContext || 'لا توجد منتجات في السياق.'}
${toolContext}

تاريخ المحادثة:
${conversationHistoryText || 'هذه أول رسالة'}

رسالة العميل الحالية: "${messageText}"

📝 تعليمات مهمة:
- إذا العميل قدم اسماً أو هاتفاً أو عنواناً → اشكره وأكد الاستلام ثم اسأل عن المعلومة التالية المفقودة أو أكد الطلب
- في **extracted_info**: املأ الحقول من **تاريخ المحادثة والرسالة الحالية معاً** (اسم، هاتف، عنوان، لون، مقاس، منتج). لا تقتصر على الرسالة الحالية فقط؛ إذا لم يُذكر حقل في أي منهما استخدم null.
- 📸 الصور: «صورة متوفرة» داخلية فقط. استخدم next_action="send_image" وامدح المنتج باختصار فقط إذا الرسالة الحالية طلبت صورة صراحةً (صورة/وريني/فرجيني/ارني). ممنوع قول «تفضل الصورة» أو الادعاء أن صورة أُرسلت إذا لم يطلبها. سؤال السعر/المواصفات → أجب دون ذكر صورة.

🧭 سياسة استخدام المنتجات والكتالوج:
- ركّز ردودك التفصيلية على **🎯 المنتج النشط** (السعر، الألوان، المقاسات، الوصف).
- إذا سأل العميل عن منتج آخر أو تصنيف آخر أو "غيره" أو "شو كمان" → اعتمد على **📚 نظرة عامة على الكتالوج** للإجابة بصدق ودون اختلاق، واقترح عليه أبرز خيار مناسب من القائمة.
- لا تقل أبداً "ليس لدينا" إذا كان المنتج موجوداً في النظرة العامة للكتالوج.
- لا تعرض القائمة الكاملة للكتالوج للعميل دفعة واحدة؛ اقترح 1-3 خيارات فقط من النظرة العامة.
- لا تخلط بيانات منتجين مختلفين (لا تنسخ سعر منتج إلى آخر).
${arColorSizeRules}- عند ذكر السعر استخدم **اسم العملة الخاص بكل منتج** كما هو مذكور بجواره (لا تستبدل عملة منتج بأخرى)
- لا تختلق معلومات
- كن متحمساً ومحترفاً
- اجعل الرد مختصراً (2-4 جمل)

أعد ردك كالتالي (JSON):
{
  "response_text": "ردك المباشر للعميل",
  "next_action": "greet | discover_needs | present_product | handle_objection | close_sale | collect_info | confirm_order | send_image | end_conversation",
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
- If customer provided name/phone/address → acknowledge, then ask for next missing info or confirm order
- In **extracted_info**: fill fields from **conversation history AND the current message** (name, phone, address, color, size, product). Do not only read the latest turn; use null for fields not stated anywhere.
- 📸 Images: "Image available" is internal only. Use next_action="send_image" and briefly praise the product only if the current message explicitly asks for a photo (photo/image/show me/picture). Never say "Here's the photo!" or claim a photo was sent if they did not ask. Price/specs questions → answer with no photo mention.

🧭 Product & catalog policy:
- Keep detailed follow-up focused on the **🎯 active product** (price, options, stock, description).
- If customer asks for alternatives, categories, "other products", or "what else" → use the **📚 catalog overview** to answer truthfully and suggest 1-3 relevant options.
- Never say "we don't have it" if that product exists in the catalog overview.
- Do not dump the entire catalog to the customer unless explicitly requested.
- Never mix facts between products (e.g., wrong price/currency copied from another item).
${enColorSizeRules}- Use the **product-specific currency name** shown next to each item (never replace one product's currency with another).
- Never invent information
- Be enthusiastic and professional
- Keep response short (2-4 sentences)

Respond as JSON:
{
  "response_text": "your direct response to the customer",
  "next_action": "greet | discover_needs | present_product | handle_objection | close_sale | collect_info | confirm_order | send_image | end_conversation",
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
            maxOutputTokens: 600
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
            /^(نعم|اي|أي)\s+(أكد|اكد|نفذ)/i
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
                return { intent: 'order', nextAction: 'confirm_order' };
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
