# Migration: Hybrid Orchestrator Support

## الوصف
هذا الـ migration يضيف دعم كامل لـ hybrid orchestrator متعدد القنوات (Facebook, Telegram, WhatsApp, Web).

## الأعمدة المضافة/المحدثة

### جدول `conversations`:
- `conversation_state JSONB NOT NULL DEFAULT '{}'::jsonb` - حالة المحادثة (موجود، تم تحديثه)
- `current_intent VARCHAR(100)` - نية المحادثة الحالية (موجود)
- `session_metadata JSONB NOT NULL DEFAULT '{}'::jsonb` - معلومات الجلسة (موجود، تم تحديثه)
- `stage VARCHAR(50) NOT NULL DEFAULT 'discover'` - مرحلة المحادثة (موجود، تم تحديثه)
- `last_error TEXT` - آخر خطأ حدث (جديد)

### جدول `messages`:
- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb` - معلومات إضافية (موجود، تم تحديثه)
- `intent VARCHAR(100)` - النية المكتشفة (موجود)
- `entities JSONB NOT NULL DEFAULT '{}'::jsonb` - الكيانات المستخرجة (موجود، تم تحديثه)

## الفهارس المضافة

- `idx_conversations_merchant_platform_user` - فهرس مركب على (merchant_id, platform, user_id) للبحث السريع
- `idx_conversations_state_gin` - GIN index على conversation_state (موجود)
- `idx_conversations_stage` - فهرس على stage (موجود)
- `idx_conversations_current_intent` - فهرس على current_intent (موجود)
- `idx_messages_entities_gin` - GIN index على entities (موجود)
- `idx_messages_intent` - فهرس على intent (موجود)

## كيفية التشغيل

```bash
cd backend
npm run migrate-hybrid-orchestrator
```

أو مباشرة:
```bash
tsx src/database/migrations/run_hybrid_orchestrator_migration.ts
```

## التحقق من النجاح

```sql
-- التحقق من أعمدة conversations
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'conversations' 
  AND column_name IN ('conversation_state', 'current_intent', 'session_metadata', 'stage', 'last_error')
ORDER BY column_name;

-- التحقق من أعمدة messages
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'messages' 
  AND column_name IN ('metadata', 'intent', 'entities')
ORDER BY column_name;

-- التحقق من الفهرس المركب
SELECT indexname, indexdef
FROM pg_indexes 
WHERE tablename = 'conversations'
  AND indexname = 'idx_conversations_merchant_platform_user';
```

## ملاحظات

- الـ migration آمن للتشغيل على قاعدة بيانات موجودة
- جميع الأعمدة لها قيم افتراضية
- الأعمدة JSONB تم تعيينها كـ NOT NULL مع قيم افتراضية
- الـ migration idempotent (يمكن تشغيله عدة مرات بأمان)

