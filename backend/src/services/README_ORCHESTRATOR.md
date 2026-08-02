# Orchestrator Core

نظام موحد (unified) لمعالجة الرسائل من جميع القنوات (Facebook, Telegram, future channels).

## المميزات

1. **Channel-Agnostic**: يعمل مع جميع القنوات (Facebook, Telegram, WhatsApp, Web, etc.)
2. **Unified Pipeline**: نفس الـ pipeline لجميع القنوات
3. **Fallback Mechanism**: إذا فشل Orchestrator، يستخدم `generateChatResponseHelper` (legacy)
4. **Guard Checks**: يتحقق من ONE question و no hallucinated numbers
5. **State Management**: يحفظ conversation state, intent, stage, entities, lead_score

## Pipeline Steps

1. **getOrCreateConversation** - إنشاء أو جلب المحادثة
2. **getRecentMessages** - جلب آخر 10 رسائل
3. **detectIntentAndEntities** - استخراج النية والكيانات (AI)
4. **executeToolsForIntent** - تنفيذ الأدوات حسب النية (catalogTool, etc.)
5. **planSalesAction** - تخطيط الإجراء التالي (Sales Planner)
6. **generateSalesReply** - توليد الرد (Hybrid Writer)
7. **Guard Checks** - التحقق من ONE question + no hallucinated numbers
8. **appendMessage(user)** - حفظ رسالة المستخدم
9. **appendMessage(assistant)** - حفظ رد البوت
10. **patchConversationState** - تحديث حالة المحادثة
11. **Return replyText** - إرجاع النص

## API

### handleIncomingMessage

```typescript
const result = await handleIncomingMessage({
  merchantId: string,
  platform: 'facebook' | 'telegram' | 'web' | 'whatsapp',
  userId: string,
  messageText: string,
  externalMessageId?: string,
  rawEventMetadata?: Record<string, any>,
  userName?: string,
  merchantPolicies?: {
    storeName?: string;
    storeCurrency?: string;
    systemPrompt?: string;
    persona?: 'formal' | 'friendly' | 'sales' | 'fast' | 'luxury';
    shippingPolicy?: string;
    deliveryTime?: string;
    paymentMethods?: string;
    returnPolicy?: string;
    additionalNotes?: string;
  }
});

// Returns:
{
  replyText: string;
  meta: {
    conversationId: string;
    intent: string;
    stage: string;
    toolResultsCount: number;
    usedFallback: boolean;
  }
}
```

## Guard Checks

### 1. ONE Question Check
```typescript
const hasOneQuestion = (text: string): boolean => {
  const questionMarks = (text.match(/[؟?]/g) || []).length;
  return questionMarks === 1;
};
```

إذا لم يكن هناك سؤال واحد، يستخدم `salesPlan.one_question` كـ fallback.

### 2. No Hallucinated Numbers
```typescript
const hasNoHallucinatedNumbers = (replyText: string, toolResults: any[]): boolean => {
  // يتحقق من أن الأرقام في الرد موجودة في toolResults
  // (prices, stock, etc.)
};
```

## Fallback Mechanism

إذا فشل Orchestrator (خطأ في AI، خطأ في tools، etc.):

1. **Catch Error** - يتم التقاط الخطأ
2. **Get Merchant Settings** - جلب إعدادات المتجر
3. **Get Products** - جلب المنتجات
4. **Call generateChatResponseHelper** - استخدام النظام القديم
5. **Save Messages** - حفظ الرسائل
6. **Set Error** - حفظ الخطأ في `conversation.last_error`
7. **Return Reply** - إرجاع الرد من النظام القديم

## Integration

### Facebook Controller

```typescript
// Before (old):
const responseText = await processMessage({ ... });

// After (new):
const result = await handleIncomingMessage({
  merchantId: merchant_id,
  platform: 'facebook',
  userId: senderId,
  messageText,
  externalMessageId: messageId,
  rawEventMetadata: { pageId, senderId, messageId },
  merchantPolicies: { ... }
});
const responseText = result.replyText;
```

### Telegram Controller

```typescript
// Before (old):
const responseText = await generateChatResponseHelper({ ... });

// After (new):
const result = await handleIncomingMessage({
  merchantId,
  platform: 'telegram',
  userId,
  messageText,
  externalMessageId: message.message_id?.toString(),
  rawEventMetadata: { chatId, botId, botType },
  merchantPolicies: { ... }
});
const responseText = result.replyText;
```

## Constraints Preserved

### 1. bot_disabled Logic
- يتم فحص `bot_disabled` في `facebook.controller.ts` قبل استدعاء Orchestrator
- إذا كان `bot_disabled = true` أو `status = 'human'`، لا يتم استدعاء Orchestrator

### 2. auto_reply_messenger Setting
- يتم فحص `auto_reply_messenger` في `facebook.controller.ts` قبل معالجة الرسالة
- إذا كان `auto_reply_messenger = false`، لا يتم معالجة الرسالة

### 3. Human Response Detection
- إذا كانت آخر رسالة من إنسان خلال آخر 5 دقائق، لا يتم إرسال رد تلقائي

## State Management

يتم حفظ المعلومات التالية في `conversation_state`:

```json
{
  "last_intent": "price",
  "last_user_message": "كم سعر الهاتف؟",
  "message_count": 5,
  "last_recommended_products": ["product-1", "product-2"],
  "last_interaction": "2024-01-01T12:00:00Z",
  "lead_score": 45,
  "last_detection": {
    "intent": "price",
    "stage": "offer",
    "objection": null,
    "entities": { "product_query": "هاتف" },
    "missing_fields": [],
    "confidence": 0.9,
    "timestamp": "2024-01-01T12:00:00Z"
  },
  "extracted_entities": { "product_query": "هاتف" },
  "missing_fields": [],
  "objection": null,
  "sales_plan": {
    "next_action": "recommend_products",
    "cta_type": "choose",
    "recommendation_strategy": "match_query"
  }
}
```

## Lead Score Calculation

```typescript
const calculateLeadScore = (stage, intent, entities) => {
  let score = 0;
  
  // Stage-based: discover=10, offer=30, objection=50, close=80, handoff=20
  // Intent-based: order=+20, price/availability=+10
  // Entity-based: city=+5, quantity=+5, product_id=+10
  
  return Math.min(100, score);
};
```

## Testing

```bash
npm run test-orchestrator
```

## Logs

Orchestrator يسجل:
- Intent detection results
- Tool execution results
- Sales plan generation
- Guard check warnings
- Fallback usage
- Errors

## Future Enhancements

1. **More Tools**: shippingTool, checkoutTool, etc.
2. **Better Guard Checks**: أكثر تطوراً للتحقق من الأرقام
3. **A/B Testing**: اختبار استراتيجيات مختلفة
4. **Analytics**: تتبع أداء Orchestrator
5. **Multi-language**: دعم لغات أخرى
