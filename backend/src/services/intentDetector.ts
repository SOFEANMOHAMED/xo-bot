import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { getMerchantProductKeywords } from './tools/catalogTool.js';

const API_KEY = process.env.OPENAI_API_KEY || '';
const DEFAULT_MODEL = 'gpt-4o-mini';
const ai = API_KEY ? new OpenAI({ apiKey: API_KEY }) : null;

export interface IntentDetectionResult {
  intent: 'greeting' | 'browse' | 'product_query' | 'price' | 'availability' | 'shipping' | 'comparison' | 'order' | 'complaint' | 'other';
  stage: 'discover' | 'offer' | 'objection' | 'close' | 'handoff' | 'clarify';
  objection: 'price' | 'trust' | 'shipping' | 'quality' | 'none' | null;
  entities: {
    product_query?: string;
    product_id?: string;
    city?: string;
    budget?: string;
    size?: string;
    color?: string;
    quantity?: number;
    wants_image?: boolean; // User requested product image
    wants_catalog?: boolean; // User wants to see available products
  };
  missing_fields: string[];
  confidence: number;
  detectedLanguage?: 'arabic' | 'english' | 'mixed';
}

export interface DetectIntentParams {
  messageText: string;
  recentMessages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  conversationState?: Record<string, any>;
  platform?: string;
  locale?: string;
  merchantId?: string; // Required for SaaS - to fetch merchant-specific product keywords
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ==================== AI-ONLY DETECTION ====================

/**
 * System prompt for intent and entity extraction
 * MUST return JSON only, no prose, no markdown
 */
const INTENT_DETECTION_PROMPT = `You are an intent and entity extraction system for an e-commerce chatbot.

Your task:
1. Detect user intent from the message
2. Extract entities (product_query, product_id, city, budget, size, color, quantity, wants_image, wants_catalog)
3. Determine conversation stage
4. Identify objections if any
5. List missing fields required to complete an order (MANDATORY - see rules below)
6. Estimate confidence (0.0 to 1.0)
7. Detect user language (arabic | english | mixed)

CRITICAL RULES:
- You MUST return ONLY valid JSON, no markdown, no prose, no explanations
- Use double quotes for JSON strings
- All values must be strings, numbers, arrays, or null
- confidence must be a number between 0.0 and 1.0

Valid intents: greeting, browse, product_query, price, availability, shipping, comparison, order, complaint, other
Valid stages: discover, offer, objection, close, handoff, clarify
Valid objections: price, trust, shipping, quality, none (or null)
Valid languages: arabic, english, mixed

HARD RULES FOR INTENT:
- **GREETING DETECTION (CRITICAL):** Use intent "greeting" ONLY if the message is purely a greeting and has NO request.
  - If the message contains any request (buying, price, image, catalog, availability, order, comparison), it is NOT greeting.
  - Examples (greeting only): "مرحبا", "أهلاً", "سلام", "hello", "hi", "صباح الخير", "مساء الخير".
- If greeting + request together, choose the request intent (not greeting).
- If the user asks to see products (even with greeting), intent MUST be "browse" and entities.wants_catalog = true.
- If user is angry/complaining -> intent: "complaint", stage: "handoff"
- If user asks about price -> intent: "price", stage: "offer"
- If user wants to buy -> intent: "order", stage: "close"
- If user compares products -> intent: "comparison", stage: "offer"
- If user asks about availability/stock -> intent: "availability", stage: "offer"
- If user asks to see products/catalog (what do you have, show me products, etc.) -> intent: "browse", stage: "discover", entities.wants_catalog: true
- If user mentions a product name -> intent: "product_query", extract it to product_query
- If user asks for a product image/photo -> intent: "product_query" and entities.wants_image: true

HARD RULES FOR ENTITIES:
- **product_query**: Extract ANY product name mentioned by user
- **product_id**: Only extract if explicitly mentioned (DO NOT invent)
- **city**: Extract city names
- **budget**: Extract numbers with currency keywords
- **quantity**: Extract numbers with quantity keywords
- **size, color**: Extract if mentioned
- **wants_image**: true if user asks for an image/photo
- **wants_catalog**: true if user wants to see products/options/recommendations

MANDATORY RULES FOR MISSING_FIELDS (CRITICAL):
- **missing_fields** MUST be an array of strings, NEVER null or undefined
- **For ANY order intent (intent="order" or stage="close"):** You MUST analyze the ENTIRE conversation history to determine which mandatory fields are missing
- **The 4 MANDATORY fields for completing any order are:**
  1. "الاسم الكامل" (Full Name) - Required if no full name (first + last name or at least 2 words) found in conversation history
  2. "رقم الهاتف" (Phone Number) - Required if no phone number (9+ digits, may include country code) found in conversation history
  3. "العنوان بالتفصيل" (Detailed Address) - Required if address is missing OR incomplete (see strict address rules below)
  4. "الوقت المناسب للتوصيل" (Delivery Time) - Required if no delivery time/date mentioned in conversation history

- **STRICT ADDRESS VALIDATION RULES:**
  - An address is considered COMPLETE ONLY if it contains BOTH:
    a) A neighborhood/area name (المنطقة، الحي، الضاحية، etc.) OR a street name (الشارع، طريق، etc.)
    b) Additional details (building number, floor, apartment, landmarks, etc.)
  - Examples of INCOMPLETE addresses (MUST be in missing_fields):
    - "دمشق" (only city name)
    - "حلب" (only city name)
    - "سوريا" (only country name)
    - "في البيت" (too vague)
    - "عندي" (too vague)
  - Examples of COMPLETE addresses (NOT in missing_fields):
    - "دمشق، المزة، شارع بغداد، مبنى 5، الطابق الثاني"
    - "حلب، شارع الجامعة، قرب المدرسة"
    - "المنطقة الشرقية، شارع الرئيسي، رقم 12"

- **ANALYZING CONVERSATION HISTORY:**
  - You MUST read through ALL messages in the conversation history (both user and assistant messages)
  - Extract information from ANYWHERE in the history, not just the current message
  - If a field was mentioned earlier in the conversation, it is NOT missing
  - Only include a field in missing_fields if it was NEVER mentioned in the entire conversation history
  - Be precise: if the user said "اسمي أحمد" earlier, "الاسم الكامل" is NOT missing
  - If the user said "رقمي 0991234567" earlier, "رقم الهاتف" is NOT missing
  - If the user said "بكرا صباحاً" earlier, "الوقت المناسب للتوصيل" is NOT missing

- **For non-order intents:** missing_fields should be an empty array []

Example valid response for order with missing fields (JSON only):
{
  "intent": "order",
  "stage": "close",
  "objection": "none",
  "entities": {
    "product_query": "ساعة"
  },
  "missing_fields": ["رقم الهاتف", "العنوان بالتفصيل", "الوقت المناسب للتوصيل"],
  "confidence": 0.95,
  "detectedLanguage": "arabic"
}

Example valid response for order with all fields provided (JSON only):
{
  "intent": "order",
  "stage": "close",
  "objection": "none",
  "entities": {
    "product_query": "ساعة"
  },
  "missing_fields": [],
  "confidence": 0.95,
  "detectedLanguage": "arabic"
}`;

/**
 * Lightweight AI check for catalog intent (AI-only, no regex)
 * Returns { wants_catalog: boolean }
 */
const CATALOG_CHECK_PROMPT = `You are an intent checker.
Return ONLY JSON: {"wants_catalog": true/false}
Rules:
- true if the user wants to see products/options/what's available (directly or indirectly)
- false otherwise
Examples (true):
- "شو عندك منتجات؟"
- "بدي أشوف المتوفر"
- "فرجيني خيارات"
- "شو عندكم؟"
- "I want to see your products"
Examples (false):
- "السلام عليكم"
- "كم سعر الساعة؟"
- "بدي اطلب"
No other keys.`;

/**
 * Detect intent and extract entities using AI (channel-agnostic)
 * Enhanced for SaaS with dynamic product keyword detection
 * 
 * @param params - Detection parameters
 * @returns IntentDetectionResult with intent, entities, stage, etc.
 */
export const detectIntentAndEntities = async (
  params: DetectIntentParams
): Promise<IntentDetectionResult> => {
  const {
    messageText,
    recentMessages = [],
    conversationState = {},
    platform,
    locale,
    merchantId
  } = params;
  
  try {
    // Get merchant-specific product keywords (as AI hints only)
    let merchantKeywords: string[] = [];
    if (merchantId) {
      try {
        merchantKeywords = await getMerchantProductKeywords(merchantId);
      } catch (err) {
        logger.warn('Could not fetch merchant product keywords', { merchantId });
      }
    }

    if (!ai || !API_KEY) {
      logger.info('AI unavailable, using minimal fallback intent detection', {
        platform
      });
      return fallbackRuleBasedDetection(messageText, conversationState, recentMessages, []);
    }

    logger.info('Using AI intent detection', {
      platform
    });

    // Build context
    const historyContext = recentMessages
      .slice(-10)
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    const stateContext = conversationState.current_intent 
      ? `Previous intent: ${conversationState.current_intent}\n`
      : '';
    const stageContext = conversationState.stage
      ? `Current stage: ${conversationState.stage}\n`
      : '';
    const productIdContext = conversationState.last_recommended_products?.[0]
      ? `Last recommended product ID: ${conversationState.last_recommended_products[0]}\n`
      : '';

    const userPrompt = `Current message: "${messageText}"
${historyContext ? `\n**Conversation history (READ ALL MESSAGES CAREFULLY):**\n${historyContext}\n` : ''}
${stateContext}${stageContext}${productIdContext}
${platform ? `Platform: ${platform}\n` : ''}
${locale ? `Locale: ${locale}\n` : ''}
${merchantKeywords.length > 0 ? `Merchant product keywords (hints only): ${merchantKeywords.slice(0, 30).join(', ')}\n` : ''}

**IMPORTANT:** 
- If the message is a pure greeting with NO request -> intent "greeting"
- If the message includes any request (products, image, price, order, availability), it is NOT greeting
- If the user asks to see products/options -> intent "browse" and wants_catalog = true
- For product search, understand meaning semantically, not exact keywords
- Extract product names intelligently from context, even if not exact matches

**CRITICAL FOR MISSING_FIELDS:**
- If intent is "order" or stage is "close", you MUST analyze the ENTIRE conversation history above
- Check if the user provided: full name, phone number, detailed address (with neighborhood/street), delivery time
- Address is ONLY complete if it contains neighborhood/area name OR street name (not just city name)
- Only include fields in missing_fields if they were NEVER mentioned in the entire conversation history
- missing_fields MUST be an array (never null), use exact Arabic field names: "الاسم الكامل", "رقم الهاتف", "العنوان بالتفصيل", "الوقت المناسب للتوصيل"

Extract intent and entities. Return ONLY valid JSON.`;

    let response;
    let retries = 0;
    const maxRetries = 2;

    while (retries <= maxRetries) {
      try {
        response = await ai.chat.completions.create({
          model: DEFAULT_MODEL,
          messages: [
            { role: 'system', content: INTENT_DETECTION_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1
        });
        break;
      } catch (error: any) {
        if (retries < maxRetries) {
          const delay = error.code === 429 ? 5000 : 1000 * (retries + 1);
          await new Promise(r => setTimeout(r, delay));
          retries++;
          continue;
        }
        logger.error('Error calling AI for intent detection', error as Error);
        throw error;
      }
    }

    if (!response) {
      throw new Error('No response from AI');
    }

    // Extract JSON from response
    const responseText = response.choices?.[0]?.message?.content || '';
    let jsonText = responseText.trim();
    
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let result: IntentDetectionResult;
    try {
      result = JSON.parse(jsonText);
    } catch (parseError) {
      logger.error('Failed to parse AI response as JSON', parseError as Error);
      return fallbackRuleBasedDetection(messageText, conversationState, recentMessages, merchantKeywords);
    }

    // Validate and normalize
    result = validateAndNormalizeResult(result, conversationState);

    // ✅ AI-only secondary check: ensure catalog requests are not misclassified
    const shouldCatalogCheck =
      !result.entities?.wants_catalog &&
      !result.entities?.product_query &&
      !['order', 'price', 'availability', 'comparison'].includes(result.intent);

    if (shouldCatalogCheck && ai) {
      try {
        const catalogCheck = await ai.chat.completions.create({
          model: DEFAULT_MODEL,
          messages: [
            { role: 'system', content: CATALOG_CHECK_PROMPT },
            { role: 'user', content: `Message: "${messageText}"` }
          ],
          temperature: 0.0,
          max_tokens: 50
        });

        const checkText = (catalogCheck.choices?.[0]?.message?.content || '').trim()
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/, '');

        const checkJson = JSON.parse(checkText);
        if (checkJson?.wants_catalog === true) {
          result.intent = 'browse';
          result.stage = 'discover';
          result.entities = result.entities || {};
          result.entities.wants_catalog = true;
          logger.info('Catalog AI check: true (overrode intent)', { messageText });
        } else {
          logger.info('Catalog AI check: false', { messageText });
        }
      } catch (err) {
        logger.warn('Catalog AI check failed', { message: (err as Error).message });
      }
    }

    if (result.intent === 'complaint') {
      result.stage = 'handoff';
    }

    logger.info('Intent detection completed', {
      intent: result.intent,
      stage: result.stage,
      confidence: result.confidence,
      platform
    });

    return result;
  } catch (error) {
    logger.error('Error in detectIntentAndEntities', error as Error);
    return fallbackRuleBasedDetection(messageText, conversationState, recentMessages, []);
  }
};

/**
 * Validate and normalize AI result
 */
function validateAndNormalizeResult(
  result: any,
  conversationState: Record<string, any> = {}
): IntentDetectionResult {
  const validIntents: IntentDetectionResult['intent'][] = [
    'greeting', 'browse', 'product_query', 'price', 'availability', 
    'shipping', 'comparison', 'order', 'complaint', 'other'
  ];
  const validStages: IntentDetectionResult['stage'][] = [
    'discover', 'offer', 'objection', 'close', 'handoff', 'clarify'
  ];
  const validObjections: IntentDetectionResult['objection'][] = [
    'price', 'trust', 'shipping', 'quality', 'none', null
  ];

  let intent: IntentDetectionResult['intent'] = 'other';
  if (validIntents.includes(result.intent)) {
    intent = result.intent;
  }

  let stage: IntentDetectionResult['stage'] = 'discover';
  if (validStages.includes(result.stage)) {
    stage = result.stage;
  }

  let objection: IntentDetectionResult['objection'] = null;
  if (validObjections.includes(result.objection)) {
    objection = result.objection;
  } else if (typeof result.objection === 'string') {
    const objectionLower = result.objection.toLowerCase();
    if (objectionLower.includes('price') || objectionLower.includes('سعر')) {
      objection = 'price';
    } else if (objectionLower.includes('trust') || objectionLower.includes('ثقة')) {
      objection = 'trust';
    } else if (objectionLower.includes('shipping') || objectionLower.includes('شحن')) {
      objection = 'shipping';
    } else if (objectionLower.includes('quality') || objectionLower.includes('جودة')) {
      objection = 'quality';
    } else {
      objection = 'none';
    }
  }

  let product_id: string | undefined = undefined;
  if (result.entities?.product_id) {
    const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const externalIdPattern = /^[a-zA-Z0-9_-]+$/;
    if (idPattern.test(result.entities.product_id) || externalIdPattern.test(result.entities.product_id)) {
      product_id = result.entities.product_id;
    }
  }
  if (!product_id && conversationState.last_recommended_products?.[0]) {
    product_id = conversationState.last_recommended_products[0];
  }

  let detectedLanguage: IntentDetectionResult['detectedLanguage'] = undefined;
  if (result.detectedLanguage === 'arabic' || result.detectedLanguage === 'english' || result.detectedLanguage === 'mixed') {
    detectedLanguage = result.detectedLanguage;
  }

  const wantsCatalog = result.entities?.wants_catalog === true;
  const wantsImage = result.entities?.wants_image === true;

  if (intent === 'browse') {
    // Ensure browse implies wants_catalog
    result.entities = result.entities || {};
    result.entities.wants_catalog = true;
  }

  return {
    intent,
    stage,
    objection,
    entities: {
      product_query: result.entities?.product_query || undefined,
      product_id,
      city: result.entities?.city || undefined,
      budget: result.entities?.budget || undefined,
      size: result.entities?.size || undefined,
      color: result.entities?.color || undefined,
      quantity: typeof result.entities?.quantity === 'number' ? result.entities.quantity : undefined,
      wants_image: wantsImage ? true : undefined,
      wants_catalog: (intent === 'browse' || wantsCatalog) ? true : undefined
    },
    missing_fields: Array.isArray(result.missing_fields) ? result.missing_fields : [],
    confidence: typeof result.confidence === 'number' 
      ? Math.max(0, Math.min(1, result.confidence)) 
      : 0.5,
    detectedLanguage
  };
}

/**
 * Fast rule-based detection with dynamic merchant keywords
 * Supports SaaS multi-tenant with merchant-specific products
 */
function fallbackRuleBasedDetection(
  _messageText: string,
  _conversationState: Record<string, any> = {},
  _recentMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [],
  _merchantKeywords: string[] = []
): IntentDetectionResult {
  return {
    intent: 'other',
    stage: 'discover',
    objection: null,
    entities: {},
    missing_fields: [],
    confidence: 0.2
  };
}
