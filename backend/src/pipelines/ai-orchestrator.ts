/**
 * AI Orchestrator - Simple & Powerful
 * Full AI Mode with clear instructions
 */

import { generateJSON, trackAICall } from '../ai/gemini-client.js';
import type {
  Message,
  ConversationState,
  Product,
  Language,
  MerchantConfig,
  Intent,
  Stage
} from '../core/types.js';
import { logger } from '../utils/logger.js';
import { getCurrencyDisplayName } from '../utils/currencyDisplayName.js';

// ==================== TYPES ====================

export interface AIConversationContext {
  merchantId: string;
  storeName: string;
  messageText: string;
  recentMessages: Message[];
  conversationState: ConversationState;
  products: Product[];
  merchantConfig: MerchantConfig;
  language: Language;
}

export interface AIDecision {
  response_text: string;
  next_action: 'ask_color' | 'ask_size' | 'ask_address' | 'ask_phone' | 'ask_name' | 'confirm_order' | 'send_image' | 'recommend_products' | 'answer_question' | 'handoff';
  collected_info: {
    product_id?: string;
    product_name?: string;
    color?: string;
    size?: string;
    quantity?: number;
    address?: string;
    phone?: string;
    name?: string;
  };
  reasoning: string;
  intent: Intent;
  stage: Stage;
}

// ==================== PROMPT BUILDER ====================

const buildPrompt = (context: AIConversationContext): string => {
  const { storeName, messageText, recentMessages, products, merchantConfig, language } = context;
  
  // 🌐 Language support
  const isArabic = language === 'arabic';
  
  // Build conversation history
  const historyText = recentMessages
    .slice(-8)
    .map(m => `${m.role === 'user' ? (isArabic ? 'العميل' : 'Customer') : (isArabic ? 'أنت' : 'You')}: ${m.content}`)
    .join('\n');
  
  // Build product list with BEAUTIFUL formatting (Shopify variants support)
  const productList = products.length > 0
    ? products.map(p => {
        let info = `📦 **${p.name}**\n`;
        
        // 🎯 Smart Price Display (Shopify variants support) — اسم العملة وليس الرمز فقط
        const currencyCode = merchantConfig.storeCurrency || merchantConfig.currency || 'ILS';
        const currencyLabel = getCurrencyDisplayName(currencyCode, isArabic ? 'arabic' : 'english');
        if (p.has_variants && p.variants && p.variants.length > 1) {
          const prices = p.variants.map(v => v.price);
          const minPrice = Math.min(...prices);
          const maxPrice = Math.max(...prices);
          if (minPrice === maxPrice) {
            info += isArabic
              ? `   💰 السعر: ${minPrice} ${currencyLabel}\n`
              : `   💰 Price: ${minPrice} ${currencyLabel}\n`;
          } else {
            info += isArabic
              ? `   💰 السعر: من ${minPrice} إلى ${maxPrice} ${currencyLabel}\n`
              : `   💰 Price: ${minPrice} to ${maxPrice} ${currencyLabel}\n`;
          }
        } else {
          info += isArabic
            ? `   💰 السعر: ${p.price} ${currencyLabel}\n`
            : `   💰 Price: ${p.price} ${currencyLabel}\n`;
        }
        
        if (p.description) {
          info += `   📝 ${p.description.substring(0, 100)}${p.description.length > 100 ? '...' : ''}\n`;
        }
        
        // 🎯 Smart Stock Display
        if (p.has_variants && p.variants && p.variants.length > 0) {
          const totalStock = p.variants.reduce((sum, v) => sum + v.inventory_quantity, 0);
          info += isArabic
            ? `   📊 المخزون: ${totalStock > 0 ? `${totalStock} قطعة` : 'غير متوفر'}\n`
            : `   📊 Stock: ${totalStock > 0 ? `${totalStock} pcs` : 'Out of stock'}\n`;
        } else if (p.stock !== undefined) {
          info += isArabic
            ? `   📊 المخزون: ${p.stock > 0 ? `${p.stock} قطعة` : 'غير متوفر'}\n`
            : `   📊 Stock: ${p.stock > 0 ? `${p.stock} pcs` : 'Out of stock'}\n`;
        }
        
        // 🎯 Smart Options Display (Shopify variants)
        if (p.options && p.options.length > 0) {
          p.options.forEach(opt => {
            const icon = opt.values.length > 3 ? '🔢' : opt.name.includes('لون') || opt.name.includes('Color') ? '🎨' : '📏';
            const separator = isArabic ? '، ' : ', ';
            info += `   ${icon} ${opt.name}: ${opt.values.join(separator)}\n`;
          });
        } else {
          // Fallback to simple arrays
          if (p.colors && p.colors.length > 0) {
            const separator = isArabic ? '، ' : ', ';
            info += isArabic
              ? `   🎨 الألوان: ${p.colors.join(separator)}\n`
              : `   🎨 Colors: ${p.colors.join(separator)}\n`;
          }
          if (p.sizes && p.sizes.length > 0) {
            const separator = isArabic ? '، ' : ', ';
            info += isArabic
              ? `   📏 المقاسات: ${p.sizes.join(separator)}\n`
              : `   📏 Sizes: ${p.sizes.join(separator)}\n`;
          }
        }
        
        if (p.imageUrl) {
          info += isArabic
            ? `   📸 يوجد صورة\n`
            : `   📸 Image available\n`;
        }
        return info;
      }).join('\n')
    : (isArabic ? 'لا توجد منتجات في السياق الحالي.' : 'No products in current context.');
  
  const policyCurrencyCode = merchantConfig.storeCurrency || merchantConfig.currency || 'USD';
  const policyCurrencyLabelAr = getCurrencyDisplayName(policyCurrencyCode, 'arabic');
  const policyCurrencyLabelEn = getCurrencyDisplayName(policyCurrencyCode, 'english');

  return `أنت مساعد مبيعات ذكي ومحترف لمتجر "${storeName}".

# 🎯 مهمتك:
1. **جاوب باللغة الموجودة في السياق**
2. **فهم السياق**: اقرأ المحادثة كاملة وافهم ماذا يريد العميل
3. **عرض المنتجات**: عند الحديث عن المنتجات، اعرضها بتنسيق جميل مع السعر والوصف
4. **إرسال الصور**: عند طلب صورة، استخدم next_action: "send_image" واذكر اسم المنتج بالضبط في collected_info
5. **الإقناع**: كن لطيفاً ومتحمساً، امدح المنتج، وأبرز قيمته
6. **الاعتراضات**: تعامل مع الاعتراضات بذكاء (السعر، الجودة، التوصيل)
7. **جمع المعلومات**: إذا العميل يريد الطلب، اجمع المعلومات بالترتيب:
   - إذا المنتج له ألوان → اسأل عن اللون
   - إذا المنتج له مقاسات → اسأل عن المقاس
   - اسأل عن العنوان
   - اسأل عن رقم الهاتف
   - اسأل عن الاسم
   - **🎉 بمجرد حصولك على (الاسم + العنوان + الهاتف) → استخدم next_action: "confirm_order" مع رسالة شكر وتوقف عن الأسئلة!**

---

## 📋 السياق:

### المحادثة السابقة:
${historyText || 'هذه أول رسالة'}

### رسالة العميل الحالية:
"${messageText}"

### المنتجات المتاحة:
${productList}

### سياسات المتجر:
- **💰 العملة**: ${policyCurrencyLabelAr} (رمز ISO: ${policyCurrencyCode}) — اذكر للعميل **اسم العملة كاملاً** (مثل «${policyCurrencyLabelAr}» أو بالإنجليزية «${policyCurrencyLabelEn}» حسب لغة العميل)، ولا تقتصر على الرمز (${policyCurrencyCode})!
- **التوصيل**: ${merchantConfig.shippingPolicy || merchantConfig.deliveryTime || 'خلال 2-5 أيام'}
- **الدفع**: ${merchantConfig.paymentMethods || 'عند الاستلام'}
${merchantConfig.returnPolicy ? `- **الاسترجاع**: ${merchantConfig.returnPolicy}` : ''}
${merchantConfig.additionalNotes ? `- **ملاحظات**: ${merchantConfig.additionalNotes}` : ''}

---

## 📝 تعليمات مهمة:

### 🖼️ عند طلب صورة:
- استخدم next_action: "send_image"
- اذكر اسم المنتج المطلوب في collected_info.product_name
- **أمثلة لطلب الصورة**: "في صورة"، "وريني"، "شوفيني"، "أرني صورة"، "show me"

### 💬 أسلوب الرد:
- كن لطيفاً ومتحمساً 😊
- استخدم emojis بشكل معتدل (2-3)
- اجعل الرد مختصراً (2-4 جمل)
- امدح المنتج وأبرز قيمته
- تعامل مع الاعتراضات بذكاء:
  * **غالي**: اذكر الجودة، المميزات، التوفير على المدى الطويل
  * **شكوك الجودة**: اذكر تقييمات العملاء، جودة المواد (لا تذكر سياسة الاسترجاع إلا إذا كانت موجودة في سياسات المتجر!)
  * **شكوك التوصيل**: اذكر سياسة التوصيل الواضحة وسرعة الشحن

### 📦 عند عرض المنتجات:
- اذكر الاسم، السعر مع **اسم العملة كاملاً** (${policyCurrencyLabelAr} / ${policyCurrencyLabelEn})، أهم مميزة واحدة
- **💰 مهم جداً: لا تذكر السعر برمز ISO فقط (${policyCurrencyCode})؛ استخدم الاسم الكامل للعملة بلغة العميل.**
- إذا أكثر من منتج، اعرضهم بترقيم

### 🔢 الكمية (Quantity):
- **إذا العميل لم يذكر الكمية → اجعلها 1 تلقائياً**
- لا تسأل عن الكمية، افترض أنها 1 إلا إذا ذكر العميل رقم آخر

### ⚠️ قواعد صارمة:
- **🚨 لا تخترع معلومات أبداً!** استخدم فقط المعلومات الموجودة في "سياسات المتجر" أعلاه
- **🚨 لا تذكر سياسة الاسترجاع إلا إذا كانت مكتوبة بوضوح في القسم أعلاه!**
- لا تسأل عن معلومة موجودة بالفعل
- إذا المنتج بدون ألوان/مقاسات، لا تسأل عنها
- عند confirm_order: أكد الطلب مباشرة بدون أسئلة

---

## 🎯 الرد المطلوب (JSON فقط):

{
  "response_text": "ردك للعميل",
  "next_action": "ask_color | ask_size | ask_address | ask_phone | ask_name | confirm_order | send_image | recommend_products | answer_question | handoff",
  "collected_info": {
    "product_name": "اسم المنتج",
    "color": "اللون",
    "size": "المقاس",
    "quantity": 1,
    "address": "العنوان",
    "phone": "الهاتف",
    "name": "الاسم"
  },
  "reasoning": "لماذا اخترت هذا القرار؟",
  "intent": "order | product_query | price | greeting | objection | image_request | other",
  "stage": "discover | offer | clarify | close"
}

---

## ✅ أمثلة مهمة:

### مثال 1: عند اكتمال المعلومات
إذا collected_info يحتوي على:
- product_name ✅
- address ✅
- phone ✅
- name ✅

**يجب عليك:**
{
  "response_text": "تمام! 🎉 شكراً لك. تم تأكيد طلبك وسيصلك خلال [مدة التوصيل] 🚚",
  "next_action": "confirm_order"
}

### مثال 2: الكمية الافتراضية
العميل: "بدي الساعة"
**collected_info:**
{
  "product_name": "الساعة الذكية",
  "quantity": 1  ← تلقائياً!
}

### مثال 3: لا تخترع سياسات
❌ **خطأ**: "لدينا سياسة استرجاع مرنة خلال 7 أيام"
✅ **صح**: اذكر فقط ما هو موجود في قسم "سياسات المتجر" أعلاه

أعد JSON فقط.`;
};

// ==================== VALIDATION ====================

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const validateDecision = (decision: AIDecision, context: AIConversationContext): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const product = context.products[0];
  
  // Validate variant flow
  if (product && decision.intent === 'order') {
    const hasColors = product.colors && product.colors.length > 0;
    const hasSizes = product.sizes && product.sizes.length > 0;
    const colorProvided = decision.collected_info.color || context.conversationState.extracted_entities?.color;
    const sizeProvided = decision.collected_info.size || context.conversationState.extracted_entities?.size;
    
    // Don't ask for color if product has none
    if (!hasColors && decision.next_action === 'ask_color') {
      errors.push('Product has no colors');
    }
    
    // Don't ask for size if product has none
    if (!hasSizes && decision.next_action === 'ask_size') {
      errors.push('Product has no sizes');
    }
    
    // Must ask for color if product has colors and not provided
    if (hasColors && !colorProvided && decision.next_action !== 'ask_color' && decision.next_action !== 'answer_question') {
      warnings.push('Skipping color when needed');
    }
    
    // Must ask for size if product has sizes and color provided but no size
    if (hasSizes && colorProvided && !sizeProvided && decision.next_action !== 'ask_size' && decision.next_action !== 'answer_question') {
      warnings.push('Skipping size when needed');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
};

// ==================== MAIN ORCHESTRATOR ====================

export const orchestrateWithAI = async (
  context: AIConversationContext
): Promise<{
  decision: AIDecision;
  validation: ValidationResult;
  aiCallsCount: number;
}> => {
  const startTime = Date.now();
  
  logger.info('🤖 AI Orchestrator started', {
    merchantId: context.merchantId,
    message: context.messageText.substring(0, 50)
  });
  
  // Build prompt
  const prompt = buildPrompt(context);
  
  // Call AI
  trackAICall();
  const result = await generateJSON<AIDecision>(prompt, {
    temperature: 0.3, // Balanced creativity
    maxOutputTokens: 1000
  });
  
  if (!result.success || !result.data) {
    throw new Error('AI orchestration failed');
  }
  
  const decision = result.data;
  
  console.log('🤖 AI Decision:', {
    next_action: decision.next_action,
    intent: decision.intent,
    stage: decision.stage,
    reasoning: decision.reasoning
  });
  
  // Validate
  const validation = validateDecision(decision, context);
  
  if (!validation.valid) {
    console.error('❌ Validation errors:', validation.errors);
  }
  
  if (validation.warnings.length > 0) {
    console.warn('⚠️ Validation warnings:', validation.warnings);
  }
  
  logger.info('✅ AI Decision completed', {
    next_action: decision.next_action,
    processingTime: Date.now() - startTime
  });
  
  return {
    decision,
    validation,
    aiCallsCount: 1
  };
};
