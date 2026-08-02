# XoBot - نظام البوت الذكي

## المعمارية الجديدة

```
src/
├── core/                           # النواة الأساسية
│   ├── orchestrator.ts            # المايسترو - ينسق كل شيء
│   ├── pipeline-router.ts         # يحدد أي pipeline نستخدم
│   ├── error-handler.ts           # معالجة الأخطاء المركزية
│   ├── types.ts                   # الأنواع المشتركة
│   └── index.ts                   # نقطة التصدير
│
├── pipelines/                      # خطوط المعالجة
│   ├── smart-pipeline/            # Pipeline ذكي (يستخدم AI)
│   │   ├── intent-detector.ts    # كشف النية (AI)
│   │   ├── context-manager.ts    # إدارة السياق
│   │   └── index.ts
│   │
│   └── simple-pipeline/           # Pipeline بسيط (rules فقط)
│       ├── greeting-handler.ts   # معالج الترحيب
│       ├── confirmation-handler.ts # معالج التأكيد
│       └── index.ts
│
├── catalog/                        # نظام الكتالوج
│   ├── product-search.ts          # البحث الذكي (Arabic support)
│   ├── product-formatter.ts       # التنسيق (مصدر واحد)
│   ├── cache-manager.ts           # إدارة الكاش
│   └── index.ts
│
├── sales/                          # منطق المبيعات
│   ├── sales-rules.ts             # قواعد المبيعات (deterministic)
│   ├── recommendation-engine.ts   # محرك التوصيات
│   └── index.ts
│
├── orders/                         # نظام الطلبات
│   ├── order-validator.ts         # التحقق من الطلبات
│   ├── order-builder.ts           # بناء الطلب
│   └── index.ts
│
├── response/                       # بناء الردود
│   ├── response-builder.ts        # بناء الرد النهائي
│   ├── guard.ts                   # فحص الجودة
│   ├── templates/                 # قوالب الرسائل
│   │   ├── ar/messages.ts        # عربي
│   │   └── en/messages.ts        # إنجليزي
│   └── index.ts
│
├── ai/                             # خدمات AI
│   ├── gemini-client.ts           # عميل OpenAI
│   ├── prompt-builder.ts          # بناء Prompts
│   └── index.ts
│
└── bot/                            # نقطة الدخول
    ├── index.ts                   # التصدير الرئيسي
    └── README.md                  # هذا الملف
```

## المميزات الرئيسية

### 1. تقليل استدعاءات AI
- **Simple Pipeline**: يعالج الترحيبات والتأكيدات بدون AI
- **Smart Pipeline**: يستخدم AI فقط عند الحاجة
- **Caching**: تخزين مؤقت للنتائج المتكررة

### 2. دعم متعدد اللغات
- دعم كامل للعربية والإنجليزية
- كشف تلقائي للغة المستخدم
- قوالب منفصلة لكل لغة

### 3. نظام ذكي للاعتراضات
- كشف نوع الاعتراض (سعر، ثقة، شحن، جودة)
- استراتيجيات مخصصة لكل نوع
- ردود محددة ومقنعة

### 4. SaaS Ready
- عزل كامل بين المتاجر (merchantId)
- تخزين مؤقت على مستوى المتجر
- إعدادات مخصصة لكل متجر

## الاستخدام

```typescript
import { handleIncomingMessage } from './bot';

const result = await handleIncomingMessage({
  merchantId: 'merchant-123',
  platform: 'telegram',
  userId: 'user-456',
  messageText: 'مرحبا، شو عندكم منتجات؟',
  merchantConfig: {
    storeName: 'متجر الأناقة',
    storeCurrency: 'SYP',
    persona: 'friendly',
    botLanguage: 'auto'
  }
});

console.log(result.replyText);
// الرد على المستخدم

console.log(result.meta);
// { intent: 'browse', stage: 'discover', pipelineUsed: 'smart', ... }
```

## تدفق المعالجة

```
رسالة المستخدم
     ↓
Pipeline Router ←── هل رسالة بسيطة؟
     ↓                    ↓
   نعم                   لا
     ↓                    ↓
Simple Pipeline      Smart Pipeline
     ↓                    ↓
     ↓              Intent Detection (AI)
     ↓                    ↓
     ↓              Product Search
     ↓                    ↓
     ↓              Sales Planning
     ↓                    ↓
     ↓              Response Building
     ↓                    ↓
     └────────────────────┘
              ↓
         Guard Check
              ↓
         رد البوت
```

## الأنواع الرئيسية

### Intent (النية)
- `greeting` - ترحيب
- `browse` - تصفح المنتجات
- `product_query` - استفسار عن منتج
- `price` - سؤال عن السعر
- `availability` - سؤال عن التوفر
- `shipping` - سؤال عن الشحن
- `comparison` - مقارنة
- `order` - طلب شراء
- `complaint` - شكوى
- `other` - أخرى

### Stage (المرحلة)
- `discover` - اكتشاف
- `offer` - عرض
- `objection` - اعتراض
- `close` - إغلاق
- `handoff` - تحويل للدعم
- `clarify` - توضيح

### Objection (الاعتراض)
- `price` - السعر غالي
- `trust` - عدم الثقة
- `shipping` - مشاكل الشحن
- `quality` - قلق على الجودة

## التكامل مع النظام الحالي

للتكامل مع `orchestrator.service.ts` الحالي:

```typescript
import { handleIncomingMessage } from './bot';

// في handleIncomingMessage القديم:
const result = await handleIncomingMessage({
  merchantId: params.merchantId,
  platform: params.platform,
  userId: params.userId,
  messageText: params.messageText,
  recentMessages: messageHistory,
  conversationState: conversation.conversationState,
  merchantConfig: {
    storeName: merchantPolicies.storeName,
    storeCurrency: merchantPolicies.storeCurrency,
    persona: merchantPolicies.persona,
    botLanguage: merchantPolicies.botLanguage
  }
});

return result.replyText;
```
