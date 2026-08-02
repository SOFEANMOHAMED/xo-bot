# دليل النشر (Deployment Guide)

## 📋 المتطلبات الأساسية

### 1. الخوادم والخدمات
- **Backend Server**: Node.js 18+ 
- **Database**: PostgreSQL 12+
- **Frontend Hosting**: Vercel/Netlify (موصى به)
- **Domain**: نطاق خاص بك (اختياري)

### 2. الحسابات والخدمات الخارجية
- OpenAI API Key
- Facebook Developer Account (للتكامل مع Facebook)
- Shopify Partner Account (للتكامل مع Shopify)
- WhatsApp Business API (للتكامل مع WhatsApp)

---

## 🚀 خطوات النشر

### المرحلة 1: إعداد قاعدة البيانات

#### خيار 1: استخدام Supabase (موصى به للمبتدئين)
1. أنشئ حساب على [Supabase](https://supabase.com)
2. أنشئ مشروع جديد
3. انسخ `connection string` من Settings > Database
4. استخدمه في `DATABASE_URL` في `.env`

#### خيار 2: استخدام AWS RDS
1. أنشئ PostgreSQL instance على AWS RDS
2. احصل على connection details
3. أضفها إلى `.env`

#### خيار 3: استخدام خادم خاص
1. ثبت PostgreSQL على الخادم
2. أنشئ قاعدة البيانات:
```sql
CREATE DATABASE xobot_db;
```
3. شغّل schema:
```bash
psql -d xobot_db -f backend/src/database/schema.sql
```

---

### المرحلة 2: نشر Backend

#### خيار 1: Railway (موصى به)
1. سجل دخول إلى [Railway](https://railway.app)
2. أنشئ مشروع جديد
3. أضف PostgreSQL service
4. أضف Node.js service واربطه بـ GitHub repo
5. أضف Environment Variables من `.env`
6. Railway سيقوم بالبناء والنشر تلقائياً

#### خيار 2: Render
1. سجل دخول إلى [Render](https://render.com)
2. أنشئ Web Service جديد
3. اربطه بـ GitHub repo
4. أضف PostgreSQL database
5. أضف Environment Variables
6. Render سيقوم بالبناء والنشر

#### خيار 3: AWS EC2 / DigitalOcean
1. أنشئ Ubuntu server
2. ثبت Node.js و PostgreSQL
3. استنسخ المشروع:
```bash
git clone <your-repo>
cd xobot
cd backend
npm install
npm run build
```
4. أضف `.env` file
5. شغّل باستخدام PM2:
```bash
npm install -g pm2
pm2 start dist/index.js --name xobot-backend
pm2 save
pm2 startup
```

---

### المرحلة 3: نشر Frontend

#### خيار 1: Vercel (موصى به)
1. سجل دخول إلى [Vercel](https://vercel.com)
2. أضف مشروع جديد من GitHub
3. أضف Environment Variable:
   - `VITE_API_URL`: URL الـ Backend (مثال: `https://yourdomain.com/api`)
4. Vercel سيقوم بالبناء والنشر تلقائياً

#### خيار 2: Netlify
1. سجل دخول إلى [Netlify](https://netlify.com)
2. أضف مشروع جديد من GitHub
3. Build command: `npm run build`
4. Publish directory: `dist`
5. أضف Environment Variable: `VITE_API_URL`

---

### المرحلة 4: إعداد Domain (اختياري)

1. أضف DNS records:
   - `A` record للـ Domain: `yourdomain.com` → Backend IP
   - `CNAME` record للـ Frontend: `www.yourdomain.com` → Vercel/Netlify URL

2. أضف SSL Certificate:
   - Vercel/Netlify تضيف SSL تلقائياً
   - للـ Backend: استخدم Let's Encrypt أو Cloudflare

---

## 🔐 Environment Variables للإنتاج

### Backend (.env)
```env
NODE_ENV=production
PORT=3001

# Database
DB_HOST=your-db-host
DB_PORT=5432
DB_NAME=xobot_db
DB_USER=your-db-user
DB_PASSWORD=your-secure-password

# Security
JWT_SECRET=your-very-strong-secret-min-32-chars
JWT_EXPIRES_IN=7d

# CORS
CORS_ORIGIN=https://yourdomain.com

# AI
OPENAI_API_KEY=your-openai-key

# Backend URL
BACKEND_URL=https://yourdomain.com

# Integrations (Optional)
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
```

### Frontend (.env)
```env
VITE_API_URL=https://yourdomain.com/api
```

---

## ✅ قائمة التحقق قبل النشر

### Backend
- [ ] قاعدة البيانات جاهزة ومتصلة
- [ ] جميع Environment Variables موجودة
- [ ] Schema تم تشغيله
- [ ] Super Admin تم إنشاؤه
- [ ] SSL Certificate مثبت
   - [ ] Health check يعمل: `https://yourdomain.com/health`

### Frontend
- [ ] `VITE_API_URL` يشير إلى Backend الصحيح
- [ ] Build يعمل بدون أخطاء
- [ ] جميع الصور والموارد تعمل

### التكاملات
- [ ] Facebook OAuth URLs محدثة
- [ ] Shopify OAuth URLs محدثة
- [ ] Webhook URLs محدثة في Facebook/Shopify

---

## 🔍 اختبار ما بعد النشر

1. **اختبار Health Check**:
```bash
curl https://yourdomain.com/health
```

2. **اختبار Authentication**:
   - سجل حساب جديد
   - سجل دخول
   - تحقق من JWT token

3. **اختبار API Endpoints**:
   - GET `/api/products`
   - POST `/api/products`
   - GET `/api/auth/profile`

4. **اختبار Frontend**:
   - افتح الموقع
   - سجل دخول
   - جرب إضافة منتج
   - جرب إضافة طلب

---

## 🛠️ الصيانة

### Backup قاعدة البيانات
```bash
# يومياً
pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME > backup_$(date +%Y%m%d).sql
```

### Monitoring
- راقب Logs في Railway/Render dashboard
- استخدم Sentry للـ Error Tracking (اختياري)
- راقب Database connections

### Updates
1. استنسخ التحديثات من Git
2. شغّل `npm install` في Backend
3. شغّل `npm run build`
4. أعد تشغيل الخادم

---

## 🐛 حل المشاكل الشائعة

### مشكلة: "Cannot connect to database"
- تحقق من Environment Variables
- تحقق من Firewall rules
- تحقق من Database credentials

### مشكلة: "CORS error"
- تأكد أن `CORS_ORIGIN` يشير إلى Frontend URL الصحيح
- تأكد من وجود `https://` في Production

### مشكلة: "JWT secret not configured"
- تأكد من وجود `JWT_SECRET` في Environment Variables
- يجب أن يكون 32 حرف على الأقل

---

## 📞 الدعم

إذا واجهت مشاكل، راجع:
- `SETUP_GUIDE.md` - دليل الإعداد المحلي
- `backend/README.md` - توثيق Backend
- Logs في Railway/Render dashboard
