# Conversation Helpers - Channel-Agnostic Orchestrator

## الدوال المتاحة

### 1. `getOrCreateConversationHelper(params)`

إنشاء أو جلب محادثة (helper function، ليست route handler).

```typescript
const conversation = await getOrCreateConversationHelper({
  merchantId: 'uuid',
  platform: 'facebook_messenger',
  userId: 'user123'
});

// Returns:
{
  id: string;
  merchantId: string;
  platform: string;
  userId: string | null;
  userName: string | null;
  conversationState: any;
  currentIntent: string | null;
  sessionMetadata: any;
  stage: string;
  lastError: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

**ملاحظات:**
- إذا لم توجد محادثة، يتم إنشاؤها مع defaults: `stage='discover'`, `conversation_state='{}'`
- تستخدم الفهرس المركب `(merchant_id, platform, user_id)` للبحث السريع

---

### 2. `getRecentMessages(conversationId, limit=10)`

جلب آخر N رسائل مرتبة تصاعدياً (من الأقدم للأحدث).

```typescript
const messages = await getRecentMessages(conversationId, 10);

// Returns:
Array<{
  id: string;
  conversationId: string;
  role: string;
  content: string;
  metadata: any;
  intent: string | null;
  entities: any;
  createdAt: Date;
}>
```

**ملاحظات:**
- الترتيب: `ORDER BY created_at ASC` (الأقدم أولاً)
- Default limit: 10

---

### 3. `appendMessage(...)`

إضافة رسالة للمحادثة. يدعم توقيعين:

#### التوقيع القديم (للتوافق مع الكود الموجود):
```typescript
const message = await appendMessage(
  conversationId,
  'user',
  'مرحباً',
  'user', // sender_type
  'ext_msg_001', // external_message_id
  { platform: 'facebook' }, // metadata
  'browse', // intent
  { product_query: 'منتج' } // entities
);
```

#### التوقيع الجديد (object-based):
```typescript
const message = await appendMessage({
  conversationId,
  role: 'assistant',
  content: 'مرحباً بك!',
  sender_type: 'bot',
  external_message_id: null,
  metadata: { platform: 'telegram' },
  intent: 'greeting',
  entities: {}
});
```

**ملاحظات:**
- جميع المعاملات اختيارية (defaults آمنة)
- `metadata` و `entities` يتم تحويلها تلقائياً إلى JSONB
- يتم تحديث `last_message_at` و `updated_at` تلقائياً

---

### 4. `patchConversationState(conversationId, patch)`

تحديث حالة المحادثة (merge JSONB، تحديث الأعمدة).

```typescript
const updated = await patchConversationState(conversationId, {
  conversation_state: {
    lead_score: 75,
    interests: ['electronics']
  },
  current_intent: 'price',
  stage: 'offer',
  session_metadata: {
    source_channel: 'facebook'
  }
});
```

**ملاحظات:**
- `conversation_state` يتم merge (ليس overwrite)
- `session_metadata` يتم merge (ليس overwrite)
- `current_intent` و `stage` يتم تحديثهما مباشرة
- يتم تحديث `updated_at` تلقائياً

---

### 5. `setConversationError(conversationId, errorMessage)`

تخزين آخر خطأ حدث في المحادثة.

```typescript
await setConversationError(conversationId, 'AI service unavailable');

// أو مسح الخطأ:
await setConversationError(conversationId, null);
```

**ملاحظات:**
- يتم تحديث `last_error` و `updated_at`
- يمكن تمرير `null` لمسح الخطأ

---

## أمثلة الاستخدام

### مثال كامل: معالجة رسالة

```typescript
import {
  getOrCreateConversationHelper,
  appendMessage,
  patchConversationState,
  getRecentMessages,
  setConversationError
} from '../controllers/conversation.controller.js';

async function processMessage(merchantId: string, platform: string, userId: string, messageText: string) {
  try {
    // 1. Get or create conversation
    const conversation = await getOrCreateConversationHelper({
      merchantId,
      platform,
      userId
    });

    // 2. Get recent messages for context
    const recentMessages = await getRecentMessages(conversation.id, 10);

    // 3. Append user message
    await appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: messageText,
      sender_type: 'user',
      metadata: { platform },
      intent: 'browse', // Will be updated by AI
      entities: {}
    });

    // 4. Process message (AI, tools, etc.)
    // ... your logic here ...

    // 5. Update conversation state
    await patchConversationState(conversation.id, {
      conversation_state: {
        last_intent: 'price',
        last_user_message: messageText
      },
      current_intent: 'price',
      stage: 'offer'
    });

    // 6. Append assistant reply
    await appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'سعر المنتج هو 100 دولار',
      sender_type: 'bot',
      intent: 'provide_price',
      entities: { price: '100' }
    });

  } catch (error) {
    // 7. Store error
    await setConversationError(conversation.id, error.message);
    throw error;
  }
}
```

---

## الاختبار

```bash
npm run test-hybrid-orchestrator-helpers
```

الـ test script يختبر:
- إنشاء محادثة جديدة
- جلب محادثة موجودة
- إضافة رسائل (التوقيعين)
- جلب الرسائل الأخيرة
- تحديث حالة المحادثة (merge)
- تخزين الأخطاء

---

## التوافق مع الكود الموجود

- `getConversationByPlatformUser()` - موجود، لا يزال يعمل
- `updateConversationState()` - موجود، لا يزال يعمل
- `appendMessage()` - موجود، تم إضافة overload جديد (object-based)
- Route handlers - لا تتأثر، تعمل كما هي

---

## الأمان

- جميع الاستعلامات parameterized (لا SQL injection)
- Merchant isolation: جميع الدوال تتطلب `merchantId`
- Defaults آمنة: جميع الأعمدة JSONB لها defaults `'{}'::jsonb`

