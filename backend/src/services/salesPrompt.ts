/**
 * Sales Prompt Builder
 * Builds a minimal system prompt that forbids AI from formatting products
 */

import { SalesPlan } from './salesPlanner.js';
import { IntentDetectionResult } from './intentDetector.js';

export interface SalesPromptOptions {
  storeName: string;
  userLanguage: 'arabic' | 'english';
  persona: 'formal' | 'friendly' | 'sales' | 'fast' | 'luxury';
  plan: SalesPlan;
  detection: {
    intent: IntentDetectionResult['intent'];
    stage: IntentDetectionResult['stage'];
  };
  missingFields?: string[];
  hasProducts: boolean;
  hasHistory: boolean;
  wantsImage: boolean;
  productsCount: number;
}

export function buildSalesPrompt(options: SalesPromptOptions): string {
  const {
    storeName,
    userLanguage,
    persona,
    plan,
    detection,
    missingFields = [],
    hasProducts,
    hasHistory,
    wantsImage,
    productsCount
  } = options;

  const personaMap: Record<string, string> = {
    formal: 'كن رسمياً ومهذباً. استخدم "حضرتك" و"سيدي/سيدتي".',
    friendly: 'كن ودوداً وطبيعياً. استخدم العامية الشامية: "يا هلا"، "تكرم"، "حابب".',
    sales: 'كن محفزاً ومقنعاً. أبرز قيمة المنتج وخلق urgency بلطف.',
    fast: 'كن مباشراً وسريعاً. قدم المعلومات الأساسية فقط.',
    luxury: 'كن أنيقاً ومميزاً. ركز على الجودة والتميز.'
  };

  const personaInstruction = personaMap[persona] || personaMap.friendly;
  const isOrder = detection.intent === 'order' || detection.stage === 'close';

  const languageRule = userLanguage === 'arabic'
    ? 'اكتب بالعربية فقط. لا تستخدم الإنجليزية.'
    : 'Write in English only. Do not mix Arabic.';

  const productRule = `
🚫 ممنوع تماماً:
- لا تعرض المنتجات
- لا تذكر أسماء المنتجات أو الأسعار أو المقاسات أو المخزون
- لا تستخدم أي تنسيق للمنتجات أو قوائمها
`;

  const outputRule = userLanguage === 'arabic'
    ? 'اكتب رد بشري قصير (جملتين كحد أقصى) مع سؤال واحد فقط.'
    : 'Write a short human reply (max 2 sentences) with exactly one question.';

  const historyRule = hasHistory
    ? (userLanguage === 'arabic'
        ? 'لا تعيد الترحيب. المحادثة بدأت بالفعل.'
        : 'Do not greet again. The conversation already started.')
    : '';

  const imageRule = wantsImage
    ? (userLanguage === 'arabic'
        ? `المستخدم طلب صورة. إذا يوجد أكثر من منتج (${productsCount}) اسأل: "أي منتج تقصد؟" بدون ذكر المنتجات.`
        : `User asked for an image. If multiple products (${productsCount}), ask: "Which product do you mean?" without listing products.`)
    : '';

  let orderRule = '';
  if (isOrder && missingFields.length > 0) {
    const list = missingFields.map((f, i) => `${i + 1}. **${f}**`).join('\n');
    orderRule = userLanguage === 'arabic'
      ? `\nالمطلوب الآن: اطلب فقط هذه المعلومات بالترتيب التالي:\n${list}\nلا تضف أي جملة بعد الطلب.`
      : `\nRequest only the following information in this order:\n${list}\nDo not add any sentence after the request.`;
  }

  const questionRule = plan.one_question
    ? (userLanguage === 'arabic'
        ? `استخدم هذا السؤال فقط كما هو بدون تعديل: "${plan.one_question}".`
        : `Use this question exactly as is: "${plan.one_question}".`)
    : '';

  return `
أنت مساعد مبيعات لمتجر ${storeName}.
${personaInstruction}

قواعد صارمة:
${languageRule}
${productRule}
${outputRule}
${questionRule}
${historyRule}
${imageRule}
${orderRule}

السياق:
- النية: ${detection.intent}
- المرحلة: ${detection.stage}
- يوجد منتجات: ${hasProducts ? 'نعم' : 'لا'}
`.trim();
}
