# Migration: Conversation State for Smart Sales Bot

## الوصف
هذا الـ migration يضيف دعم لتتبع حالة المحادثة في بوت المبيعات الذكي.

## الأعمدة المضافة

### جدول `conversations`:
- `conversation_state JSONB` - تخزين النوايا، الكيانات، lead_score، المنتجات الموصى بها، إلخ
- `current_intent VARCHAR(100)` - نية المحادثة الحالية
- `session_metadata JSONB` - معلومات الجلسة الخاصة بالمنصة
- `stage VARCHAR(50)` - مرحلة المحادثة (discover/offer/objection/close/handoff/clarify)

### جدول `messages`:
- `metadata JSONB` - معلومات إضافية للرسالة (مرفقات، quick replies، إلخ)
- `intent VARCHAR(100)` - النية المكتشفة من الرسالة
- `entities JSONB` - الكيانات المستخرجة (معرفات المنتجات، الكميات، إلخ)

## الفهارس المضافة
- `idx_conversations_state_gin` - GIN index على `conversation_state` للبحث السريع في JSON
- `idx_conversations_current_intent` - فهرس على `current_intent`
- `idx_conversations_stage` - فهرس على `stage`
- `idx_messages_entities_gin` - GIN index على `entities` للبحث السريع في JSON
- `idx_messages_intent` - فهرس على `intent`

## كيفية التشغيل

### الطريقة 1: استخدام npm script
```bash
cd backend
npm run migrate-conversation-state
```

### الطريقة 2: تشغيل مباشر
```bash
cd backend
tsx src/database/migrations/run_conversation_state_migration.ts
```

### الطريقة 3: تشغيل SQL مباشرة
```bash
psql -U your_user -d your_database -f src/database/migrations/add_conversation_state.sql
```

## التحقق من النجاح

بعد تشغيل الـ migration، يمكنك التحقق من نجاحه باستخدام:

```bash
psql -U your_user -d your_database -f src/database/migrations/verify_conversation_state.sql
```

أو يمكنك تشغيل الاستعلامات التالية مباشرة:

```sql
-- التحقق من أعمدة conversations
SELECT column_name, data_type, column_default
FROM information_schema.columns 
WHERE table_name = 'conversations' 
    AND column_name IN ('conversation_state', 'current_intent', 'session_metadata', 'stage');

-- التحقق من أعمدة messages
SELECT column_name, data_type, column_default
FROM information_schema.columns 
WHERE table_name = 'messages' 
    AND column_name IN ('metadata', 'intent', 'entities');

-- التحقق من الفهارس
SELECT indexname, indexdef
FROM pg_indexes 
WHERE tablename IN ('conversations', 'messages')
    AND indexname LIKE '%conversation%' OR indexname LIKE '%message%';
```

## ملاحظات
- الـ migration آمن للتشغيل على قاعدة بيانات موجودة (يستخدم `IF NOT EXISTS`)
- جميع الأعمدة لها قيم افتراضية لضمان عدم كسر البيانات الموجودة
- الـ migration idempotent (يمكن تشغيله عدة مرات بأمان)

