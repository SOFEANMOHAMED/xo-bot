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
    "3": "عرض القيمة: من وصف المنتج النشط، اشرح كيف يلبي احتياج العميل. ركز على فوائد حقيقية موجودة في الوصف فقط.",
    "4": "عرض الحلول: اعرض المنتج المناسب مع السعر و2–3 فوائد مستخرجة من وصفه، ثم اسأل سؤالاً يدفع للقرار.",
    "5": "التعامل مع الاعتراضات: اعترف بالمخاوف وردّ بحجج من وصف المنتج أو سياسات المتجر فقط — بدون اختلاق.",
    "6": "إغلاق البيع: أعد تأكيد أقوى فائدة من الوصف، ثم اطلب إتمام الشراء بشكل مريح.",
    "7": "جمع معلومات الطلب: اجمع معلومات العميل اللازمة (الاسم، الهاتف، العنوان) وتفضيلات المنتج (اللون والمقاس إذا كانت متوفرة في المنتج) لإتمام الطلب.",
    "8": "تأكيد الطلب: أكد تفاصيل الطلب مع العميل واشكره على ثقته.",
    "9": "إنهاء المحادثة: انهِ المحادثة بشكل ودود وادع العميل للعودة في أي وقت."
};

export const CONVERSATION_STAGES_EN: Record<string, string> = {
    "1": "Introduction: Start the conversation by warmly greeting and introducing yourself as the store's sales assistant. Be polite and respectful. Ask how you can help.",
    "2": "Needs Discovery: Ask open-ended questions to find out what the customer is looking for. Listen carefully to their preferences and requirements.",
    "3": "Value Proposition: Using the active product description, explain how it meets the customer's need. Only real benefits from the description.",
    "4": "Solution Presentation: Present the suitable product with price and 2–3 benefits extracted from its description, then ask a decision-driving question.",
    "5": "Objection Handling: Acknowledge concerns and answer with evidence from the product description or store policies only — never invent.",
    "6": "Closing: Reaffirm the strongest benefit from the description, then ask to complete the purchase comfortably.",
    "7": "Order Information Collection: Collect necessary customer information (name, phone, address) and product preferences (color and size if available) to complete the order.",
    "8": "Order Confirmation: Confirm order details with the customer and thank them for their trust.",
    "9": "End Conversation: End the conversation warmly and invite the customer to return anytime."
};

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
