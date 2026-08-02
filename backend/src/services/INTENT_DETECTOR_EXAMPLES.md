# أمثلة استخدام Intent Detector

## الوظيفة الرئيسية

```typescript
import { detectIntentAndEntities } from './intentDetector.js';

const result = await detectIntentAndEntities(
  messageText,
  history,
  conversationState
);
```

## مثال 1: رسالة بسيطة

**المدخل:**
```typescript
const result = await detectIntentAndEntities(
  'كم سعر الهاتف الذكي؟',
  [],
  {}
);
```

**المخرجات (JSON):**
```json
{
  "intent": "price",
  "stage": "offer",
  "objection": null,
  "entities": {
    "product_query": "هاتف ذكي"
  },
  "missing_fields": [],
  "confidence": 0.9
}
```

## مثال 2: رسالة مع كيانات متعددة

**المدخل:**
```typescript
const result = await detectIntentAndEntities(
  'أريد شراء هاتف ذكي بحجم كبير بسعر أقل من 500 دولار في دمشق',
  [],
  {}
);
```

**المخرجات (JSON):**
```json
{
  "intent": "order",
  "stage": "close",
  "objection": null,
  "entities": {
    "product_query": "هاتف ذكي",
    "size": "كبير",
    "budget": "500",
    "city": "دمشق"
  },
  "missing_fields": ["phone", "address"],
  "confidence": 0.95
}
```

## مثال 3: رسالة مع اعتراض

**المدخل:**
```typescript
const result = await detectIntentAndEntities(
  'السعر غالي جداً، هل يوجد خصم؟',
  [],
  { current_intent: "price", stage: "offer" }
);
```

**المخرجات (JSON):**
```json
{
  "intent": "objection",
  "stage": "objection",
  "objection": "السعر غالي جداً",
  "entities": {},
  "missing_fields": [],
  "confidence": 0.85
}
```

## مثال 4: مع سياق المحادثة

**المدخل:**
```typescript
const history = [
  { role: 'user', content: 'أريد شراء هاتف' },
  { role: 'assistant', content: 'لدينا عدة هواتف. ما الميزانية المفضلة؟' },
  { role: 'user', content: 'حوالي 300 دولار' }
];

const result = await detectIntentAndEntities(
  'في دمشق',
  history,
  { current_intent: "order", stage: "close" }
);
```

**المخرجات (JSON):**
```json
{
  "intent": "order",
  "stage": "close",
  "objection": null,
  "entities": {
    "product_query": "هاتف",
    "budget": "300",
    "city": "دمشق"
  },
  "missing_fields": ["phone", "address", "name"],
  "confidence": 0.92
}
```

## مثال 5: شكوى

**المدخل:**
```typescript
const result = await detectIntentAndEntities(
  'المنتج الذي وصلني تالف، أنا غاضب جداً',
  [],
  {}
);
```

**المخرجات (JSON):**
```json
{
  "intent": "complaint",
  "stage": "handoff",
  "objection": "المنتج تالف",
  "entities": {},
  "missing_fields": [],
  "confidence": 0.98
}
```

## استخدام النتائج في Orchestrator

```typescript
// في orchestrator.service.ts
const detectionResult = await detectIntentAndEntities(
  messageText,
  messageHistory,
  conversation.conversationState
);

// استخدام النتائج
const intent = detectionResult.intent;
const stage = detectionResult.stage;
const entities = detectionResult.entities;
const objection = detectionResult.objection;
const missingFields = detectionResult.missing_fields;

// البحث عن المنتجات باستخدام product_query من entities
if (entities.product_query) {
  products = await catalogSearchProducts(
    merchantId,
    entities.product_query,
    { inStockOnly: true }
  );
}

// حفظ في conversation_state
await updateConversationState(conversationId, {
  conversationState: {
    extracted_entities: entities,
    missing_fields: missingFields,
    objection: objection
  },
  currentIntent: intent,
  stage: stage
});

// حفظ في messages
await appendMessage(
  conversationId,
  'user',
  messageText,
  'user',
  externalMessageId,
  { confidence: detectionResult.confidence },
  intent,
  entities
);
```

## Logging

Intent Detector يسجل النتائج تلقائياً:

```typescript
logger.info('AI Intent Detection Result', {
  merchantId,
  conversationId,
  intent: detectedIntent,
  stage: newStage,
  objection,
  entities: detectedEntities,
  missingFields,
  confidence
});
```

## Fallback

إذا فشل AI أو لم يكن متاحاً، يتم استخدام rule-based detection:

```typescript
// Fallback يعيد:
{
  intent: "browse", // أو intent محدد من القواعد
  stage: "discover",
  objection: null,
  entities: {}, // كيانات بسيطة مستخرجة من patterns
  missing_fields: [],
  confidence: 0.6 // ثقة أقل
}
```

## ملاحظات مهمة

1. **JSON فقط**: AI يجب أن يرجع JSON صحيح فقط، بدون نص إضافي
2. **Parameterized**: جميع المدخلات آمنة (لا SQL injection)
3. **SaaS Isolation**: merchantId مطلوب في جميع الاستدعاءات
4. **Error Handling**: معالجة أخطاء شاملة مع fallback
5. **Logging**: جميع النتائج يتم تسجيلها للتحليل

