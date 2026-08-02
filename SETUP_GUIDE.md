# دليل الإعداد الكامل للتطبيق

## 📋 الخطوات المطلوبة

### 1. إعداد قاعدة البيانات PostgreSQL

```bash
# تثبيت PostgreSQL (إذا لم يكن مثبتاً)
# Windows: https://www.postgresql.org/download/windows/
# Mac: brew install postgresql
# Linux: sudo apt-get install postgresql
```

#### Windows (PowerShell/CMD):

**الطريقة 1: استخدام pgAdmin (الأسهل - موصى به)**

راجع ملف `PGADMIN_SETUP.md` للتعليمات التفصيلية مع الصور.

**الطريقة 2: استخدام السكريبت الجاهز**

```powershell
# من المجلد الرئيسي للمشروع
.\setup-database.ps1
```

**الطريقة 3: استخدام psql مباشرة**

```powershell
# استخدام المسار الكامل (استبدل 18 برقم إصدارك)
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE almusaid_db;"

# تشغيل Schema
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d almusaid_db -f backend\src\database\schema.sql
```

#### Mac/Linux:

```bash
# إنشاء قاعدة البيانات
createdb almusaid_db

# أو باستخدام psql
psql -U postgres
CREATE DATABASE almusaid_db;
\q

# تشغيل Schema
psql -d almusaid_db -f backend/src/database/schema.sql
```

#### ملاحظة مهمة لـ Windows:
إذا كان `psql` غير معروف، قم بإضافة مجلد PostgreSQL إلى PATH:
1. افتح "Environment Variables" من Windows Settings
2. أضف `C:\Program Files\PostgreSQL\15\bin` (أو رقم الإصدار الخاص بك) إلى PATH
3. أعد تشغيل PowerShell/CMD

### 2. إعداد Backend

```bash
# الانتقال إلى مجلد Backend
cd backend

# تثبيت Dependencies
npm install

# نسخ ملف Environment
cp .env.example .env

# تعديل ملف .env وإضافة:
# - DATABASE_URL أو DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
# - JWT_SECRET (مفتاح عشوائي قوي)
# - GEMINI_API_KEY
# - CORS_ORIGIN=http://localhost:3000
```

**مثال ملف `.env`:**
```env
PORT=3001
NODE_ENV=development

DB_HOST=localhost
DB_PORT=5432
DB_NAME=almusaid_db
DB_USER=postgres
DB_PASSWORD=your_password

JWT_SECRET=your-super-secret-jwt-key-min-32-characters-long
JWT_EXPIRES_IN=7d

GEMINI_API_KEY=your-gemini-api-key-here

CORS_ORIGIN=http://localhost:3000
```

### 3. تشغيل Backend

```bash
# في مجلد backend
npm run dev
```

الخادم سيعمل على `http://localhost:3001`

### 4. إعداد Frontend

```bash
# في المجلد الرئيسي
# إنشاء ملف .env (إذا لم يكن موجوداً)
echo "VITE_API_URL=http://localhost:3001/api" > .env

# تثبيت Dependencies (إذا لم تكن مثبتة)
npm install
```

### 5. تشغيل Frontend

```bash
# في المجلد الرئيسي
npm run dev
```

التطبيق سيعمل على `http://localhost:3000`

## 🔄 ربط Frontend مع Backend

### الخطوة 1: تحديث App.tsx

سيتم تحديث `App.tsx` لاستخدام `apiService` بدلاً من `mockBackend`.

### الخطوة 2: تحديث Login/Signup

سيتم تحديث صفحات Login و Signup لاستخدام `AuthContext`.

### الخطوة 3: تحديث المكونات

جميع المكونات التي تستخدم `mockBackend` سيتم تحديثها لاستخدام `apiService`.

## ✅ التحقق من أن كل شيء يعمل

### 1. اختبار Backend

```bash
# Health Check
curl http://localhost:3001/health

# يجب أن يعيد:
# {"status":"ok","timestamp":"...","environment":"development"}
```

### 2. اختبار Frontend

1. افتح `http://localhost:3000`
2. سجل حساب جديد
3. سجل دخول
4. جرب إضافة منتج
5. جرب إضافة طلب

## 🐛 حل المشاكل الشائعة

### مشكلة: "Cannot connect to database"
- تأكد أن PostgreSQL يعمل
- تحقق من بيانات الاتصال في `.env`
- تأكد أن قاعدة البيانات موجودة

### مشكلة: "CORS error"
- تأكد أن `CORS_ORIGIN` في `.env` يشير إلى `http://localhost:3000`
- تأكد أن Backend يعمل على `http://localhost:3001`

### مشكلة: "JWT secret not configured"
- تأكد أن `JWT_SECRET` موجود في `.env`
- يجب أن يكون على الأقل 32 حرف

### مشكلة: "API request failed"
- تأكد أن Backend يعمل
- تحقق من Console للأخطاء
- تأكد من `VITE_API_URL` في `.env` للـ Frontend

## 📝 ملاحظات مهمة

1. **في Development**: 
   - Backend على `http://localhost:3001`
   - Frontend على `http://localhost:3000`

2. **في Production**:
   - يجب تغيير `VITE_API_URL` إلى URL الـ Backend الحقيقي
   - يجب إعداد HTTPS
   - يجب إعداد Environment variables بشكل آمن

3. **Security**:
   - لا ترفع ملف `.env` إلى Git
   - استخدم `JWT_SECRET` قوي
   - استخدم HTTPS في Production

## 🚀 الخطوات التالية

بعد إكمال الإعداد:
1. ✅ ربط Frontend مع Backend (قيد التنفيذ)
2. ⏳ إضافة Error Handling أفضل
3. ⏳ إضافة Loading States
4. ⏳ إضافة Retry Logic
5. ⏳ إضافة Offline Support

