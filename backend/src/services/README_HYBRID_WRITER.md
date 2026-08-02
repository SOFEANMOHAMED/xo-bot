# Hybrid Sales Writer

نظام يجمع بين:
- **النظام القديم المتقدم**: استخدام الـ prompts المتقدمة من `generateChatResponseHelper` (تقنيات المبيعات المتقدمة)
- **النظام الجديد المنظم**: التحكم من Orchestrator + Sales Planner (structured input)

## المميزات

1. **Advanced Sales Techniques**: يستخدم نفس الـ prompts المتقدمة (Objection Handling, Closing Techniques, Value Framing, etc.)
2. **Structured Control**: يتبع خطة محددة من Sales Planner (next_action, one_question, cta_type)
3. **Strict Rules**: 
   - 120 كلمة كحد أقصى
   - سؤال واحد فقط (يجب أن يكون plan.one_question)
   - CTA محدد حسب plan.cta_type
   - لا يخترع معلومات (يستخدم فقط toolResults و merchantPolicies)

## Input Format

```typescript
{
  merchantId: string;
  platform: 'web' | 'facebook_messenger' | 'facebook_comment' | 'telegram';
  messageText: string;
  recentMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  detection: {
    intent: string;
    stage: string;
    objection: string | null;
    entities: Record<string, any>;
    missing_fields: string[];
  };
  plan: {
    next_action: 'ask_clarify' | 'recommend_products' | 'confirm_variant' | 'confirm_city' | 'send_checkout' | 'handoff';
    one_question: string;
    cta_type: 'choose' | 'confirm' | 'order' | 'support';
    recommendation_strategy: string | null;
    should_offer_discount: boolean;
    handoff_reason: string;
  };
  toolResults?: ToolResult[];
  conversationState: Record<string, any>;
  merchantPolicies?: {
    shippingPolicy?: string;
    deliveryTime?: string;
    paymentMethods?: string;
    returnPolicy?: string;
    additionalNotes?: string;
    storeName?: string;
    storeCurrency?: string;
    systemPrompt?: string;
    persona?: 'formal' | 'friendly' | 'sales' | 'fast' | 'luxury';
  };
}
```

## Output Rules

1. **Arabic Only**: الرد بالعربية فقط
2. **Max 120 Words**: الحد الأقصى 120 كلمة
3. **Exactly ONE Question**: يجب أن يحتوي على سؤال واحد فقط (plan.one_question)
4. **CTA Aligned**: يجب أن يتضمن CTA حسب plan.cta_type
5. **No Invented Data**: 
   - لا يخترع أسعار (يستخدم فقط من toolResults)
   - لا يخترع معلومات عن المخزون (يستخدم فقط من toolResults)
   - لا يخترع معلومات عن الشحن (يستخدم فقط من merchantPolicies)
6. **Handoff Short**: إذا كان plan.next_action=handoff، رد قصير عن الدعم فقط

## أمثلة

### مثال 1: Greeting
```typescript
Input: {
  detection: { intent: 'browse', stage: 'discover', ... },
  plan: { next_action: 'ask_clarify', one_question: 'مرحباً بك! كيف يمكنني مساعدتك اليوم؟', ... }
}
Output: "مرحباً بك في متجر الأجهزة الذكية! نحن هنا لمساعدتك في العثور على أفضل المنتجات. مرحباً بك! كيف يمكنني مساعدتك اليوم؟"
```

### مثال 2: Price Question
```typescript
Input: {
  detection: { intent: 'price', entities: { product_query: 'هاتف ذكي' }, ... },
  plan: { next_action: 'recommend_products', one_question: 'هل تريد معرفة المزيد عن هذا المنتج؟', ... },
  toolResults: [{ name: 'catalog', data: { products: [{ name: 'هاتف ذكي', price: 500, ... }] } }]
}
Output: "ممتاز! لدينا هاتف ذكي بسعر 500 دولار. هذا المنتج بمواصفات عالية ويوفر لك تجربة رائعة. هل تريد معرفة المزيد عن هذا المنتج؟"
```

### مثال 3: Shipping Question
```typescript
Input: {
  detection: { intent: 'shipping', ... },
  plan: { next_action: 'confirm_city', one_question: 'إلى أي مدينة تريد التوصيل؟', ... },
  merchantPolicies: { shippingPolicy: 'الشحن مجاني للطلبات فوق 100 دولار', deliveryTime: '3-5 أيام عمل' }
}
Output: "نقدم خدمة توصيل ممتازة! الشحن مجاني للطلبات فوق 100 دولار، والتوصيل يستغرق 3-5 أيام عمل. إلى أي مدينة تريد التوصيل؟"
```

### مثال 4: "Too Expensive" Objection
```typescript
Input: {
  detection: { intent: 'price', stage: 'objection', objection: 'price', ... },
  plan: { next_action: 'ask_clarify', one_question: 'ما الميزانية المفضلة لديك؟', should_offer_discount: true, ... },
  toolResults: [{ name: 'catalog', data: { products: [{ price: 500 }, { price: 300 }] } }]
}
Output: "أفهم أن السعر مهم بالنسبة لك. لدينا خيارات بأسعار مختلفة تبدأ من 300 دولار. دعني أوضح لك القيمة الحقيقية لكل خيار. ما الميزانية المفضلة لديك؟"
```

### مثال 5: "I Want to Order"
```typescript
Input: {
  detection: { intent: 'order', stage: 'close', missing_fields: ['city'], ... },
  plan: { next_action: 'confirm_city', one_question: 'إلى أي مدينة تريد التوصيل؟', cta_type: 'confirm', ... },
  toolResults: [{ name: 'catalog', data: { products: [{ name: 'هاتف ذكي', price: 500 }] } }]
}
Output: "ممتاز! سأقوم بإعداد طلبك لهاتف ذكي بسعر 500 دولار الآن. للتوصيل، إلى أي مدينة تريد التوصيل؟"
```

## الاستخدام

```typescript
import { generateSalesReply } from './hybridWriter.js';

const reply = await generateSalesReply({
  merchantId: 'merchant-123',
  platform: 'telegram',
  messageText: 'كم سعر الهاتف؟',
  recentMessages: [...],
  detection: { intent: 'price', stage: 'offer', ... },
  plan: { next_action: 'recommend_products', one_question: 'هل تريد معرفة المزيد؟', ... },
  toolResults: [catalogResult],
  conversationState: {},
  merchantPolicies: { storeName: 'متجري', storeCurrency: 'USD', persona: 'friendly' }
});
```

## الاختبار

```bash
npm run test-hybrid-writer
```

## الفرق بين Hybrid Writer و Legacy Helper

| Feature | Legacy Helper | Hybrid Writer |
|---------|--------------|--------------|
| **Input** | Unstructured (messages, products, policies) | Structured (detection, plan, toolResults) |
| **Control** | AI decides everything | Orchestrator controls (next_action, one_question) |
| **Length** | No limit | Max 120 words |
| **Questions** | Can ask multiple | Exactly ONE question |
| **Data** | Can infer/invent | Only uses toolResults + merchantPolicies |
| **Sales Techniques** | ✅ Advanced | ✅ Advanced (same prompts) |
| **Use Case** | Flexible, open-ended | Controlled, structured, progress-focused |

## Integration

Hybrid Writer يجب أن يُستخدم في Orchestrator بدلاً من القوالب البسيطة:

```typescript
// In orchestrator.service.ts
import { generateSalesReply } from './hybridWriter.js';

const reply = await generateSalesReply({
  merchantId,
  platform,
  messageText,
  recentMessages,
  detection: { intent, stage, objection, entities, missing_fields },
  plan: salesPlan,
  toolResults: [catalogResult],
  conversationState,
  merchantPolicies: { ... }
});
```

