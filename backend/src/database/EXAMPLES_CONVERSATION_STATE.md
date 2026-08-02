# أمثلة استخدام دوال حالة المحادثة

## 1. getConversationByPlatformUser

```typescript
import { getConversationByPlatformUser } from '../controllers/conversation.controller.js';

// الحصول على محادثة حسب المنصة والمستخدم
const conversation = await getConversationByPlatformUser(
  merchantId,
  'facebook_messenger',
  'user_12345'
);

if (conversation) {
  console.log('Conversation found:', conversation.id);
  console.log('Current stage:', conversation.stage);
  console.log('Current intent:', conversation.currentIntent);
  console.log('State:', conversation.conversationState);
} else {
  console.log('Conversation not found');
}
```

## 2. updateConversationState - دمج JSONB

### مثال 1: تحديث بسيط
```typescript
import { updateConversationState } from '../controllers/conversation.controller.js';

// تحديث النية والمرحلة فقط
const updated = await updateConversationState(conversationId, {
  currentIntent: 'purchase',
  stage: 'offer'
});
```

### مثال 2: دمج conversation_state (يضيف حقول جديدة دون حذف القديمة)
```typescript
// الحالة الحالية في DB: { lead_score: 50, interests: ['tech'] }

// دمج جديد
const updated = await updateConversationState(conversationId, {
  conversationState: {
    lead_score: 75,  // تحديث قيمة موجودة
    last_recommended_products: ['prod-1', 'prod-2'],  // إضافة حقل جديد
    // interests سيبقى موجوداً (لا يتم حذفه)
  }
});

// النتيجة: { lead_score: 75, interests: ['tech'], last_recommended_products: ['prod-1', 'prod-2'] }
```

### مثال 3: دمج متعدد الحقول
```typescript
const updated = await updateConversationState(conversationId, {
  conversationState: {
    lead_score: 85,
    customer_interests: ['electronics', 'gadgets'],
    last_recommended_products: ['product-1', 'product-2'],
    objection_handled: true
  },
  currentIntent: 'browse',
  stage: 'offer',
  sessionMetadata: {
    source: 'facebook_messenger',
    user_agent: 'Mozilla/5.0...',
    referrer: 'https://facebook.com'
  }
});
```

### مثال 4: تحديث تدريجي (عدة استدعاءات)
```typescript
// الاستدعاء الأول
await updateConversationState(conversationId, {
  conversationState: {
    lead_score: 60,
    stage: 'discover'
  }
});

// الاستدعاء الثاني (يضيف حقول جديدة دون حذف القديمة)
await updateConversationState(conversationId, {
  conversationState: {
    lead_score: 75,  // يحدث القيمة
    interests: ['tech']  // يضيف حقل جديد
    // stage سيبقى موجوداً
  }
});

// النتيجة النهائية: { lead_score: 75, interests: ['tech'], stage: 'discover' }
```

## 3. appendMessage - إضافة رسالة مع metadata

### مثال 1: رسالة مستخدم بسيطة
```typescript
import { appendMessage } from '../controllers/conversation.controller.js';

const message = await appendMessage(
  conversationId,
  'user',
  'مرحباً، أريد شراء منتج',
  'user',  // sender_type
  'ext_msg_123',  // external_message_id
  undefined,  // metadata
  undefined,  // intent
  undefined   // entities
);
```

### مثال 2: رسالة مع metadata وintent وentities
```typescript
const message = await appendMessage(
  conversationId,
  'user',
  'أريد شراء هاتف ذكي بسعر أقل من 500 دولار',
  'user',
  'fb_msg_789',
  {
    platform: 'facebook_messenger',
    has_attachments: false,
    quick_reply: null,
    timestamp: new Date().toISOString()
  },
  'purchase',  // intent
  {
    product_category: 'electronics',
    product_type: 'smartphone',
    price_range: { max: 500, currency: 'USD' },
    intent_confidence: 0.9
  }
);
```

### مثال 3: رسالة مساعد مع توصيات
```typescript
const assistantMessage = await appendMessage(
  conversationId,
  'assistant',
  'لدينا مجموعة ممتازة من الهواتف الذكية في نطاق السعر المطلوب. هل تفضل ماركة معينة؟',
  'bot',
  null,
  {
    platform: 'facebook_messenger',
    response_time_ms: 250,
    model_used: 'gpt-4o-mini'
  },
  'recommend',  // intent
  {
    recommended_products: ['product-1', 'product-2', 'product-3'],
    response_type: 'recommendation',
    filters_applied: {
      category: 'electronics',
      max_price: 500
    }
  }
);
```

### مثال 4: رسالة نظام
```typescript
const systemMessage = await appendMessage(
  conversationId,
  'system',
  'Conversation stage changed to: offer',
  'system',
  null,
  {
    event_type: 'stage_change',
    previous_stage: 'discover',
    new_stage: 'offer'
  },
  null,
  {}
);
```

## 4. استخدام متكامل - سيناريو كامل

```typescript
import {
  getConversationByPlatformUser,
  updateConversationState,
  appendMessage
} from '../controllers/conversation.controller.js';

async function handleIncomingMessage(
  merchantId: string,
  platform: string,
  userId: string,
  messageText: string
) {
  // 1. الحصول على المحادثة أو إنشاؤها
  let conversation = await getConversationByPlatformUser(
    merchantId,
    platform,
    userId
  );

  if (!conversation) {
    // إنشاء محادثة جديدة (يجب أن يتم من controller)
    // هنا نفترض أنها موجودة
    throw new Error('Conversation not found');
  }

  // 2. حفظ رسالة المستخدم مع metadata
  const userMessage = await appendMessage(
    conversation.id,
    'user',
    messageText,
    'user',
    `ext_${Date.now()}`,
    {
      platform,
      timestamp: new Date().toISOString()
    },
    'browse',  // يمكن اكتشافه من AI
    {
      detected_keywords: ['product', 'price']
    }
  );

  // 3. تحديث حالة المحادثة بناءً على الرسالة
  await updateConversationState(conversation.id, {
    conversationState: {
      last_user_message: messageText,
      message_count: (conversation.conversationState.message_count || 0) + 1,
      last_interaction: new Date().toISOString()
    },
    currentIntent: 'browse',
    stage: 'discover'
  });

  // 4. إذا كان المستخدم يسأل عن منتج معين، تحديث lead_score
  if (messageText.includes('شراء') || messageText.includes('سعر')) {
    await updateConversationState(conversation.id, {
      conversationState: {
        lead_score: Math.min(
          (conversation.conversationState.lead_score || 0) + 10,
          100
        ),
        purchase_intent: true
      },
      stage: 'offer'
    });
  }

  return {
    conversationId: conversation.id,
    messageId: userMessage.id
  };
}
```

## 5. استعلامات JSONB مفيدة

### البحث في conversation_state
```sql
-- البحث عن محادثات مع lead_score > 70
SELECT * FROM conversations 
WHERE (conversation_state->>'lead_score')::int > 70;

-- البحث عن محادثات تحتوي على منتج معين في last_recommended_products
SELECT * FROM conversations 
WHERE conversation_state @> '{"last_recommended_products": ["product-1"]}';

-- البحث في entities
SELECT * FROM messages 
WHERE entities @> '{"product_category": "electronics"}';
```

## ملاحظات مهمة

1. **دمج JSONB**: `updateConversationState` يستخدم `||` operator لدمج JSONB، مما يعني:
   - الحقول الموجودة يتم تحديثها
   - الحقول الجديدة يتم إضافتها
   - الحقول غير المذكورة تبقى كما هي

2. **الأمان**: جميع الدوال تستخدم parameterized queries لمنع SQL injection

3. **الأداء**: الفهارس GIN على JSONB columns تسمح بالبحث السريع في البيانات

4. **القيم الافتراضية**: إذا لم يتم توفير metadata أو entities، يتم استخدام `{}` كقيمة افتراضية

