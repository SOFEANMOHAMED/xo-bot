/**
 * SalesGPT Conversation Stages
 * Defines the sales conversation flow stages
 * Adapted from SalesGPT Python project for SaaS e-commerce context
 */

export interface ConversationStageConfig {
    id: string;
    name: string;
    description_ar: string;
    description_en: string;
    goals: string[];
    transition_triggers: string[];
}

// ==================== CONVERSATION STAGES ====================

export const CONVERSATION_STAGES: Record<string, string> = {
    "1": "مقدمة: ابدأ المحادثة بترحيب ودود وتعريف نفسك كمساعد مبيعات المتجر. كن مهذباً ومحترماً. اسأل كيف يمكنك المساعدة.",
    "2": "اكتشاف الاحتياجات: اطرح أسئلة مفتوحة لمعرفة ما يبحث عنه العميل بالضبط. استمع بعناية لتفضيلاته ومتطلباته.",
    "3": "عرض القيمة: اشرح باختصار كيف يمكن لمنتجاتنا تلبية احتياجات العميل. ركز على نقاط البيع الفريدة والقيمة المضافة.",
    "4": "عرض الحلول: بناءً على احتياجات العميل، اعرض المنتجات المناسبة كحل لمتطلباته. اذكر المميزات والأسعار.",
    "5": "التعامل مع الاعتراضات: تعامل مع أي اعتراضات قد تكون لدى العميل بشأن المنتج أو السعر أو الشحن. قدم أدلة وشهادات.",
    "6": "إغلاق البيع: اطلب إتمام عملية الشراء واقترح الخطوة التالية. لخص ما يتم مناقشته وأعد التأكيد على الفوائد.",
    "7": "جمع معلومات الطلب: اجمع معلومات العميل اللازمة (الاسم، الهاتف، العنوان) وتفضيلات المنتج (اللون والمقاس إذا كانت متوفرة في المنتج) لإتمام الطلب.",
    "8": "تأكيد الطلب: أكد تفاصيل الطلب مع العميل واشكره على ثقته.",
    "9": "إنهاء المحادثة: انهِ المحادثة بشكل ودود وادع العميل للعودة في أي وقت."
};

export const CONVERSATION_STAGES_EN: Record<string, string> = {
    "1": "Introduction: Start the conversation by warmly greeting and introducing yourself as the store's sales assistant. Be polite and respectful. Ask how you can help.",
    "2": "Needs Discovery: Ask open-ended questions to find out what the customer is looking for. Listen carefully to their preferences and requirements.",
    "3": "Value Proposition: Briefly explain how your products can meet the customer's needs. Focus on unique selling points and added value.",
    "4": "Solution Presentation: Based on the customer's needs, present suitable products as solutions. Mention features and prices.",
    "5": "Objection Handling: Address any objections the customer may have about the product, price, or shipping. Provide evidence and testimonials.",
    "6": "Closing: Ask to complete the purchase and suggest the next step. Summarize what was discussed and reaffirm the benefits.",
    "7": "Order Information Collection: Collect necessary customer information (name, phone, address) and product preferences (color and size if available) to complete the order.",
    "8": "Order Confirmation: Confirm order details with the customer and thank them for their trust.",
    "9": "End Conversation: End the conversation warmly and invite the customer to return anytime."
};

// ==================== STAGE ANALYZER PROMPT ====================

export const STAGE_ANALYZER_PROMPT = `أنت مساعد مبيعات ذكي تساعد في تحديد المرحلة الحالية من محادثة البيع.

بداية تاريخ المحادثة:
===
{conversation_history}
===
نهاية تاريخ المحادثة.

المرحلة الحالية: {current_stage_id}

حدد المرحلة التالية المناسبة من الخيارات التالية:
{conversation_stages}

القواعد:
- أعد رقماً واحداً فقط (من 1 إلى 9)
- إذا كان تاريخ المحادثة فارغاً، ابدأ دائماً بالمرحلة 1 (المقدمة)
- إذا أظهر العميل رغبة في الشراء، انتقل للمرحلة 6 أو 7
- إذا لدى العميل اعتراض، انتقل للمرحلة 5
- إذا قدم العميل معلومات الطلب (اسم/هاتف/عنوان) أو يحتاج اختيار لون/مقاس، انتقل للمرحلة 7 أو 8
- لا تعد أي شيء آخر غير الرقم

الرقم:`;

/**
 * Get conversation stage description by ID
 */
export const getStageDescription = (stageId: string, language: 'arabic' | 'english' = 'arabic'): string => {
    const stages = language === 'arabic' ? CONVERSATION_STAGES : CONVERSATION_STAGES_EN;
    return stages[stageId] || stages["1"];
};

/**
 * Map SalesGPT stage ID to existing Stage type
 */
export const mapStageIdToStage = (stageId: string): string => {
    const mapping: Record<string, string> = {
        "1": "discover",
        "2": "discover",
        "3": "offer",
        "4": "offer",
        "5": "objection",
        "6": "close",
        "7": "close",
        "8": "close",
        "9": "close"
    };
    return mapping[stageId] || "discover";
};
