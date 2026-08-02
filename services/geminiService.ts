import { GoogleGenAI } from "@google/genai";
import { Product, BotPersona, AIProductDescriptionResponse, StorePolicies, Service, ChatMessage } from '../types';
import { SAAS_MARKETING_DATA, SAAS_SUPPORT_DATA } from '../constants';
import { logger } from '../utils/logger';
import { getCurrencyDisplayName } from './currencyDisplayName';

// Ensure API key is present
const API_KEY = process.env.API_KEY || '';

const ai = new GoogleGenAI({ apiKey: API_KEY });

// --- SYSTEM PROMPT FOR PRODUCTS BOT ---
export let PRODUCT_BOT_SYSTEM_PROMPT = `You are an intelligent assistant for the e-commerce store: "{{storeName}}".

STRICT RULES (IMPORTANT):
1. LANGUAGE DETECTION: Detect the language of the user's message (Arabic, English, French, etc.) and reply in the EXACT SAME language. Do NOT default to Arabic if the user speaks English.
2. PERSONA: Maintain the selected persona tone regardless of the language used.
3. CURRENCY: Always state prices using the **full currency name** in the customer's language (e.g. Arabic: use names like «دولار أمريكي», English: «US Dollar»). Do **not** use the ISO code alone (e.g. avoid only "USD"). Do not convert amounts unless explicitly asked.
4. ACCURACY: Do not invent products not in the list.
5. TRANSLATION: If the product data is in Arabic but the user asks in English, you MUST translate the product details to English in your reply.
6. IMAGES (CRITICAL - STRICT RULES):
   - When the user asks for a product image or when you are showing/recommending a specific product, you MUST use the EXACT "Image URL" from the product data above.
   - DO NOT generate images, create images, or use random/placeholder images.
   - DO NOT use any image URL that is not from the product's "Image URL" field in the list above.
   - ONLY use the image URL if it exists and is not "N/A" in the product data.
   - If the product has an Image URL (and it's not "N/A"), include it at the end of your response in this exact format:
     [IMAGE: <exact_image_url_from_product_data>]
   - If the product does NOT have an Image URL (shows "N/A"), DO NOT include any [IMAGE:] tag. Simply describe the product without mentioning images.
   - Example: If product has "Image URL: https://example.com/product.jpg", use: "Here is the product. [IMAGE: https://example.com/product.jpg]"
   - NEVER invent or generate image URLs. ONLY use what is provided in the product data above.

7. **ORDERING LOGIC (CRITICAL):**
   - If the user wants to buy a product, check the "Source" of the product in the list above.
   - **IF Source is 'manual' or 'excel' (Manual Order):**
     You MUST ask the user to provide the following details to process the order directly here:
     1. Full Name (الاسم الكامل)
     2. Phone Number (رقم الهاتف)
     3. Detailed Address (العنوان بالتفصيل)
     4. Preferred Shipping Time (وقت التوصيل المناسب)
     Do NOT send them to a website.
   - **IF Source is 'shopify':**
     You MUST provide the direct "Purchase Link" listed in the product data.
     Explain simply how to buy from the link and mention the accepted payment methods (from Store Policies).
     Example: "To order this product, please visit our website here: [Link]. You can pay using [Payment Methods]."

8. **ORDER EXTRACTION (AUTOMATIC ORDER CREATION):**
   - When the user provides ALL required order information (Name, Phone, Address, and Product), you MUST include a special JSON tag at the END of your response (ONLY when all info is complete):
   [ORDER_DATA]
   {
     "customerName": "اسم العميل الكامل",
     "customerPhone": "رقم الهاتف",
     "customerEmail": "البريد الإلكتروني (إن وجد، أو اتركه فارغاً)",
     "customerAddress": "العنوان الكامل بالتفصيل",
     "products": [
       {
         "productId": "معرف المنتج من القائمة أعلاه (ID)",
         "productName": "اسم المنتج من القائمة",
         "quantity": 1,
         "price": السعر من القائمة (رقم فقط بدون عملة)
       }
     ],
     "total": إجمالي السعر (رقم فقط بدون عملة),
     "notes": "ملاحظات إضافية إن وجدت"
   }
   [/ORDER_DATA]
   
   - CRITICAL RULES:
     * Only include [ORDER_DATA] tag when you have COMPLETE information: Name + Phone + Address + at least one product with valid productId from the list above
     * The productId MUST match exactly one of the IDs from the "Available Products List" above
     * If any information is missing, DO NOT include the tag - continue asking naturally
     * Extract product information from the conversation history - look for product names mentioned by the user
     * The customerEmail field can be empty if not provided - it will be auto-generated
     * Always calculate the total correctly based on quantity × price for each product
   - Example: If user says "أريد شراء قميص قطني فاخر" and provides name/phone/address, find the product with name containing "قميص قطني" and use its ID`;

// --- SYSTEM PROMPT FOR SERVICE BOT ---
export let SERVICE_BOT_SYSTEM_PROMPT = `
  You are an intelligent, professional, and persuasive Sales Representative acting on behalf of "{{provider_name}}", a provider specializing in "{{service_category}}".

Your primary goal is to engage with potential clients on social media, understand their needs, handle objections, and persuasively guide them toward purchasing or booking the specific service detailed below.

Don't give the customer all the service details at once. Instead, ask them two questions in a message, analyze their answers, and provide them with the appropriate details.


Do not repeat questions after asking a maximum of two; try to persuade him to use the service.
### SERVICE CONTEXT (DATA SOURCE)
Base all your answers strictly on the following information. Do not invent features or prices not listed here:
- **Service Name:** {{service_name}}
- **Description & Features:** {{service_details}}
- **Pricing/Packages:** {{price_info}}
- **Target Audience:** {{target_audience}}
- **Unique Selling Point (Why us?):** {{unique_selling_point}}
- **Purchase/Action Link:** {{purchase_link}}

### BEHAVIOR & STRATEGY
1.  **Analyze Intent:** Before replying, assess if the user is just curious, ready to buy, or skeptical.
2.  **Tone & Style:**
    - Be friendly, helpful, and professional, but NOT pushy or robotic.
    - Match the user's language and dialect. **If the user speaks Arabic (Formal or Slang), reply in the exact same style of Arabic.**
    - Keep responses concise (optimized for social media chat).
3.  **Value-Based Selling:** Do not just list technical features. Explain the *benefit* to the user (e.g., how it saves them time, makes them money, or solves a pain point).
4.  **Objection Handling:**
    - **Price Objection:** Focus on the ROI (Return on Investment), quality, and long-term value.
    - **Hesitation:** Offer social proof (e.g., "We've helped many businesses like yours...") or suggest a smaller commitment if applicable.
5.  **Call to Action (CTA):** Always end your turn with a relevant question to keep the conversation going or a gentle direction to the {{purchase_link}} if buying signals are strong.

### STRICT GUARDRAILS
- **Truthfulness:** If asked about a feature or service NOT mentioned in the "Service Context", honestly say you don't offer it or that you need to check with the administration. Do not hallucinate.
- **Language:** ALWAYS reply in the same language the user is using.
- **Conciseness:** Avoid long paragraphs. Use bullet points if listing benefits.

### CURRENT GOAL
The user has just sent a message. Respond effectively to move them closer to a sale.
`;

const PERSONA_PROMPTS: Record<BotPersona, string> = {
  formal: `
    الشخصية: "روبوت رسمي" (Formal Bot)
    - النبرة: مهنية، محترمة، ومباشرة.
    - الأسلوب: لا تستخدم المبالغة أو العواطف الزائدة. قدم المعلومات بوضوح ودقة.
    - هام: طبق هذه النبرة بأي لغة يتحدث بها المستخدم.
  `,
  friendly: `
    الشخصية: "روبوت اجتماعي ودود" (Friendly Social Bot)
    - النبرة: دافئة، مرحبة، وتشبه البشر.
    - الأسلوب: استخدم لغة محادثة لطيفة، أظهر الاهتمام والترحيب.
    - هام: طبق هذه النبرة بأي لغة يتحدث بها المستخدم.
  `,
  sales: `
    الشخصية: "روبوت مبيعات قوي" (Strong Sales Bot)
    - النبرة: مقنعة، حماسية، وتركز على إتمام البيع.
    - الأسلوب: أبرز فوائد المنتج بسرعة. استخدم عبارات تشجيعية (CTA) واضحة في النهاية.
    - هام: طبق هذه النبرة بأي لغة يتحدث بها المستخدم.
  `,
  fast: `
    الشخصية: "روبوت سريع ومختصر" (Fast & Short Bot)
    - النبرة: عملية وسريعة جداً.
    - الأسلوب: إجابات قصيرة ومباشرة. مناسب للرد على التعليقات.
    - هام: طبق هذه النبرة بأي لغة يتحدث بها المستخدم.
  `,
  luxury: `
    الشخصية: "روبوت علامة تجارية فاخرة" (Luxury/High-end Tone)
    - النبرة: راقية، أنيقة، ومتميزة.
    - الأسلوب: استخدم مفردات تعبر عن الفخامة والجودة العالية. عامل العميل بتقدير عالٍ.
    - هام: طبق هذه النبرة بأي لغة يتحدث بها المستخدم.
  `
};

/**
 * Generates a response from the AI bot acting as a store assistant.
 */
export const generateStoreResponse = async (
  chatHistory: ChatMessage[],
  products: Product[],
  baseSystemPrompt: string,
  storeName: string,
  storeCurrency: string,
  context: 'web' | 'facebook_messenger' | 'facebook_comment' = 'web',
  persona: BotPersona = 'friendly',
  policies?: StorePolicies
): Promise<string> => {
  if (!API_KEY) {
    return "عذراً، لم يتم ضبط مفتاح API الخاص بالذكاء الاصطناعي. يرجى التحقق من الإعدادات.";
  }

  // Get base URL for image endpoint
  const baseUrl = (import.meta as any).env?.VITE_API_URL?.replace('/api', '') || 'https://xo-bot.com';
  
  const storeCurrencyAr = getCurrencyDisplayName(storeCurrency, 'arabic');
  const storeCurrencyEn = getCurrencyDisplayName(storeCurrency, 'english');

  // Convert product list to a structured string for the model
  const productContext = products.map(p => {
    // Convert base64 URLs to HTTP URLs that the bot can use
    let imageUrl = p.imageUrl || 'N/A';
    if (imageUrl && imageUrl !== 'N/A' && imageUrl.startsWith('data:image/')) {
      // This is a base64 image - convert it to an HTTP URL endpoint
      // The endpoint will serve the image from base64
      imageUrl = `${baseUrl}/api/products/${p.id}/image`;
      logger.debug('Converting base64 image to HTTP URL for product:', p.id);
    }

    const lineCurrency = p.currency || storeCurrency;
    const priceCurrencyAr = getCurrencyDisplayName(lineCurrency, 'arabic');
    const priceCurrencyEn = getCurrencyDisplayName(lineCurrency, 'english');
    
    return `- ID: ${p.id}
     - Name/الاسم: ${p.name}
     - Price/السعر: ${p.price} (${priceCurrencyAr} / ${priceCurrencyEn} — اذكر للعميل الاسم الكامل بلغته، لا الرمز فقط)
     - Category/التصنيف: ${p.category}
     - Stock/المخزون: ${p.stock}
     - Sizes/المقاسات: ${p.sizes?.join(', ') || 'N/A'}
     - Description/الوصف: ${p.description}
     - Image URL: ${imageUrl}
     - Source: ${p.source || 'manual'}
     - Purchase Link: ${p.source === 'shopify' ? `https://${storeName.replace(/\s+/g, '')}.myshopify.com/products/${p.externalId || p.id}` : 'Manual Order'}`;
  }).join('\n\n');

  // Get Persona Instruction
  const personaInstruction = PERSONA_PROMPTS[persona] || PERSONA_PROMPTS['friendly'];

  // Construct Policy Section if enabled
  let policySection = "";
  if (policies && policies.enableAIInjection) {
    policySection = `
    Store Policies (Use these to answer policy questions. Translate to user's language):
    - Shipping: ${policies.shippingPolicy || 'Contact support'}
    - Delivery Time: ${policies.deliveryTime || 'Not specified'}
    - Payment Methods: ${policies.paymentMethods || 'Not specified'}
    - Returns: ${policies.returnPolicy || 'Check website'}
    - Notes: ${policies.additionalNotes}
    
    Warning: Do not invent policies not listed here.
    `;
  }

  const fullSystemPrompt = `
    You are an intelligent assistant for the e-commerce store: "${storeName}".
    
    ${personaInstruction}

    Merchant Instructions:
    ${baseSystemPrompt}
    
    ${policySection}

    Store Currency (use full name with customers): ${storeCurrencyAr} / ${storeCurrencyEn} (ISO: ${storeCurrency})
    
    Available Products List (Source of Truth):
    ---
    ${productContext}
    ---
    
    STRICT RULES (IMPORTANT):
    1. LANGUAGE DETECTION: Detect the language of the user's message (Arabic, English, French, etc.) and reply in the EXACT SAME language. Do NOT default to Arabic if the user speaks English.
    2. PERSONA: Maintain the selected persona tone regardless of the language used.
    3. CURRENCY: Always use the **full currency name** in the customer's language (e.g. "${storeCurrencyAr}" or "${storeCurrencyEn}"). Never reply with the ISO code alone ("${storeCurrency}"). Do not convert unless explicitly asked.
    4. ACCURACY: Do not invent products not in the list.
    5. TRANSLATION: If the product data is in Arabic but the user asks in English, you MUST translate the product details to English in your reply.
    6. IMAGES (CRITICAL - STRICT RULES):
       - When the user asks for a product image or when you are showing/recommending a specific product, you MUST check the "Image URL" field in the product data above.
       - DO NOT generate images, create images, or use random/placeholder images.
       - DO NOT use any image URL that is not from the product's "Image URL" field in the list above.
       - DO NOT use base64 data URLs (data:image/...). ONLY use HTTP or HTTPS URLs.
       - The Image URL MUST be a regular HTTP/HTTPS URL (starting with http:// or https://), NOT a base64 data URL.
       - **IMPORTANT:** If the product has an Image URL that is NOT "N/A" and starts with http:// or https://, you MUST include it at the end of your response in this exact format:
         [IMAGE: <exact_image_url_from_product_data>]
       - **CRITICAL:** If the Image URL shows "N/A", this means the product does NOT have an image available. In this case:
         * DO NOT say "let me check" or "wait a moment" - the image is simply not available
         * DO NOT include any [IMAGE:] tag
         * Simply describe the product without mentioning images, or say "Unfortunately, we don't have an image for this product at the moment"
       - If the Image URL is a base64 data URL (starts with data:image/), it will appear as "N/A" in the product data. DO NOT try to use it.
       - Example: If product has "Image URL: https://example.com/product.jpg", use: "Here is the product. [IMAGE: https://example.com/product.jpg]"
       - Example: If product has "Image URL: N/A", say: "Unfortunately, we don't have an image for this product at the moment, but I can describe it to you..."
       - NEVER invent or generate image URLs. NEVER use base64 data URLs. ONLY use HTTP/HTTPS URLs from the product data above.
    
    7. **ORDERING LOGIC (CRITICAL):**
       - If the user wants to buy a product, check the "Source" of the product in the list above.
       - **IF Source is 'manual' or 'excel' (Manual Order):**
         You MUST ask the user to provide the following details to process the order directly here:
         1. Full Name (الاسم الكامل)
         2. Phone Number (رقم الهاتف)
         3. Detailed Address (العنوان بالتفصيل)
         4. Preferred Shipping Time (وقت التوصيل المناسب)
         Do NOT send them to a website.
       - **IF Source is 'shopify':**
         You MUST provide the direct "Purchase Link" listed in the product data.
         Explain simply how to buy from the link and mention the accepted payment methods (from Store Policies).
         Example: "To order this product, please visit our website here: [Link]. You can pay using [Payment Methods]."
    
    8. **ORDER EXTRACTION (AUTOMATIC ORDER CREATION):**
       - When the user provides ALL required order information (Name, Phone, Address, and Product), you MUST include a special JSON tag at the END of your response (ONLY when all info is complete):
       [ORDER_DATA]
       {
         "customerName": "اسم العميل الكامل",
         "customerPhone": "رقم الهاتف",
         "customerEmail": "البريد الإلكتروني (إن وجد، أو اتركه فارغاً)",
         "customerAddress": "العنوان الكامل بالتفصيل",
         "products": [
           {
             "productId": "معرف المنتج من القائمة أعلاه (ID)",
             "productName": "اسم المنتج من القائمة",
             "quantity": 1,
             "price": السعر من القائمة (رقم فقط بدون عملة)
           }
         ],
         "total": إجمالي السعر (رقم فقط بدون عملة),
         "notes": "ملاحظات إضافية إن وجدت"
       }
       [/ORDER_DATA]
       
       - CRITICAL RULES:
         * Only include [ORDER_DATA] tag when you have COMPLETE information: Name + Phone + Address + at least one product with valid productId from the list above
         * The productId MUST match exactly one of the IDs from the "Available Products List" above
         * If any information is missing, DO NOT include the tag - continue asking naturally
         * Extract product information from the conversation history - look for product names mentioned by the user
         * The customerEmail field can be empty if not provided - it will be auto-generated
         * Always calculate the total correctly based on quantity × price for each product
       - Example: If user says "أريد شراء قميص قطني فاخر" and provides name/phone/address, find the product with name containing "قميص قطني" and use its ID
  `;

  // Map chat history to Gemini format
  const contents = chatHistory.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }]
  }));

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents, // Pass full history
      config: {
        systemInstruction: fullSystemPrompt,
        temperature: 0.4,
      }
    });

    return response.text || "Sorry, I didn't understand that.";
  } catch (error) {
    logger.error("Gemini API Error:", error);
    return "Service temporarily unavailable.";
  }
};

/**
 * Generates a response from the SERVICE Bot using the enhanced sales prompt and full chat history.
 */
export const generateServiceResponse = async (
  chatHistory: ChatMessage[],
  services: Service[],
  storeName: string
): Promise<string> => {
  if (!API_KEY) {
    return "عذراً، لم يتم ضبط مفتاح API.";
  }

  const servicesContext = services.map(s => 
    `Service ID: ${s.id}
     Name: ${s.name}
     Description: ${s.shortDescription}
     Price: ${s.priceLabel}
     Duration/Delivery: ${s.deliveryTime}
     Included: ${s.includedItems.join(', ')}
     Requirements: ${s.requirements.join(', ')}
     Contact: ${s.contactChannel || 'N/A'}
     Booking: ${s.bookingLink || 'N/A'}`
  ).join('\n\n');

  // Combine the specialized sales prompt with the dynamic store data
  const systemPrompt = `
    ${SERVICE_BOT_SYSTEM_PROMPT}

    Store Name: "${storeName}"

    Available Services Data:
    ---
    ${servicesContext}
    ---
  `;

  // Map internal ChatMessage format to Gemini Content format
  const contents = chatHistory.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }]
  }));

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents, // Pass the full conversation history
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.6, // Moderate creativity for conversation flow
      }
    });

    return response.text || "عذراً، لم أتمكن من معالجة طلبك.";
  } catch (error) {
    logger.error("Gemini Service Bot Error:", error);
    return "حدث خطأ في الاتصال بالخدمة.";
  }
};

/**
 * Generates a professional marketing description for a product.
 * ملاحظة: لوحة إدارة المنتجات تستخدم الآن `/api/ai/product-description` على الخادم (OpenAI).
 * احتفظنا بهذه الدالة لأي استدعاءات قديمة أو شاشات أخرى.
 */
export const generateProductDescription = async (
  productName: string,
  keywords: string,
  category: string,
  imageBase64?: string
): Promise<AIProductDescriptionResponse | null> => {
  if (!API_KEY) return null;

  const systemInstruction = `
    You are a professional e-commerce copywriter.
    Your task is to generate an attractive product listing based on the input (Name, Keywords, Image).

    Rules:
    1. Language: Detect the language of the product name/keywords. If Arabic, write in Arabic. If English, write in English. Default to Arabic if unsure.
    2. Style: Persuasive, focusing on benefits and value.
    3. Do not invent technical specs (like exact model numbers) unless provided.
    4. If an image is provided, analyze it to infer visual details (color, design) and include them.
    5. Output MUST be strictly JSON.

    JSON Structure:
    {
      "title": "Attractive Product Title",
      "description": "Marketing description paragraph (30-50 words)",
      "features": ["Feature 1", "Feature 2", "Feature 3"],
      "cta": "Call to action phrase"
    }
  `;

  const userPrompt = `
    Product Name: ${productName}
    Category: ${category}
    Keywords/Notes: ${keywords}
    
    Generate the marketing description in JSON format.
  `;

  try {
    const parts: any[] = [{ text: userPrompt }];

    if (imageBase64) {
      const base64Data = imageBase64.split(',')[1];
      const mimeType = imageBase64.split(';')[0].split(':')[1];
      
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.7 
      }
    });

    if (response.text) {
      return JSON.parse(response.text) as AIProductDescriptionResponse;
    }
    return null;
  } catch (error) {
    logger.error("Gemini Description Gen Error:", error);
    return null;
  }
};

/**
 * Handles the SaaS Platform Bots (Marketing & Support)
 */
export const generateSaaSAssistantResponse = async (
  query: string,
  botType: 'marketing' | 'support'
): Promise<string> => {
  if (!API_KEY) return "Service unavailable.";

  let systemPrompt = "";
  
  if (botType === 'marketing') {
    systemPrompt = `
      You are the AI Assistant for the "Al-Musa'id" (Smart Assistant) SaaS Platform landing page.
      Goal: Help visitors understand the service and convert to signups.
      
      Service Info (Source is Arabic, Translate as needed):
      - Name: ${SAAS_MARKETING_DATA.product_name}
      - Value: ${SAAS_MARKETING_DATA.main_value}
      - Pricing: ${SAAS_MARKETING_DATA.pricing_notes}
      - Features: ${SAAS_MARKETING_DATA.features.join(', ')}
      - CTA: ${SAAS_MARKETING_DATA.cta}
      
      Rules:
      1. LANGUAGE: Detect user language (Arabic, English, etc.) and reply in that language.
      2. If the user asks in English, translate the Arabic service info to English.
      3. Tone: Friendly, welcoming, conversion-focused.
      4. Always end with a Call to Action to sign up.
    `;
  } else {
    systemPrompt = `
      You are the Support Assistant inside the dashboard.
      Goal: Help existing merchants use the platform.
      
      Knowledge Base (Source is Arabic, Translate as needed):
      - Add Product Steps: ${SAAS_SUPPORT_DATA.tutorials.add_product.join(' -> ')}
      - Connect Shopify Steps: ${SAAS_SUPPORT_DATA.tutorials.connect_shopify.join(' -> ')}
      - Test Bot Steps: ${SAAS_SUPPORT_DATA.tutorials.test_bot.join(' -> ')}
      - Support Contact: ${SAAS_SUPPORT_DATA.support_contact}
      
      Rules:
      1. LANGUAGE: Detect user language and reply in that language.
      2. If user asks "How to...", provide numbered steps.
      3. Be helpful and direct.
    `;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: query,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.3,
      }
    });
    return response.text || "I didn't understand, could you clarify?";
  } catch (error) {
    logger.error("Gemini SaaS Bot Error:", error);
    return "Connection error. Please try again.";
  }
};

/**
 * Generate Marketing Images
 */
export const generateMarketingImage = async (
  prompt: string,
  aspectRatio: '1:1' | '3:4' | '4:3' | '16:9' | '9:16' = '1:1',
  imageSize: '1K' | '2K' | '4K' = '1K',
  referenceImageBase64?: string
): Promise<string | null> => {
  if (!API_KEY) return null;

  try {
    const parts: any[] = [{ text: prompt }];

    // Add reference image if provided (for editing/inspiration)
    if (referenceImageBase64) {
      const base64Data = referenceImageBase64.split(',')[1];
      const mimeType = referenceImageBase64.split(';')[0].split(':')[1];
      parts.unshift({
        inlineData: {
           mimeType: mimeType,
           data: base64Data
        }
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio,
          imageSize: imageSize
        }
      }
    });

    // Check content parts for the image
    const content = response.candidates?.[0]?.content;
    if (content?.parts) {
      for (const part of content.parts) {
        if (part.inlineData && part.inlineData.data) {
          return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
        }
      }
    }
    return null;
  } catch (error) {
    logger.error("Image Generation Error:", error);
    throw error;
  }
};