# إصلاحات SaaS - Telegram Bot Multi-Tenant Support

## التغييرات المطبقة

### 1. إضافة `telegram_webhook_secret` إلى `merchant_settings`
- كل merchant لديه الآن webhook secret فريد
- يسمح بتحديد الـ merchant بشكل آمن من webhook requests

### 2. تحديث `connectTelegram`
- ينشئ webhook secret فريد لكل merchant
- يحفظ الـ secret في قاعدة البيانات مع bot token

### 3. تحديث `telegramWebhook`
- يحدد الـ merchant من webhook secret بدلاً من اختبار جميع الـ tokens
- أكثر أماناً وأسرع

### 4. تبسيط `processTelegramMessage`
- يستخدم `merchantId` مباشرة (يتم تمريره من webhook handler)
- لا يحتاج لاختبار جميع الـ merchants

## كيفية تطبيق Migration

### الطريقة 1: استخدام pgAdmin
1. افتح pgAdmin
2. انقر بزر الماوس الأيمن على قاعدة البيانات → **Query Tool**
3. افتح ملف: `backend/src/database/migrations/add_telegram_webhook_secret.sql`
4. اضغط **Execute** (F5)

### الطريقة 2: استخدام psql
```bash
psql -U your_username -d your_database -f backend/src/database/migrations/add_telegram_webhook_secret.sql
```

### الطريقة 3: استخدام schema.sql المحدث
إذا كنت تقوم بإعداد قاعدة بيانات جديدة، فإن `schema.sql` يحتوي الآن على العمود الجديد تلقائياً.

## ملاحظات مهمة

1. **للمستخدمين الحاليين**: يجب إعادة ربط Telegram bot بعد تطبيق migration
   - الـ webhook secret القديم لن يعمل
   - يجب إعادة الاتصال من لوحة التحكم

2. **الأمان**: كل merchant لديه الآن webhook secret فريد
   - لا يمكن لـ merchant واحد الوصول لبيانات merchant آخر
   - الـ webhook secret محمي في قاعدة البيانات

3. **الأداء**: تحديد الـ merchant أصبح أسرع
   - لا حاجة لاختبار جميع الـ bot tokens
   - استعلام واحد فقط باستخدام webhook secret

## التحقق من التطبيق

بعد تطبيق migration، تحقق من:
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'merchant_settings' 
AND column_name = 'telegram_webhook_secret';
```

يجب أن ترى:
- `column_name`: `telegram_webhook_secret`
- `data_type`: `character varying`

