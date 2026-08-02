/**
 * Sales Planner - Deterministic planning that forces progress
 * Multi-language support for SaaS
 */

import { logger } from '../utils/logger.js';
import { getCurrencyDisplayName } from '../utils/currencyDisplayName.js';
import { IntentDetectionResult } from './intentDetector.js';
import { ToolResult } from './tools/tool.interface.js';

export interface SalesPlanInput {
  intent: IntentDetectionResult['intent'];
  stage: IntentDetectionResult['stage'];
  objection: IntentDetectionResult['objection'];
  entities: IntentDetectionResult['entities'];
  missing_fields?: string[]; // Missing fields from intent detection
  conversationState: Record<string, any>;
  toolResults?: ToolResult[];
  language?: 'arabic' | 'english'; // Language support
}

export interface SalesPlan {
  next_action: 'ask_clarify' | 'recommend_products' | 'confirm_variant' | 'confirm_city' | 'send_checkout' | 'confirm_order' | 'handoff';
  one_question: string;
  cta_type: 'choose' | 'confirm' | 'order' | 'support';
  recommendation_strategy: 'top_sellers' | 'match_query' | 'upsell' | 'cheaper_alt' | 'best_value' | null;
  should_offer_discount: boolean;
  handoff_reason: string;
}

// ==================== BILINGUAL QUESTIONS ====================

const QUESTIONS = {
  handoff: {
    ar: 'نعتذر عن أي إزعاج. هل يمكنك إخبارنا بالمشكلة بالتفصيل؟',
    en: 'We apologize for any inconvenience. Can you tell us more about the issue?'
  },
  what_product: {
    ar: 'ما المنتج الذي تبحث عنه؟',
    en: 'What product are you looking for?'
  },
  which_product_price: {
    ar: 'ما المنتج الذي تريد معرفة سعره؟',
    en: 'Which product would you like to know the price for?'
  },
  proceed_with_order: {
    ar: 'هل تريد المتابعة مع الطلب؟',
    en: 'Would you like to proceed with the order?'
  },
  which_prefer: {
    ar: 'أي منتج تفضل؟',
    en: 'Which product do you prefer?'
  },
  which_city: {
    ar: 'إلى أي مدينة تريد التوصيل؟',
    en: 'Which city would you like delivery to?'
  },
  which_size: {
    ar: 'ما المقاس الذي تفضله؟',
    en: 'What size would you prefer?'
  },
  which_color: {
    ar: 'ما اللون الذي تفضله؟',
    en: 'What color would you prefer?'
  },
  complete_order: {
    ar: 'ممتاز! هل تريد إتمام الطلب الآن؟',
    en: 'Great! Would you like to complete the order now?'
  },
  cheaper_alternatives: {
    ar: 'نفهم أن السعر مهم. هل تريد رؤية بدائل أرخص؟',
    en: 'We understand price is important. Would you like to see cheaper alternatives?'
  },
  budget_question: {
    ar: 'ما الميزانية المفضلة لديك؟',
    en: 'What is your preferred budget?'
  },
  warranty_info: {
    ar: 'هل تريد معرفة المزيد عن ضماناتنا وسياسة الإرجاع؟',
    en: 'Would you like to know more about our warranty and return policy?'
  },
  shipping_details: {
    ar: 'إلى أي مدينة تريد التوصيل لنعطيك معلومات دقيقة؟',
    en: 'Which city do you need delivery to for accurate information?'
  },
  quality_options: {
    ar: 'هل تريد رؤية أفضل الخيارات من حيث الجودة؟',
    en: 'Would you like to see our best quality options?'
  },
  want_more_info: {
    ar: 'هل تريد معرفة المزيد؟',
    en: 'Would you like to know more?'
  },
  what_looking_for: {
    ar: 'ما الذي تبحث عنه بالضبط؟',
    en: 'What exactly are you looking for?'
  },
  check_availability: {
    ar: 'ما المنتج الذي تريد التحقق من توافره؟',
    en: 'Which product would you like to check availability for?'
  },
  notify_when_available: {
    ar: 'هل تريد إشعار عند توفر المنتج؟',
    en: 'Would you like to be notified when it becomes available?'
  },
  compare_which: {
    ar: 'أي منتج تفضل المقارنة بينهما؟',
    en: 'Which products would you like to compare?'
  },
  hello_help: {
    ar: 'مرحباً بك! كيف يمكنني مساعدتك اليوم؟',
    en: 'Hello! How can I help you today?'
  }
};

/**
 * Get question in specified language
 */
const getQuestion = (key: keyof typeof QUESTIONS, language: 'arabic' | 'english' = 'arabic'): string => {
  return QUESTIONS[key][language === 'arabic' ? 'ar' : 'en'];
};

/**
 * Generate deterministic sales plan based on intent, stage, and context
 * Now with multi-language support
 */
export const planSalesAction = (input: SalesPlanInput): SalesPlan => {
  const {
    intent,
    stage,
    objection,
    entities,
    missing_fields = [],
    conversationState,
    toolResults = [],
    language = 'arabic'
  } = input;

  logger.info('Planning sales action', {
    intent,
    stage,
    objection,
    entitiesCount: Object.keys(entities).length,
    toolResultsCount: toolResults.length,
    language
  });

  // ==================== RULE 1: Handoff/Complaint ====================
  if (stage === 'handoff' || intent === 'complaint') {
    return {
      next_action: 'handoff',
      one_question: getQuestion('handoff', language),
      cta_type: 'support',
      recommendation_strategy: null,
      should_offer_discount: false,
      handoff_reason: intent === 'complaint' ? 'Customer complaint' : 'Stage is handoff'
    };
  }

  // ==================== RULE 1.5: Greeting - Natural Welcome ====================
  if (intent === 'greeting') {
    return {
      next_action: 'ask_clarify',
      one_question: getQuestion('hello_help', language),
      cta_type: 'choose',
      recommendation_strategy: null,
      should_offer_discount: false,
      handoff_reason: ''
    };
  }

  // ==================== RULE 2: Price Inquiry Without Product ====================
  if (intent === 'price' && !entities.product_query && !entities.product_id) {
    const productFromState = conversationState.last_recommended_products?.[0];

    if (!productFromState) {
      return {
        next_action: 'ask_clarify',
        one_question: getQuestion('which_product_price', language),
        cta_type: 'choose',
        recommendation_strategy: null,
        should_offer_discount: false,
        handoff_reason: ''
      };
    }
  }

  // ==================== RULE 3: Product Recommendations ====================
  const catalogResult = toolResults.find(r => r.name === 'catalog' && r.success);
  const products = catalogResult?.data?.products || [];

  if (products.length > 0 && products.length <= 3) {
    if (products.length === 1) {
      const product = products[0];
      const stockStatus = product.stock > 0 
        ? (language === 'arabic' ? `متوفر (${product.stock} قطعة)` : `In stock (${product.stock} units)`)
        : (language === 'arabic' ? 'غير متوفر حالياً' : 'Currently out of stock');

      const currencyLabel = getCurrencyDisplayName(product.currency, language === 'arabic' ? 'arabic' : 'english');
      const question = language === 'arabic'
        ? `لدينا ${product.name} بسعر ${product.price} ${currencyLabel}. ${stockStatus}. ${getQuestion('proceed_with_order', language)}`
        : `We have ${product.name} for ${product.price} ${currencyLabel}. ${stockStatus}. ${getQuestion('proceed_with_order', language)}`;

      return {
        next_action: 'recommend_products',
        one_question: question,
        cta_type: 'order',
        recommendation_strategy: 'match_query',
        should_offer_discount: false,
        handoff_reason: ''
      };
    }

    // Multiple products
    const productNames = products.map((p: any) => p.name).join(language === 'arabic' ? ' و ' : ' and ');
    const question = language === 'arabic'
      ? `لدينا ${productNames}. ${getQuestion('which_prefer', language)}`
      : `We have ${productNames}. ${getQuestion('which_prefer', language)}`;

    return {
      next_action: 'recommend_products',
      one_question: question,
      cta_type: 'choose',
      recommendation_strategy: 'match_query',
      should_offer_discount: false,
      handoff_reason: ''
    };
  }

  // ==================== RULE 4: Order Ready - Missing Fields ====================
  if (intent === 'order' && stage === 'close') {
    // ✅ CRITICAL: Check missing_fields first (from AI intent detection)
    // If missing_fields is empty, all mandatory fields are provided - confirm order
    if (missing_fields.length === 0) {
      return {
        next_action: 'confirm_order',
        one_question: language === 'arabic' 
          ? 'شكراً لثقتك! تم استلام طلبك بنجاح، وسنتواصل معك قريباً لتأكيده.'
          : 'Thank you for your trust! Your order has been received successfully, and we will contact you soon to confirm it.',
        cta_type: 'confirm',
        recommendation_strategy: null,
        should_offer_discount: false,
        handoff_reason: ''
      };
    }

    // If there are missing fields, check which ones and ask accordingly
    // Don't ask for fields that were already provided in previous messages
    const missingPhone = missing_fields.includes('رقم الهاتف');
    const missingAddress = missing_fields.includes('العنوان بالتفصيل');
    const missingName = missing_fields.includes('الاسم الكامل');
    const missingDeliveryTime = missing_fields.includes('الوقت المناسب للتوصيل');

    // Priority: Name > Phone > Address > Delivery Time
    if (missingName) {
      return {
        next_action: 'ask_clarify',
        one_question: language === 'arabic' ? 'ما اسمك الكامل؟' : 'What is your full name?',
        cta_type: 'confirm',
        recommendation_strategy: null,
        should_offer_discount: false,
        handoff_reason: ''
      };
    }

    if (missingPhone) {
      return {
        next_action: 'ask_clarify',
        one_question: language === 'arabic' ? 'ما رقم هاتفك؟' : 'What is your phone number?',
        cta_type: 'confirm',
        recommendation_strategy: null,
        should_offer_discount: false,
        handoff_reason: ''
      };
    }

    if (missingAddress) {
      return {
        next_action: 'ask_clarify',
        one_question: language === 'arabic' 
          ? 'ما عنوانك بالتفصيل؟ (يرجى ذكر المنطقة أو الشارع)'
          : 'What is your detailed address? (Please include neighborhood or street)',
        cta_type: 'confirm',
        recommendation_strategy: null,
        should_offer_discount: false,
        handoff_reason: ''
      };
    }

    if (missingDeliveryTime) {
      return {
        next_action: 'ask_clarify',
        one_question: language === 'arabic' ? 'ما الوقت المناسب للتوصيل؟' : 'What is the suitable delivery time?',
        cta_type: 'confirm',
        recommendation_strategy: null,
        should_offer_discount: false,
        handoff_reason: ''
      };
    }

    // Fallback: check for city, size, color (product-specific fields)
    if (!entities.city) {
      return {
        next_action: 'confirm_city',
        one_question: getQuestion('which_city', language),
        cta_type: 'confirm',
        recommendation_strategy: null,
        should_offer_discount: false,
        handoff_reason: ''
      };
    }

    const selectedProduct = products.length === 1 ? products[0] : null;
    if (selectedProduct) {
      if (selectedProduct.sizes && selectedProduct.sizes.length > 0 && !entities.size) {
        const sizes = selectedProduct.sizes.join(', ');
        const question = language === 'arabic'
          ? `${getQuestion('which_size', language)} (${sizes})`
          : `${getQuestion('which_size', language)} (${sizes})`;
        
        return {
          next_action: 'confirm_variant',
          one_question: question,
          cta_type: 'confirm',
          recommendation_strategy: null,
          should_offer_discount: false,
          handoff_reason: ''
        };
      }

      if (!entities.color) {
        return {
          next_action: 'confirm_variant',
          one_question: getQuestion('which_color', language),
          cta_type: 'confirm',
          recommendation_strategy: null,
          should_offer_discount: false,
          handoff_reason: ''
        };
      }
    }

    // If all mandatory fields are provided but still in order stage, send checkout
    return {
      next_action: 'send_checkout',
      one_question: getQuestion('complete_order', language),
      cta_type: 'order',
      recommendation_strategy: null,
      should_offer_discount: false,
      handoff_reason: ''
    };
  }

  // ==================== RULE 5: Objection Handling ====================
  if (objection && objection !== 'none' && stage === 'objection') {
    switch (objection) {
      case 'price':
        const cheaperProducts = products.filter((p: any) => p.price < (products[0]?.price || Infinity));
        if (cheaperProducts.length > 0) {
          return {
            next_action: 'recommend_products',
            one_question: getQuestion('cheaper_alternatives', language),
            cta_type: 'choose',
            recommendation_strategy: 'cheaper_alt',
            should_offer_discount: false,
            handoff_reason: ''
          };
        }
        return {
          next_action: 'ask_clarify',
          one_question: getQuestion('budget_question', language),
          cta_type: 'choose',
          recommendation_strategy: null,
          should_offer_discount: true,
          handoff_reason: ''
        };

      case 'trust':
        return {
          next_action: 'ask_clarify',
          one_question: getQuestion('warranty_info', language),
          cta_type: 'confirm',
          recommendation_strategy: null,
          should_offer_discount: false,
          handoff_reason: ''
        };

      case 'shipping':
        return {
          next_action: 'confirm_city',
          one_question: getQuestion('shipping_details', language),
          cta_type: 'confirm',
          recommendation_strategy: null,
          should_offer_discount: false,
          handoff_reason: ''
        };

      case 'quality':
        return {
          next_action: 'recommend_products',
          one_question: getQuestion('quality_options', language),
          cta_type: 'choose',
          recommendation_strategy: 'best_value',
          should_offer_discount: false,
          handoff_reason: ''
        };
    }
  }

  // ==================== RULE 6: Browse/Product Query ====================
  if (intent === 'browse' || intent === 'product_query') {
    // ✅ إذا كان wants_catalog، نعرض قائمة ب 5 منتجات
    if (entities.wants_catalog && products.length > 0) {
      return {
        next_action: 'recommend_products',
        one_question: language === 'arabic'
          ? `لدينا ${products.length} منتج متوفر. ${getQuestion('which_prefer', language)}`
          : `We have ${products.length} products available. ${getQuestion('which_prefer', language)}`,
        cta_type: 'choose',
        recommendation_strategy: 'top_sellers',
        should_offer_discount: false,
        handoff_reason: ''
      };
    }
    
    if (products.length > 0) {
      if (products.length === 1) {
        const product = products[0];
        const currencyLabel = getCurrencyDisplayName(product.currency, language === 'arabic' ? 'arabic' : 'english');
        const question = language === 'arabic'
          ? `وجدنا ${product.name} بسعر ${product.price} ${currencyLabel}. ${getQuestion('want_more_info', language)}`
          : `We found ${product.name} for ${product.price} ${currencyLabel}. ${getQuestion('want_more_info', language)}`;

        return {
          next_action: 'recommend_products',
          one_question: question,
          cta_type: 'choose',
          recommendation_strategy: 'match_query',
          should_offer_discount: false,
          handoff_reason: ''
        };
      }

      // ✅ عند وجود عدة منتجات، نعرض حتى 5 منتجات
      const displayProducts = products.slice(0, 5);
      const productNames = displayProducts.map((p: any) => p.name).join(language === 'arabic' ? ' و ' : ' and ');
      const question = language === 'arabic'
        ? `لدينا ${productNames}${products.length > 5 ? ` وغيرها (${products.length} منتج)` : ''}. ${getQuestion('which_prefer', language)}`
        : `We have ${productNames}${products.length > 5 ? ` and more (${products.length} products)` : ''}. ${getQuestion('which_prefer', language)}`;

      return {
        next_action: 'recommend_products',
        one_question: question,
        cta_type: 'choose',
        recommendation_strategy: 'match_query',
        should_offer_discount: false,
        handoff_reason: ''
      };
    }

    return {
      next_action: 'ask_clarify',
      one_question: getQuestion('what_product', language),
      cta_type: 'choose',
      recommendation_strategy: null,
      should_offer_discount: false,
      handoff_reason: ''
    };
  }

  // ==================== RULE 7: Availability Check ====================
  if (intent === 'availability') {
    if (products.length > 0) {
      const product = products[0];
      const stockStatus = product.stock > 0 
        ? (language === 'arabic' ? `متوفر (${product.stock} قطعة)` : `In stock (${product.stock} units)`)
        : (language === 'arabic' ? 'غير متوفر حالياً' : 'Currently out of stock');

      const question = product.stock > 0 
        ? getQuestion('proceed_with_order', language)
        : getQuestion('notify_when_available', language);

      const fullQuestion = `${product.name} ${stockStatus}. ${question}`;

      return {
        next_action: 'recommend_products',
        one_question: fullQuestion,
        cta_type: product.stock > 0 ? 'order' : 'confirm',
        recommendation_strategy: 'match_query',
        should_offer_discount: false,
        handoff_reason: ''
      };
    }

    return {
      next_action: 'ask_clarify',
      one_question: getQuestion('check_availability', language),
      cta_type: 'choose',
      recommendation_strategy: null,
      should_offer_discount: false,
      handoff_reason: ''
    };
  }

  // ==================== RULE 8: Shipping Inquiry ====================
  if (intent === 'shipping') {
    if (!entities.city) {
      return {
        next_action: 'confirm_city',
        one_question: getQuestion('which_city', language),
        cta_type: 'confirm',
        recommendation_strategy: null,
        should_offer_discount: false,
        handoff_reason: ''
      };
    }

    const question = language === 'arabic'
      ? `التوصيل إلى ${entities.city} متاح. هل تريد معرفة تفاصيل الشحن؟`
      : `Delivery to ${entities.city} is available. Would you like shipping details?`;

    return {
      next_action: 'ask_clarify',
      one_question: question,
      cta_type: 'confirm',
      recommendation_strategy: null,
      should_offer_discount: false,
      handoff_reason: ''
    };
  }

  // ==================== RULE 9: Comparison ====================
  if (intent === 'comparison') {
    if (products.length >= 2) {
      const question = language === 'arabic'
        ? `لدينا ${products.length} خيارات. ${getQuestion('compare_which', language)}`
        : `We have ${products.length} options. ${getQuestion('compare_which', language)}`;

      return {
        next_action: 'recommend_products',
        one_question: question,
        cta_type: 'choose',
        recommendation_strategy: 'best_value',
        should_offer_discount: false,
        handoff_reason: ''
      };
    }

    return {
      next_action: 'ask_clarify',
      one_question: getQuestion('compare_which', language),
      cta_type: 'choose',
      recommendation_strategy: null,
      should_offer_discount: false,
      handoff_reason: ''
    };
  }

  // ==================== RULE 10: Greeting/Other ====================
  return {
    next_action: 'ask_clarify',
    one_question: getQuestion('hello_help', language),
    cta_type: 'choose',
    recommendation_strategy: null,
    should_offer_discount: false,
    handoff_reason: ''
  };
};
