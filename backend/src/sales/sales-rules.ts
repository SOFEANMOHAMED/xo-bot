/**
 * Sales Rules - Deterministic sales planning
 * No AI needed - pure rule-based logic
 */

import type {
  Intent,
  Stage,
  Objection,
  Entities,
  NextAction,
  CtaType,
  RecommendationStrategy,
  Language,
  Product
} from '../core/types.js';
import { logger } from '../utils/logger.js';
import { getCurrencyDisplayName } from '../utils/currencyDisplayName.js';
import { formatColorOptionsForDisplay, resolveColorEntity } from '../catalog/color-options.js';

// ==================== TYPES ====================

export interface SalesPlanInput {
  intent: Intent;
  stage: Stage;
  objection: Objection;
  entities: Entities;
  missingFields: string[];
  conversationState: Record<string, any>;
  products: Product[];
  language: Language;
}

export interface SalesPlan {
  nextAction: NextAction;
  oneQuestion: string;
  ctaType: CtaType;
  recommendationStrategy: RecommendationStrategy;
  shouldOfferDiscount: boolean;
  handoffReason: string;
}

// ==================== BILINGUAL QUESTIONS ====================

const QUESTIONS: Record<string, { ar: string; en: string }> = {
  handoff: {
    ar: 'نعتذر بشدة عن أي إزعاج! 🙏 هل يمكنك إخبارنا بالمشكلة بالتفصيل عشان نساعدك بأفضل طريقة؟',
    en: 'We sincerely apologize for any inconvenience! 🙏 Can you tell us more about the issue so we can help you better?'
  },
  what_product: {
    ar: 'ما المنتج اللي تدور عليه؟ 🔍 حابب أساعدك!',
    en: 'What product are you looking for? 🔍 Happy to help!'
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
  },
  ask_name: {
    ar: 'ممتاز! 🎉 ما اسمك الكامل؟',
    en: 'Great! 🎉 What is your full name?'
  },
  ask_phone: {
    ar: 'تمام! 👌 ما رقم هاتفك للتواصل؟',
    en: 'Perfect! 👌 What is your phone number?'
  },
  ask_address: {
    ar: 'رائع! 🚚 ما عنوانك بالتفصيل؟ (المنطقة أو الشارع)',
    en: 'Awesome! 🚚 What is your detailed address? (Neighborhood or street)'
  },
  ask_delivery_time: {
    ar: 'ما الوقت المناسب للتوصيل؟',
    en: 'What is the suitable delivery time?'
  },
  order_confirmed: {
    ar: 'شكراً لثقتك! تم استلام طلبك بنجاح، وسنتواصل معك قريباً لتأكيده.',
    en: 'Thank you for your trust! Your order has been received successfully, and we will contact you soon to confirm it.'
  }
};

/**
 * Get question in specified language
 */
const getQuestion = (key: keyof typeof QUESTIONS, language: Language): string => {
  return QUESTIONS[key][language === 'arabic' ? 'ar' : 'en'];
};

// ==================== MAIN PLANNER ====================

/**
 * Generate deterministic sales plan based on intent, stage, and context
 */
export const planSalesAction = (input: SalesPlanInput): SalesPlan => {
  const {
    intent,
    stage,
    objection,
    entities,
    missingFields,
    conversationState,
    products,
    language
  } = input;

  logger.debug('Planning sales action', {
    intent,
    stage,
    objection,
    productsCount: products.length,
    missingFieldsCount: missingFields.length
  });

  // ==================== RULE 1: Handoff/Complaint ====================
  if (stage === 'handoff' || intent === 'complaint') {
    return {
      nextAction: 'handoff',
      oneQuestion: getQuestion('handoff', language),
      ctaType: 'support',
      recommendationStrategy: null,
      shouldOfferDiscount: false,
      handoffReason: intent === 'complaint' ? 'Customer complaint' : 'Stage is handoff'
    };
  }

  // ==================== RULE 2: Greeting ====================
  if (intent === 'greeting') {
    return {
      nextAction: 'ask_clarify',
      oneQuestion: getQuestion('hello_help', language),
      ctaType: 'choose',
      recommendationStrategy: null,
      shouldOfferDiscount: false,
      handoffReason: ''
    };
  }

  // ==================== RULE 2.5: Explicit product not found ====================
  if (products.length === 0 && entities.product_query &&
    ['product_query', 'price', 'availability', 'order'].includes(intent)) {
    const productName = entities.product_query;
    const notFoundQuestion = language === 'arabic'
      ? `عذراً، لم نجد "${productName}". هل تبحث عن منتج آخر؟`
      : `Sorry, we couldn't find "${productName}". Are you looking for another product?`;

    return {
      nextAction: 'ask_clarify',
      oneQuestion: notFoundQuestion,
      ctaType: 'choose',
      recommendationStrategy: null,
      shouldOfferDiscount: false,
      handoffReason: 'no_products_found'
    };
  }

  // ==================== RULE 3: Price Inquiry Without Product ====================
  if (intent === 'price' && !entities.product_query && !entities.product_id) {
    const productFromState = conversationState.last_recommended_products?.[0];
    if (!productFromState) {
      return {
        nextAction: 'ask_clarify',
        oneQuestion: getQuestion('which_product_price', language),
        ctaType: 'choose',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }
  }

  // ==================== RULE 3.5: 🚀 SMART Ask for size/color if available ====================
  // ✅ CRITICAL: Ask for color/size when order OR product_query intent is detected AND we have exactly one product
  // This MUST happen BEFORE order completion, even if all order info is collected
  // 🚀 NEW: Smart detection - if user already provided color/size, acknowledge and move to next step!
  console.log('🔍 RULE 3.5 Check - Smart variant questions', {
    intent,
    stage,
    productsCount: products.length,
    hasProduct: products.length === 1,
    productName: products[0]?.name,
    hasSizes: products[0] && Array.isArray(products[0].sizes) && products[0].sizes.length > 0,
    hasColors: products[0] && Array.isArray(products[0].colors) && products[0].colors.length > 0,
    entityColor: entities.color,
    entitySize: entities.size,
    conditionMet: (intent === 'order' || intent === 'product_query') && products.length === 1
  });
  logger.info('🔍 RULE 3.5 Check - Smart variant questions', {
    intent,
    stage,
    productsCount: products.length,
    hasProduct: products.length === 1,
    productName: products[0]?.name,
    hasSizes: products[0] && Array.isArray(products[0].sizes) && products[0].sizes.length > 0,
    hasColors: products[0] && Array.isArray(products[0].colors) && products[0].colors.length > 0,
    entityColor: entities.color,
    entitySize: entities.size,
    conditionMet: (intent === 'order' || intent === 'product_query') && products.length === 1
  });

  if ((intent === 'order' || intent === 'product_query') && products.length === 1) {
    const product = products[0];
    const hasSizes = Array.isArray(product.sizes) && product.sizes.length > 0;
    const hasColors = Array.isArray(product.colors) && product.colors.length > 0;

    // Normalize extracted color against product options (compound-safe)
    if (hasColors && entities.color) {
      const resolved = resolveColorEntity(entities.color, product.colors);
      if (resolved.needsClarification) {
        const options = formatColorOptionsForDisplay(resolved.ambiguous, language === 'english' ? 'english' : 'arabic');
        return {
          nextAction: 'ask_clarify',
          oneQuestion: language === 'arabic'
            ? `تقصد أي خيار؟ 🎨\n${options}`
            : `Which color option did you mean? 🎨\n${options}`,
          ctaType: 'choose',
          recommendationStrategy: null,
          shouldOfferDiscount: false,
          handoffReason: ''
        };
      }
      if (resolved.color) {
        entities.color = resolved.color;
      }
    }

    console.log('🎯 INSIDE RULE 3.5 - Smart color/size detection', {
      hasColors,
      hasSizes,
      entityColor: entities.color,
      entitySize: entities.size,
      productColors: product.colors,
      productSizes: product.sizes,
      willAskColor: hasColors && !entities.color,
      willAskSize: hasSizes && !entities.size
    });

    // 🚀 SCENARIO 1: User already provided BOTH color and size - proceed!
    if (hasColors && hasSizes && entities.color && entities.size) {
      console.log('✅✅ RULE 3.5 - Both color and size provided! Proceeding to order.', {
        color: entities.color,
        size: entities.size
      });
      // Let the flow continue to next step (address/phone)
      // Don't return, just log and continue
    }
    
    // 🚀 SCENARIO 2: User provided COLOR, need SIZE - acknowledge and ask for size
    else if (hasColors && hasSizes && entities.color && !entities.size) {
      console.log('✅🎨 RULE 3.5 - Color provided, asking for SIZE', {
        providedColor: entities.color,
        productName: product.name,
        availableSizes: product.sizes
      });
      logger.info('RULE 3.5 ACTIVATED - Color provided, asking for SIZE', {
        color: entities.color,
        productName: product.name,
        availableSizes: product.sizes
      });
      const options = product.sizes!.join('، ');
      return {
        nextAction: 'ask_clarify',
        oneQuestion: language === 'arabic'
          ? `ممتاز! اللون ${entities.color} اختيار رائع 🎨\nوما المقاس المفضل؟ 📏\n(المتاح: ${options})`
          : `Excellent! ${entities.color} is a great choice 🎨\nWhich size would you like? 📏\n(Available: ${options})`,
        ctaType: 'choose',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }
    
    // 🚀 SCENARIO 3: User provided SIZE, need COLOR - acknowledge and ask for color
    else if (hasColors && hasSizes && entities.size && !entities.color) {
      console.log('✅📏 RULE 3.5 - Size provided, asking for COLOR', {
        providedSize: entities.size,
        productName: product.name,
        availableColors: product.colors
      });
      logger.info('RULE 3.5 ACTIVATED - Size provided, asking for COLOR', {
        size: entities.size,
        productName: product.name,
        availableColors: product.colors
      });
      const options = formatColorOptionsForDisplay(
        product.colors!,
        language === 'english' ? 'english' : 'arabic'
      );
      return {
        nextAction: 'ask_clarify',
        oneQuestion: language === 'arabic'
          ? `تمام! المقاس ${entities.size} 📏\nوما خيار اللون المفضل؟ 🎨\n(المتاح: ${options})`
          : `Perfect! Size ${entities.size} 📏\nWhich color option would you like? 🎨\n(Available: ${options})`,
        ctaType: 'choose',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }

    // ✅ SCENARIO 4: Need COLOR (standard case)
    else if (hasColors && !entities.color) {
      console.log('🎨 RULE 3.5 ACTIVATED - Asking for COLOR', {
        productName: product.name,
        availableColors: product.colors
      });
      logger.info('RULE 3.5 ACTIVATED - Asking for COLOR', {
        productName: product.name,
        availableColors: product.colors
      });
      const options = formatColorOptionsForDisplay(
        product.colors!,
        language === 'english' ? 'english' : 'arabic'
      );
      return {
        nextAction: 'ask_clarify',
        oneQuestion: language === 'arabic'
          ? `قبل ما نجهز الطلب، ما خيار اللون المفضل؟ 🎨\n(المتاح: ${options})`
          : `Before we prepare your order, which color option? 🎨\n(Available: ${options})`,
        ctaType: 'choose',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }

    // ✅ SCENARIO 5: Need SIZE (standard case)
    else if (hasSizes && !entities.size) {
      console.log('📏 RULE 3.5 ACTIVATED - Asking for SIZE', {
        productName: product.name,
        availableSizes: product.sizes
      });
      logger.info('RULE 3.5 ACTIVATED - Asking for SIZE', {
        productName: product.name,
        availableSizes: product.sizes
      });
      const options = product.sizes!.join('، ');
      return {
        nextAction: 'ask_clarify',
        oneQuestion: language === 'arabic'
          ? `تمام! وما المقاس المفضل؟ 📏\n(المتاح: ${options})`
          : `Great! And which size? 📏\n(Available: ${options})`,
        ctaType: 'choose',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }
  }

  // ... existing code ...

  // ==================== RULE 4: Product Recommendations ====================
  if (products.length > 0 && products.length <= 3) {
    if (products.length === 1) {
      const product = products[0];
      
      // ✅ Urgency & Scarcity Logic
      const hasLowStock = product.stock > 0 && product.stock <= 10;
      const hasVeryLowStock = product.stock > 0 && product.stock <= 3;
      
      let stockStatus = '';
      let urgencyEmoji = '';
      
      if (product.stock <= 0) {
        stockStatus = language === 'arabic' ? 'غير متوفر حالياً ❌' : 'Currently out of stock ❌';
      } else if (hasVeryLowStock) {
        // Very low stock - maximum urgency
        urgencyEmoji = '🔥';
        stockStatus = language === 'arabic' 
          ? `⚠️ متبقي ${product.stock} قطع فقط! سارع قبل نفاذ الكمية ${urgencyEmoji}` 
          : `⚠️ Only ${product.stock} units left! Hurry before sold out ${urgencyEmoji}`;
      } else if (hasLowStock) {
        // Low stock - medium urgency
        urgencyEmoji = '⚡';
        stockStatus = language === 'arabic' 
          ? `متوفر ✅ (متبقي ${product.stock} قطع) ${urgencyEmoji}` 
          : `In stock ✅ (${product.stock} units left) ${urgencyEmoji}`;
      } else {
        // Normal stock
        stockStatus = language === 'arabic' 
          ? `متوفر ✅ (${product.stock} قطعة)` 
          : `In stock ✅ (${product.stock} units)`;
      }
      
      // ✅ Social Proof
      const socialProof = language === 'arabic'
        ? '💯 من الأكثر مبيعاً عندنا!'
        : '💯 Best seller!';
      
      // ✅ Build engaging question
      const currencyLabel = getCurrencyDisplayName(product.currency, language === 'arabic' ? 'arabic' : 'english');
      const question = language === 'arabic'
        ? `${socialProof}\n\nلدينا ${product.name} بسعر ${product.price} ${currencyLabel}. ${stockStatus}\n\n🎁 ${getQuestion('proceed_with_order', language)}`
        : `${socialProof}\n\nWe have ${product.name} for ${product.price} ${currencyLabel}. ${stockStatus}\n\n🎁 ${getQuestion('proceed_with_order', language)}`;

      return {
        nextAction: 'recommend_products',
        oneQuestion: question,
        ctaType: 'order',
        recommendationStrategy: 'match_query',
        shouldOfferDiscount: hasVeryLowStock, // ✅ Enable discount for very low stock
        handoffReason: ''
      };
    }

    // ✅ Multiple products - add enthusiasm
    const productNames = products.map(p => p.name).join(language === 'arabic' ? ' و ' : ' and ');
    const question = language === 'arabic'
      ? `رائع! 🎉 لدينا عدة خيارات ممتازة: ${productNames}.\n\n${getQuestion('which_prefer', language)}`
      : `Great! 🎉 We have several excellent options: ${productNames}.\n\n${getQuestion('which_prefer', language)}`;

    return {
      nextAction: 'recommend_products',
      oneQuestion: question,
      ctaType: 'choose',
      recommendationStrategy: 'match_query',
      shouldOfferDiscount: false,
      handoffReason: ''
    };
  }

  // ==================== RULE 5: Order - Missing Fields ====================
  if (intent === 'order' && stage === 'close') {
    if (missingFields.length === 0) {
      return {
        nextAction: 'confirm_order',
        oneQuestion: getQuestion('order_confirmed', language),
        ctaType: 'confirm',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }

    // Ask for missing fields one at a time
    const missingName = missingFields.includes('الاسم الكامل') || missingFields.includes('Full Name');
    const missingPhone = missingFields.includes('رقم الهاتف') || missingFields.includes('Phone Number');
    const missingAddress = missingFields.includes('العنوان بالتفصيل') || missingFields.includes('Detailed Address');


    if (missingName) {
      return {
        nextAction: 'ask_clarify',
        oneQuestion: getQuestion('ask_name', language),
        ctaType: 'confirm',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }

    if (missingPhone) {
      return {
        nextAction: 'ask_clarify',
        oneQuestion: getQuestion('ask_phone', language),
        ctaType: 'confirm',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }

    if (missingAddress) {
      return {
        nextAction: 'ask_clarify',
        oneQuestion: getQuestion('ask_address', language),
        ctaType: 'confirm',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }



    // Fallback: City confirmation
    if (!entities.city) {
      return {
        nextAction: 'confirm_city',
        oneQuestion: getQuestion('which_city', language),
        ctaType: 'confirm',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }

    return {
      nextAction: 'send_checkout',
      oneQuestion: getQuestion('complete_order', language),
      ctaType: 'order',
      recommendationStrategy: null,
      shouldOfferDiscount: false,
      handoffReason: ''
    };
  }

  // ==================== RULE 6: Objection Handling ====================
  if (objection && objection !== 'none' && stage === 'objection') {
    return handleObjection(objection, products, language);
  }

  // ==================== RULE 7: Browse/Product Query ====================
  if (intent === 'browse' || intent === 'product_query') {
    if (entities.wants_catalog && products.length > 0) {
      return {
        nextAction: 'recommend_products',
        oneQuestion: language === 'arabic'
          ? `لدينا ${products.length} منتج متوفر. ${getQuestion('which_prefer', language)}`
          : `We have ${products.length} products available. ${getQuestion('which_prefer', language)}`,
        ctaType: 'choose',
        recommendationStrategy: 'top_sellers',
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }

    if (products.length > 0) {
      if (products.length === 1) {
        const product = products[0];
        const currencyLabel = getCurrencyDisplayName(product.currency, language === 'arabic' ? 'arabic' : 'english');
        return {
          nextAction: 'recommend_products',
          oneQuestion: language === 'arabic'
            ? `وجدنا ${product.name} بسعر ${product.price} ${currencyLabel}. ${getQuestion('want_more_info', language)}`
            : `We found ${product.name} for ${product.price} ${currencyLabel}. ${getQuestion('want_more_info', language)}`,
          ctaType: 'choose',
          recommendationStrategy: 'match_query',
          shouldOfferDiscount: false,
          handoffReason: ''
        };
      }

      const displayProducts = products.slice(0, 5);
      const productNames = displayProducts.map(p => p.name).join(language === 'arabic' ? ' و ' : ' and ');

      return {
        nextAction: 'recommend_products',
        oneQuestion: language === 'arabic'
          ? `لدينا ${productNames}${products.length > 5 ? ` وغيرها (${products.length} منتج)` : ''}. ${getQuestion('which_prefer', language)}`
          : `We have ${productNames}${products.length > 5 ? ` and more (${products.length} products)` : ''}. ${getQuestion('which_prefer', language)}`,
        ctaType: 'choose',
        recommendationStrategy: 'match_query',
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }

    return {
      nextAction: 'ask_clarify',
      oneQuestion: getQuestion('what_product', language),
      ctaType: 'choose',
      recommendationStrategy: null,
      shouldOfferDiscount: false,
      handoffReason: ''
    };
  }

  // ==================== RULE 8: Availability Check ====================
  if (intent === 'availability') {
    if (products.length > 0) {
      const product = products[0];
      
      // ✅ Enhanced availability messaging with urgency
      const hasLowStock = product.stock > 0 && product.stock <= 10;
      const hasVeryLowStock = product.stock > 0 && product.stock <= 3;
      
      let stockStatus = '';
      let urgencyText = '';
      
      if (product.stock <= 0) {
        stockStatus = language === 'arabic' ? 'غير متوفر حالياً ❌' : 'Currently out of stock ❌';
      } else if (hasVeryLowStock) {
        stockStatus = language === 'arabic' ? `متوفر ✅` : `In stock ✅`;
        urgencyText = language === 'arabic' 
          ? `⚠️ لكن متبقي ${product.stock} قطع فقط! سارع بالطلب 🔥`
          : `⚠️ But only ${product.stock} units left! Hurry 🔥`;
      } else if (hasLowStock) {
        stockStatus = language === 'arabic' ? `متوفر ✅` : `In stock ✅`;
        urgencyText = language === 'arabic' 
          ? `(متبقي ${product.stock} قطع) ⚡`
          : `(${product.stock} units left) ⚡`;
      } else {
        stockStatus = language === 'arabic' 
          ? `متوفر بكميات جيدة ✅ (${product.stock} قطعة)` 
          : `Available in good quantity ✅ (${product.stock} units)`;
      }

      const question = product.stock > 0
        ? getQuestion('proceed_with_order', language)
        : getQuestion('notify_when_available', language);

      const fullMessage = urgencyText 
        ? `${product.name} ${stockStatus}. ${urgencyText}\n\n${question}`
        : `${product.name} ${stockStatus}. ${question}`;

      return {
        nextAction: 'recommend_products',
        oneQuestion: fullMessage,
        ctaType: product.stock > 0 ? 'order' : 'confirm',
        recommendationStrategy: 'match_query',
        shouldOfferDiscount: hasVeryLowStock,
        handoffReason: ''
      };
    }

    return {
      nextAction: 'ask_clarify',
      oneQuestion: getQuestion('check_availability', language),
      ctaType: 'choose',
      recommendationStrategy: null,
      shouldOfferDiscount: false,
      handoffReason: ''
    };
  }

  // ==================== RULE 9: Shipping ====================
  if (intent === 'shipping') {
    if (!entities.city) {
      return {
        nextAction: 'confirm_city',
        oneQuestion: getQuestion('which_city', language),
        ctaType: 'confirm',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }

    return {
      nextAction: 'ask_clarify',
      oneQuestion: language === 'arabic'
        ? `التوصيل إلى ${entities.city} متاح. هل تريد معرفة تفاصيل الشحن؟`
        : `Delivery to ${entities.city} is available. Would you like shipping details?`,
      ctaType: 'confirm',
      recommendationStrategy: null,
      shouldOfferDiscount: false,
      handoffReason: ''
    };
  }

  // ==================== RULE 10: Comparison ====================
  if (intent === 'comparison') {
    if (products.length >= 2) {
      return {
        nextAction: 'recommend_products',
        oneQuestion: language === 'arabic'
          ? `لدينا ${products.length} خيارات. ${getQuestion('compare_which', language)}`
          : `We have ${products.length} options. ${getQuestion('compare_which', language)}`,
        ctaType: 'choose',
        recommendationStrategy: 'best_value',
        shouldOfferDiscount: false,
        handoffReason: ''
      };
    }

    return {
      nextAction: 'ask_clarify',
      oneQuestion: getQuestion('compare_which', language),
      ctaType: 'choose',
      recommendationStrategy: null,
      shouldOfferDiscount: false,
      handoffReason: ''
    };
  }

  // ==================== DEFAULT ====================
  return {
    nextAction: 'ask_clarify',
    oneQuestion: getQuestion('hello_help', language),
    ctaType: 'choose',
    recommendationStrategy: null,
    shouldOfferDiscount: false,
    handoffReason: ''
  };
};

// ==================== OBJECTION HANDLER ====================

/**
 * Handle specific objection types
 */
const handleObjection = (
  objection: Objection,
  products: Product[],
  language: Language
): SalesPlan => {
  switch (objection) {
    case 'price':
      const cheaperProducts = products.filter(p => p.price < (products[0]?.price || Infinity));
      if (cheaperProducts.length > 0) {
        return {
          nextAction: 'recommend_products',
          oneQuestion: getQuestion('cheaper_alternatives', language),
          ctaType: 'choose',
          recommendationStrategy: 'cheaper_alt',
          shouldOfferDiscount: false,
          handoffReason: ''
        };
      }
      return {
        nextAction: 'ask_clarify',
        oneQuestion: getQuestion('budget_question', language),
        ctaType: 'choose',
        recommendationStrategy: null,
        shouldOfferDiscount: true,
        handoffReason: ''
      };

    case 'trust':
      return {
        nextAction: 'ask_clarify',
        oneQuestion: getQuestion('warranty_info', language),
        ctaType: 'confirm',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };

    case 'shipping':
      return {
        nextAction: 'confirm_city',
        oneQuestion: getQuestion('shipping_details', language),
        ctaType: 'confirm',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };

    case 'quality':
      return {
        nextAction: 'recommend_products',
        oneQuestion: getQuestion('quality_options', language),
        ctaType: 'choose',
        recommendationStrategy: 'best_value',
        shouldOfferDiscount: false,
        handoffReason: ''
      };

    default:
      return {
        nextAction: 'ask_clarify',
        oneQuestion: getQuestion('what_looking_for', language),
        ctaType: 'choose',
        recommendationStrategy: null,
        shouldOfferDiscount: false,
        handoffReason: ''
      };
  }
};
