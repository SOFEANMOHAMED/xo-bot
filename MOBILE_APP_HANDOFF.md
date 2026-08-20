# Xo Bot — مواصفات تطبيق الموبايل (مستند مكتفٍ بذاته)

> **هذا الملف وحده كافٍ** لبناء تطبيق موبايل للتاجر. لا تحتاج قراءة أي ملف من مستودع المشروع.  
> ابنِ تطبيق Native أو Cross-platform (Flutter / React Native / Kotlin+Swift) يتصل بالـ API أدناه.

| | |
|---|---|
| **المنتج** | Xo Bot — بوت مبيعات عربي بالذكاء الاصطناعي للمتاجر |
| **API Base** | `https://xo-bot.com/api` |
| **الموقع** | `https://xo-bot.com` |
| **الدعم** | `support@xo-bot.com` |
| **اللغة** | عربية RTL أولاً |
| **النطاق** | تطبيق التاجر فقط (ليس لوحة Super Admin) |

---

## 0) تعليمات للذكاء الاصطناعي البنّاء

1. ابنِ عميل HTTP واحد يرسل `Authorization: Bearer <jwt>` على كل طلب محمي.
2. كل استجابة JSON مغلفة بـ `{ success, data, error? }` — اقرأ `data` عند النجاح.
3. لا ترسل `merchantId` أبداً من العميل؛ العزل من التوكن فقط.
4. نفّذ SSE للوارد وQR واتساب (ليس WebSocket).
5. تعامل مع `403` + `error.code === "TRIAL_EXPIRED"` بشاشة ترقية.
6. احترم `planCapabilities` لإخفاء/تعطيل الميزات.
7. الواجهة عربية RTL، لون أساسي `#FF9A00`، خط Cairo.
8. احفظ JWT في Keychain/Keystore فقط.
9. نفّذ المراحل بالترتيب: Auth → Dashboard → Inbox+SSE → Products/Orders → Settings/Billing → Integrations → الباقي.
10. عند الشك في حقل اختياري: اجعله optional ولا تكسر التطبيق.

---

## 1) المنتج باختصار

منصة SaaS عربية تساعد التاجر على أتمتة المبيعات والرد عبر:
WhatsApp، Facebook Messenger، Instagram DM، Telegram، مع صندوق وارد موحّد، كتالوج منتجات، طلبات، CRM، أتمتة تعليقات، نشر محتوى، استوديو صور AI، فوترة يدوية (ShamCash/USDT)، برنامج إحالة، دعم فني.

تجربة مجانية 7 أيام. خطط تقريبية (اعرض دائماً من API إن وُجدت):
- Comments ≈ $5/شهر
- Single channel ≈ $21/شهر
- Social ≈ $35/شهر
- Yearly ≈ $200/سنة

---

## 2) الهوية البصرية (انسخها كما هي)

```text
الاسم: Xo Bot
اسم العرض: Xo Bot للمتاجر
اللون الأساسي: #FF9A00
brand-50:  #FFF8EB
brand-100: #FFEFCC
brand-200: #FFDB99
brand-300: #FFC266
brand-400: #FFAD33
brand-500: #FF9A00
brand-600: #E68A00
brand-700: #CC7A00
brand-800: #995C00
brand-900: #663D00
خلفية التطبيق: #FFFBF7
خلفية ناعمة: #FFF8EB
نص داكن: #1f2937 / #111827
الخط: Cairo (Google Fonts) — RTL
theme_color: #FF9A00
```

شعارات عامة على الموقع (حمّلها عند البناء):
- `https://xo-bot.com/xo-bot-logo.png`
- `https://xo-bot.com/xo-bot-mark.png`
- `https://xo-bot.com/icons/icon-192.png`
- `https://xo-bot.com/icons/icon-512.png`
- `https://xo-bot.com/icons/icon-maskable-512.png`

لا تستخدم ثيمات بنفسجية/كريمية عامة؛ التزم بالبرتقالي أعلاه.

---

## 3) بروتوكول الـ HTTP

### 3.1 Base URL
```
https://xo-bot.com/api
```

### 3.2 Headers
```http
Authorization: Bearer <JWT>
Content-Type: application/json
Accept: application/json
```
للرفع (multipart): لا تضع `Content-Type` يدوياً؛ اترك الحدود تُحسب تلقائياً، وأبقِ فقط `Authorization`.

### 3.3 غلاف الاستجابة
نجاح:
```json
{ "success": true, "data": { } }
```
فشل:
```json
{ "success": false, "error": { "message": "نص عربي أو إنجليزي", "code": "OPTIONAL" } }
```
عميل الـ API يجب أن يعيد `data` فقط عند `success === true`.

### 3.4 أكواد مهمة
| Status | المعنى |
|--------|--------|
| 401 | توكن غير صالح/منتهي → سجّل خروجاً وأعد للدخول |
| 403 + `TRIAL_EXPIRED` | انتهت التجربة → شاشة ترقية (اسمح بالفوترة/البروفايل) |
| 413 | ملف كبير جداً |
| 429 | حد معدل الطلبات — انتظر وأعد المحاولة |
| 502/503/504 | السيرفر غير متاح |

### 3.5 JWT
الحمولة المنطقية (لا تتحقق محلياً إلا للعرض):
```json
{ "userId": "uuid", "merchantId": "uuid", "role": "user" | "admin" | "owner" }
```
للتاجر العادي: `userId === merchantId` و `role === "user"`.  
لا يوجد refresh token. مدة شائعة: 7 أيام.

---

## 4) النماذج (TypeScript — انسخها حرفياً)

```ts
export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled';
export type ChatPlatform =
  | 'web'
  | 'facebook_messenger'
  | 'facebook_comment'
  | 'instagram'
  | 'telegram'
  | 'whatsapp';
export type BotPersona = 'formal' | 'friendly' | 'sales' | 'fast' | 'luxury';
export type UserRole = 'owner' | 'admin' | 'user';
export type CustomerType = 'regular' | 'vip' | 'wholesale' | 'new';
export type CustomerStatus = 'active' | 'inactive' | 'blocked';
export type InteractionType =
  | 'message' | 'call' | 'email' | 'order' | 'complaint' | 'review' | 'note';
export type ReferralStatus = 'pending' | 'active' | 'expired';

export interface PlanCapabilities {
  hasSalesBot: boolean;
  hasAdvancedAnalytics: boolean;
  maxTelegramBots: number;
  maxTotalChannels: number; // -1 = unlimited
  maxFacebookPages: number;
  maxInstagramAccounts: number;
  maxWhatsAppAccounts: number;
  maxShopifyStores: number;
  maxStorifyStores: number;
  maxMonthlyMarketingImages: number; // -1 = unlimited
  billingPeriod: 'monthly' | 'yearly';
}

export const DEFAULT_PLAN_CAPABILITIES: PlanCapabilities = {
  hasSalesBot: true,
  hasAdvancedAnalytics: true,
  maxTelegramBots: 1,
  maxTotalChannels: -1,
  maxFacebookPages: 1,
  maxInstagramAccounts: 1,
  maxWhatsAppAccounts: 0,
  maxShopifyStores: 0,
  maxStorifyStores: 1,
  maxMonthlyMarketingImages: -1,
  billingPeriod: 'monthly',
};

export interface StorePolicies {
  shippingPolicy: string;
  deliveryTime: string;
  paymentMethods: string;
  returnPolicy: string;
  additionalNotes: string;
  enableAIInjection: boolean;
}

export interface SalesScripts {
  welcomeScript?: string;
  objectionHandlingScript?: string;
  closingScript?: string;
  crossSellScript?: string;
}

export interface MerchantSettings {
  storeName: string;
  telegramBotToken: string;
  welcomeMessage: string;
  systemPrompt: string;
  autoReplyComments: boolean;
  autoReplyMessenger: boolean;
  storeCurrency: string;
  botPersona: BotPersona;
  storePolicies: StorePolicies;
  signupDate: string; // ISO
  enableCrossSelling?: boolean;
  enableUpselling?: boolean;
  enableUrgencyMessages?: boolean;
  enableSocialProof?: boolean;
  defaultDiscountPercentage?: number;
  salesScripts?: SalesScripts;
  abandonedReminderEnabled?: boolean;
  abandonedReminderDelayMinutes?: number;
  abandonedReminderMessage?: string; // {name} {product} {product_clause}
  planCapabilities?: PlanCapabilities;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  category: string | null;
  stock: number;
  description: string | null;
  sizes: string[];
  colors: string[];
  imageUrl: string | null;
  images: string[]; // max 10, first = primary
  imageColors?: (string | null)[];
  source: 'manual' | 'shopify' | 'storify' | 'excel' | string;
  externalId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrderItem {
  id?: string;
  productId: string | null;
  productName: string;
  quantity: number;
  price: number;
  currency?: string;
}

export interface Order {
  id: string;
  externalId?: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  total: number;
  currency: string;
  status: OrderStatus;
  source: string;
  notes?: string | null;
  items: OrderItem[];
  date: string;
  viewedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConversationSummary {
  id: string;
  platform: string;
  userId?: string | null;
  userName?: string | null;
  lastMessageAt: string;
  createdAt: string;
  botDisabled: boolean;
  status: string;
  lastHumanResponseAt?: string | null;
  lastMessagePreview?: string | null;
  lastSenderType?: string | null;
  messageCount: number;
}

export interface InboxMessage {
  id: string;
  role: string;
  content: string;
  senderType?: string;
  source?: string | null;
  imageUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  readAt?: string | null;
  deliveredAt?: string | null;
  timestamp: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  customerType: CustomerType;
  status: CustomerStatus;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate?: string;
  lastInteractionDate?: string;
  notes?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  phone?: string | null;
  subscriptionPlan: string;
  subscriptionStatus?: string;
  trialEndsAt?: string | null;
  createdAt?: string;
  role?: UserRole;
}

export interface MarketingImageRecord {
  id: string;
  prompt: string;
  revisedPrompt?: string | null;
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  imageSize: '1K' | '2K' | '4K';
  mimeType: string;
  fileSize?: number | null;
  createdAt: string;
}

export type ContentPlatform = 'facebook' | 'instagram';
export type PublicationStatus =
  | 'draft' | 'scheduled' | 'publishing' | 'published'
  | 'partial' | 'failed' | 'cancelled';
export type MediaKind = 'none' | 'image' | 'video' | 'carousel';

export interface ContentPublishAccount {
  platform: ContentPlatform;
  accountRef: string;
  accountLabel: string | null;
  pageId?: string | null;
}

export interface ContentPublicationMedia {
  id?: string;
  sortOrder: number;
  mediaType: 'image' | 'video';
  mediaUrl: string;
  thumbnailUrl?: string | null;
  altText?: string | null;
}

export interface ContentPublicationTarget {
  id?: string;
  platform: ContentPlatform;
  accountRef: string;
  accountLabel: string | null;
  status: 'pending' | 'publishing' | 'published' | 'failed' | 'skipped';
  externalPostId?: string | null;
  permalink?: string | null;
  errorMessage?: string | null;
  publishedAt?: string | null;
}

export interface ContentPublication {
  id: string;
  caption: string | null;
  mediaKind: MediaKind;
  status: PublicationStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  errorSummary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  media: ContentPublicationMedia[];
  targets: ContentPublicationTarget[];
}

export interface CreateContentPublicationPayload {
  caption?: string | null;
  media?: Array<{
    mediaUrl: string;
    mediaType: 'image' | 'video';
    thumbnailUrl?: string | null;
    altText?: string | null;
    sortOrder?: number;
  }>;
  targets: Array<{
    platform: ContentPlatform;
    accountRef: string;
    accountLabel?: string | null;
  }>;
  scheduledAt?: string | null;
  publishNow?: boolean;
}

export interface AffiliateStats {
  referralCode: string;
  referralLink: string;
  totalVisits: number;
  totalSignups: number;
  activeConversions: number;
  totalEarnings: number;
  availableBalance: number;
  referrals: Array<{
    id: string;
    referrerId: string;
    newUserId: string;
    newUserEmail: string;
    date: string;
    status: ReferralStatus;
    commissionAmount: number;
    plan: string;
  }>;
}

export type InboxStreamEvent = {
  type: 'message' | 'conversation' | 'heartbeat' | 'connected' | 'typing' | 'read';
  merchantId: string;
  conversationId?: string;
  platform?: string | null;
  message?: {
    id: string;
    role: string;
    content: string;
    senderType: string;
    source?: string | null;
    createdAt: string;
    imageUrl?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  conversation?: {
    id: string;
    platform?: string | null;
    userId?: string | null;
    userName?: string | null;
    botDisabled?: boolean;
    status?: string | null;
    lastMessageAt?: string | null;
    lastMessagePreview?: string | null;
    lastSenderType?: string | null;
  };
  typing?: {
    conversationId: string;
    isTyping: boolean;
    from: 'merchant' | 'customer';
  };
  read?: {
    conversationId: string;
    reader: 'merchant' | 'customer';
    readAt: string;
    watermark?: number | null;
  };
  at?: string;
};

export type WhatsAppPairingEvent =
  | { type: 'qr'; qrDataUrl: string }
  | {
      type: 'status';
      status: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out';
      phoneNumber?: string | null;
      message?: string;
    }
  | { type: 'error'; message: string }
  | { type: 'connected' }
  | { type: 'heartbeat' };
```

---

## 5) شاشات التطبيق المطلوبة

| الشاشة | أولوية | الوظيفة |
|--------|--------|---------|
| Splash / Boot | P0 | قراءة التوكن → `/auth/profile` |
| Login | P0 | بريد + كلمة مرور |
| Signup | P0 | اسم، بريد، هاتف، كلمة مرور، كود إحالة اختياري |
| Forgot / Reset Password | P0 | |
| Complete Profile | P1 | بعد Google OAuth إن وُجد |
| Dashboard | P0 | إحصائيات + حالة التجربة/الخطة |
| Inbox (قائمة + محادثة) | P0 | SSE + رد بشري + إيقاف/تشغيل البوت |
| Products | P0 | CRUD + رفع صور |
| Orders | P0 | قائمة، تفاصيل، تغيير حالة، تعليم كمقروء |
| Settings | P0 | اسم المتجر، شخصية البوت، سياسات، تذكير السلة |
| Profile | P0 | تحديث بيانات، تغيير كلمة المرور، حذف حساب |
| Subscription / Billing | P0 | خطط + طرق دفع + رفع إثبات |
| Integrations | P0 | واتساب QR أولاً ثم بقية القنوات |
| Notifications | P1 | قائمة داخلية |
| CRM | P1 | عملاء + تفاعلات |
| Social Automation | P1 | منشورات + قواعد كلمات + أوضاع تعليق |
| Content Publishing | P1 | مسودات/جدولة/نشر |
| Image Studio | P1 | توليد صور تسويقية |
| Chat Test | P1 | اختبار البوت محلياً |
| Analytics | P1 | إن `hasAdvancedAnalytics` |
| Affiliate | P2 | إحصائيات + سحب |
| Support | P2 | تذاكر + ردود |
| Services | لاحقاً | قد تكون coming soon |

تنقل مقترح (شريط سفلي موبايل): الوارد | الطلبات | المنتجات | المزيد (لوحة، تكاملات، إعدادات…).

---

## 6) عقد الـ API الكامل (للتاجر)

كل المسارات نسبية إلى `https://xo-bot.com/api`.  
ما لم يُذكر خلاف ذلك: **JWT مطلوب** + غالباً اشتراك فعّال.

### 6.1 Auth

#### `POST /auth/register` (عام)
Body:
```json
{
  "email": "string",
  "password": "string",
  "name": "string?",
  "phone": "string?",
  "referralCode": "string?"
}
```
Data:
```json
{
  "user": {
    "id": "uuid",
    "email": "string",
    "name": "string|null",
    "subscriptionPlan": "string",
    "subscriptionStatus": "string?",
    "trialEndsAt": "ISO|null?",
    "createdAt": "ISO?"
  },
  "token": "jwt"
}
```

#### `POST /auth/login` (عام)
Body: `{ "email", "password" }`  
Data: نفس شكل register (`user` + `token`).

#### `POST /auth/logout`
Body فارغ. امسح التوكن محلياً حتى لو فشل الطلب.

#### `GET /auth/profile`
Data:
```json
{
  "user": {
    "id": "uuid",
    "email": "string",
    "name": "string|null",
    "subscriptionPlan": "string",
    "subscriptionStatus": "string",
    "trialEndsAt": "ISO|null",
    "createdAt": "ISO",
    "role": "owner|admin|user?"
  }
}
```

#### `PUT /auth/profile`
Body: `{ "name?", "email?", "phone?" }`  
Data: `{ "user": { "id", "email", "name", "phone" } }`

#### `POST /auth/forgot-password` (عام)
Body: `{ "email" }` → `{ "message" }`

#### `POST /auth/reset-password` (عام)
Body: `{ "token", "password" }` → `{ "message" }`

#### `POST /auth/change-password`
Body: `{ "currentPassword", "newPassword" }` → `{ "message" }`

#### `POST /auth/complete-profile`
Body: `{ "password", "phone", "referralCode?" }`

#### `DELETE /auth/account`
يحذف حساب التاجر وبياناته.

#### `GET /auth/google` (عام)
يفتح OAuth في متصفح/Custom Tab. بعد النجاح يُعاد توجيه للمتصفح مع token — على الموبايل اربط Deep Link مع الفريق لاحقاً إن لزم. يمكن تأجيل Google للمرحلة اللاحقة والاعتماد على البريد/كلمة المرور.

---

### 6.2 Products `/products`

#### `GET /products`
Data: `{ "products": Product[] }`

#### `POST /products`
Body:
```json
{
  "name": "string",
  "description": "string?",
  "price": 0,
  "currency": "USD?",
  "category": "string?",
  "stock": 0,
  "sizes": ["S"],
  "colors": ["أحمر"],
  "imageUrl": "url?",
  "images": ["url"],
  "imageColors": ["أحمر", null],
  "source": "manual?",
  "externalId": "string?"
}
```
Data: `{ "product": Product }`

#### `PUT /products/:id`
Body: أي حقول جزئية من أعلاه.  
Data: `{ "product": Product }`

#### `DELETE /products/:id` → `{ "message" }`

#### `GET /products/:productId/image` (عام)
يعيد بايتات الصورة (للاستخدام في `<Image>`).

> ملاحظة: `GET /products/:id` قد لا يكون مفعّلاً على السيرفر؛ اعتمد على القائمة أو احفظ العنصر محلياً بعد الإنشاء/التحديث.

---

### 6.3 Orders `/orders`

#### `GET /orders?status=pending|paid|fulfilled|cancelled`
Data: `{ "orders": Order[] }`

#### `GET /orders/:id` → `{ "order": Order }`

#### `POST /orders`
Body:
```json
{
  "customerName": "string",
  "customerEmail": "string?",
  "customerPhone": "string?",
  "customerAddress": "string?",
  "total": 0,
  "currency": "USD?",
  "status": "pending?",
  "source": "manual|shopify|storify?",
  "notes": "string?",
  "items": [
    {
      "productId": "uuid?",
      "productName": "string",
      "quantity": 1,
      "price": 0,
      "currency": "USD?"
    }
  ]
}
```

#### `PATCH /orders/:id/status`
Body: `{ "status": "pending|paid|fulfilled|cancelled" }`  
Data: `{ "order": { "id", "status" } }`

#### `PATCH /orders/:id/viewed` → `{ "order": { "id", "viewedAt" } }`

#### `DELETE /orders/:id` → `{ "message" }`

---

### 6.4 Settings `/settings`

#### `GET /settings`
Data:
```json
{
  "settings": { /* MerchantSettings بدون planCapabilities */ },
  "planCapabilities": { /* PlanCapabilities */ }
}
```

#### `PUT /settings`
Body: كائن إعدادات (نفس حقول settings). أرسل الحقول التي تغيّرت مع الباقي إن كان السيرفر يستبدل جزئياً/كلياً — انسخ الشكل من GET ثم عدّل.

#### `GET /settings/dashboard-stats`
Data:
```json
{
  "totalQueries": 0,
  "chartData": {
    "7days": [{ "name": "string", "queries": 0 }],
    "month": [{ "name": "string", "queries": 0 }],
    "year": [{ "name": "string", "queries": 0 }]
  }
}
```

---

### 6.5 Conversations / Inbox `/conversations`

#### `GET /conversations`
Query: `platform`, `status`, `search`, `includeWeb=true`, `limit`, `offset`  
Data:
```json
{
  "conversations": [/* ConversationSummary */],
  "total": 0,
  "limit": 20,
  "offset": 0
}
```

#### `GET /conversations/:id`
Data:
```json
{
  "conversation": {
    "id": "uuid",
    "platform": "whatsapp",
    "userId": "string|null",
    "userName": "string|null",
    "lastMessageAt": "ISO",
    "createdAt": "ISO",
    "botDisabled": false,
    "status": "string",
    "lastHumanResponseAt": "ISO|null",
    "sourcePost": {
      "source": "string",
      "sourceLabel": "string",
      "platform": "string|null",
      "externalPostId": "string|null",
      "caption": "string|null",
      "thumbnailUrl": "string|null",
      "permalink": "string|null",
      "productId": "string|null",
      "productName": "string|null",
      "commentId": "string|null",
      "adId": "string|null",
      "capturedAt": "ISO|null"
    },
    "messages": [/* InboxMessage */]
  }
}
```

#### `PUT /conversations/:id/disable-bot`
#### `PUT /conversations/:id/enable-bot`

#### `POST /conversations/:id/send-human-message`
Body: `{ "message": "نص", "imageUrl": "url?" }`  
Data يتضمن الرسالة المُرسلة + `delivered` + `botDisabled`.

#### `POST /conversations/:id/typing`
Body: `{ "isTyping": true }`

#### `POST /conversations/:id/mark-read`
Body: `{}`

#### `GET /conversations/get-or-create?platform=&userId=`
للاختبار/playground.

#### `POST /conversations` و `POST /conversations/:id/messages`
لـ Chat Test (playground).

---

### 6.6 Realtime SSE — Inbox (حرج)

```http
GET /conversations/stream
Authorization: Bearer <jwt>
Accept: text/event-stream
```

صيغة SSE:
```text
event: message
data: {"type":"message","merchantId":"...","conversationId":"...","message":{...}}

event: heartbeat
data: {"type":"heartbeat",...}
```

تجاهل `heartbeat` و `connected` في UI.  
عند `message` / `conversation` / `typing` / `read` حدّث القائمة والمحادثة المفتوحة.  
عند الانقطاع: أعد الاتصال بـ exponential backoff (1s → 2 → 4 → 8 → 15s كحد أقصى).

على الموبايل استخدم streaming HTTP مع هيدر Authorization (مكتبات EventSource الافتراضية قد لا تدعم الهيدر).

---

### 6.7 AI `/ai`

#### `POST /ai/chat`
Body:
```json
{
  "conversationId": "uuid?",
  "platform": "web?",
  "botType": "products|services|marketing|support?",
  "messages": [{ "role": "user|assistant|system", "content": "..." }],
  "context": {
    "storeName": "string?",
    "storeCurrency": "string?",
    "systemPrompt": "string?",
    "persona": "formal|friendly|sales|fast|luxury?",
    "policies": {}
  }
}
```
Data: `{ "response": "string", "conversationId": "uuid|null" }`

#### `POST /ai/product-description`
Body: `{ "productName", "keywords?", "category?", "imageBase64?" }`  
Data: `{ "title", "description", "features": [], "cta" }`

#### `POST /ai/marketing-image`
Body:
```json
{
  "prompt": "string",
  "aspectRatio": "1:1|16:9|9:16|4:3|3:4?",
  "referenceImageBase64s": ["base64?"]
}
```
Data: `{ "imageDataUrl": "data:image/...", "revisedPrompt?", "image?": MarketingImageRecord }`

#### `GET /ai/marketing-images?limit=24`
Data: `{ "images": MarketingImageRecord[], "quota?": { "used", "limit", "remaining", "billingPeriod" } }`

#### `GET /ai/marketing-images/:id/content`  
يعيد binary/blob (أضف `?download=1` للتحميل). يحتاج Bearer.

---

### 6.8 Upload `/upload`

#### `POST /upload/single` (multipart field: `file`)
Data:
```json
{
  "file": {
    "filename": "string",
    "originalName": "string",
    "mimetype": "string",
    "size": 0,
    "url": "https://.../uploads/{merchantId}/...",
    "path": "string"
  }
}
```

#### `POST /upload/multiple` (field: `files` متعدد)

#### `POST /upload/proof` (field: `file`) — إثبات دفع صورة/PDF  
نفس شكل `file` أعلاه. استخدم `url` الناتج في طلب الفوترة.

#### `DELETE /upload/:filename`

حدود تقريبية: صور ~10MB، فيديو ~100MP4/MOV حيث ينطبق.

---

### 6.9 Integrations `/integrations`

#### `GET /integrations`
Data تقريباً:
```json
{
  "facebook": {
    "isConnected": false,
    "accountName": "string?",
    "platformId": "string?",
    "lastSync": "ISO?",
    "commentReplyTemplate": "string|null",
    "commentDmTemplate": "string|null",
    "sendDmOnComment": false,
    "pages": [
      {
        "pageId": "string",
        "pageName": "string",
        "autoReplyMessenger": true,
        "autoReplyComments": true
      }
    ]
  },
  "instagram": {
    "isConnected": false,
    "accountName": "string?",
    "platformId": "string?",
    "autoReplyComments": true,
    "autoReplyDM": true,
    "sendDmOnComment": false,
    "commentReplyTemplate": "string|null",
    "commentDmTemplate": "string|null",
    "connectedAt": "ISO?"
  },
  "shopify": { "isConnected": false, "accountName?": "", "lastSync?": "" },
  "storify": { "isConnected": false, "accountName?": "", "lastSync?": "" }
}
```

#### Facebook
- `POST /integrations/facebook/connect` → غالباً `{ authUrl }` لفتح المتصفح
- `GET /integrations/facebook/available-pages?session=`
- `POST /integrations/facebook/link-pages` Body: `{ "session", "pageIds": [] }`
- `DELETE /integrations/facebook/disconnect`
- `DELETE /integrations/facebook/disconnect/:pageId`
- `PUT /integrations/facebook/comment-settings` Body: `{ commentReplyTemplate?, commentDmTemplate?, sendDmOnComment? }`

#### Instagram
- `POST /integrations/instagram/connect` → `{ authUrl? }`
- `PUT /integrations/instagram/settings`
- `DELETE /integrations/instagram/disconnect`

#### Social posts / keyword rules
- `POST /integrations/social/posts/sync` Body: `{ "platform?": "facebook|instagram" }`
- `GET /integrations/social/posts?platform&accountRef&limit&offset` → `{ posts: any[] }`
- `PUT /integrations/social/posts/link-product` `{ socialPostId, productId|null }`
- `PUT /integrations/social/posts/comment-settings`
- `GET|POST /integrations/social/keyword-rules`
- `PUT|DELETE /integrations/social/keyword-rules/:ruleId`
- `PUT /integrations/social/comment-automation-mode`  
  Body: `{ "platform": "facebook|instagram", "mode": "template_all|keyword_rules|off", "accountRef?" }`

#### Shopify
- `POST /integrations/shopify/connect` `{ "shopDomain" }` → `{ authUrl, shopDomain }`
- `DELETE /integrations/shopify/disconnect`
- `POST /integrations/shopify/sync/products`
- `POST /integrations/shopify/sync/orders`
- `GET /integrations/shopify/sync/jobs/:jobId`
- `GET /integrations/shopify/sync/history?platform&limit`
- `PUT /integrations/shopify/settings` `{ autoSync?, syncInterval?, syncProducts?, syncOrders?, syncInventory? }`
- `GET /integrations/shopify/health`
- `GET /integrations/shopify/products/:productId`
- `POST /integrations/shopify/products/:productId/push`

#### Storify
- `POST /integrations/storify/connect`  
  `{ "storeDomain", "accessToken", "apiBaseUrl?", "productsEndpoint?" }`
- `DELETE /integrations/storify/disconnect`
- `POST /integrations/storify/sync/products`
- `GET /integrations/storify/health`

#### Telegram
- `GET /integrations/telegram/bots` → `{ bots: [{ id, botName, botUsername, botType: "products|services|both", isActive, tokenPreview, createdAt, updatedAt }] }`
- `POST /integrations/telegram/bots` `{ botToken, botName?, botType }`
- `PUT /integrations/telegram/bots/:botId` `{ botName?, botType?, isActive? }`
- `DELETE /integrations/telegram/bots/:botId`
- Legacy: `POST /integrations/telegram/connect` `{ botToken }` و `DELETE .../disconnect`

OAuth (FB/IG/Shopify/Google): افتح `authUrl` في Custom Tabs / SFSafariView / Chrome Custom Tabs مع Deep Link للعودة.

---

### 6.10 WhatsApp `/whatsapp`

#### `GET /whatsapp/status`
```json
{
  "isConnected": false,
  "phoneNumber": "string?",
  "phoneNumberId": "string?",
  "businessAccountId": "string?",
  "autoReplyEnabled": true,
  "welcomeMessage": "string?",
  "lastSync": "ISO?"
}
```

#### `POST /whatsapp/connect` (Cloud API)
Body: `{ phoneNumberId, phoneNumber, businessAccountId?, accessToken, appId?, appSecret?, webhookVerifyToken? }`

#### `POST /whatsapp/web/pair` — ابدأ جلسة QR  
Data: `{ "status", "phoneNumber?", "alreadyConnected?" }`

#### `GET /whatsapp/web/events` — SSE للـ QR
نفس بروتوكول SSE. أحداث `WhatsAppPairingEvent`.  
اعرض `qrDataUrl` كصورة QR. عند `status: connected` أغلق شاشة الربط وحدّث الحالة.

#### `DELETE /whatsapp/disconnect`
#### `PUT /whatsapp/settings` `{ autoReplyEnabled?, welcomeMessage? }`

---

### 6.11 Content publishing `/content`

- `GET /content/accounts` → `{ accounts: ContentPublishAccount[] }`
- `GET /content/publications?status&platform&limit&offset` → `{ publications, total }`
- `GET /content/publications/:id` → `{ publication }`
- `POST /content/publications` Body: `CreateContentPublicationPayload`
- `PUT /content/publications/:id`
- `DELETE /content/publications/:id`
- `POST /content/publications/:id/publish`
- `POST /content/publications/:id/schedule` `{ "scheduledAt": "ISO" }`
- `POST /content/publications/:id/cancel`

---

### 6.12 CRM `/crm`

- `GET /crm/stats` → إجماليات عملاء/إيراد
- `GET /crm?search&customerType&status&tags&page&limit&sortBy&sortOrder`  
  → `{ customers: Customer[], pagination: { page, limit, total, totalPages } }`
- `GET /crm/:id` → `{ customer, orders, interactions, conversations }`
- `POST /crm` إنشاء
- `PUT /crm/:id` تحديث
- `DELETE /crm/:id`
- `POST /crm/interactions`  
  `{ customerId, interactionType, title?, description?, platform?, relatedOrderId?, relatedConversationId? }`

---

### 6.13 Analytics `/analytics` (يتطلب hasAdvancedAnalytics)

Period: `7days|30days|90days|year`

- `GET /analytics/dashboard?period=`
- `GET /analytics/sales?period=&groupBy=day|week|month`
- `GET /analytics/conversations?period=`
- `GET /analytics/products?period=`

Dashboard data يشمل: sales totals، ordersOverTime، topProducts، conversations stats، customerGrowth، platformDistribution، commonQuestions.

---

### 6.14 Notifications `/notifications`

- `GET /notifications?unreadOnly=true`
  عنصر: `{ id, type, title, message, data, isRead, createdAt, readAt }`
- `PUT /notifications/:id/read`
- `PUT /notifications/read-all`
- `DELETE /notifications/:id`

Web Push (PWA فقط — اختياري/غير كافٍ لوحده على الموبايل الأصلي):
- `GET /notifications/push/vapid-public-key`
- `GET /notifications/push/status`
- `POST /notifications/push/subscribe`
- `DELETE /notifications/push/unsubscribe`
- `POST /notifications/push/test`  
للموبايل الأصلي: خطط لاحقاً لـ FCM/APNs مع الباك إند.

---

### 6.15 Billing `/billing`

#### `GET /billing/payment-methods`
```json
{
  "methods": [
    {
      "id": "shamCash|usdt|...",
      "name": "string",
      "type": "string",
      "walletAddress": "string",
      "qrImageUrl": "string",
      "network": "string?",
      "instructions": "string?"
    }
  ]
}
```

#### `POST /billing/payment-requests`
Body: `{ "planKey": "string", "proofUrl": "string", "method": "string" }`  
Data: `{ id, planKey, amount, method, status, createdAt }`

#### `GET /billing/payment-requests/me`
قائمة طلبات التاجر الحالية.

#### `GET /admin/subscriptions/public` (عام، بدون JWT)
```json
{
  "plans": [
    { "name": "string", "planKey": "string", "price": 0, "features": ["..."] }
  ]
}
```

تدفق الترقية:
1. اعرض الخطط من `/admin/subscriptions/public`
2. اعرض طرق الدفع من `/billing/payment-methods`
3. ارفع إثبات عبر `/upload/proof`
4. أرسل `/billing/payment-requests` بـ `proofUrl`

---

### 6.16 Affiliate `/affiliate`

- `GET /affiliate/stats` → `AffiliateStats`
- `POST /affiliate/withdraw` `{ "amount": number }`
- `GET /affiliate/track-click?ref=CODE` (عام)

---

### 6.17 Support `/support`

- `POST /support` `{ subject, message, priority?: low|medium|high|urgent }`
- `GET /support/my-tickets`
- `GET /support/:id`
- `POST /support/:ticketId/reply` `{ message, attachments?: [{ url, filename, mimetype, size }] }`

حالات شائعة للتذكرة: `open | in_progress | resolved | closed`.

---

### 6.18 Services `/services` (لاحقاً)

CRUD: `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`  
حقول الخدمة: name, category, type, shortDescription, fullDescription, priceLabel, pricingType (`one_time|subscription|per_hour`), duration, deliveryTime, includedItems[], requirements[], previousWorkTemplates[], bookingLink, contactChannel.

---

### 6.19 Health

`GET /health` أو `/api/health` — عام، للتشخيص.

---

## 7) سلوك شاشة الوارد (مواصفات UX)

1. قائمة محادثات مع فلتر منصة/بحث.
2. عند فتح محادثة: `GET /conversations/:id` ثم `mark-read`.
3. ابدأ SSE عند دخول الوارد طالما المستخدم مسجلاً.
4. عند استلام رسالة جديدة عبر SSE حدّث القائمة فوراً؛ إن كانت المحادثة مفتوحة أضف الرسالة.
5. زر «إيقاف البوت» / «تشغيل البوت».
6. حقل رد + إرسال نص؛ دعم إرفاق صورة عبر upload ثم `send-human-message` مع `imageUrl`.
7. أرسل typing=true أثناء الكتابة (مع debounce) وfalse عند التوقف.
8. اعرض مؤشر typing للعميل إن وصل حدث typing.
9. شارات المنصة (واتساب/فيسبوك/…).

---

## 8) سلوك ربط واتساب QR

1. المستخدم يضغط «ربط واتساب».
2. `POST /whatsapp/web/pair`
3. افتح اتصال SSE على `/whatsapp/web/events`
4. عند حدث `qr` اعرض الصورة من `qrDataUrl`
5. المستخدم يمسح من واتساب → Linked Devices
6. عند `status.connected` أظهر نجاحاً وأعد `GET /whatsapp/status`
7. عند `error` أو `logged_out` أظهر رسالة وأتح إعادة المحاولة

---

## 9) إدارة الحالة المقترحة في التطبيق

```text
AuthStore: token, user, isAuthenticated
SettingsStore: settings, planCapabilities
InboxStore: conversations, activeId, messages, sseConnected, typingMap
CatalogStore: products
OrdersStore: orders, unreadCount
BillingStore: plans, methods, myRequests
IntegrationsStore: status per channel
```

عند `TRIAL_EXPIRED`: فعّل `requiresUpgrade=true` واحصر الميزات مع الإبقاء على Billing/Profile.

---

## 10) معالجة الأخطاء والرسائل (عربي)

| حالة | رسالة مقترحة |
|------|----------------|
| شبكة | تعذر الاتصال بالخادم. تحقق من الإنترنت. |
| 401 | انتهت الجلسة. سجّل الدخول مجدداً. |
| TRIAL_EXPIRED | انتهت الفترة التجريبية. اختر خطة للمتابعة. |
| 429 | محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة. |
| 413 | الملف كبير جداً. صغّر الصورة وأعد المحاولة. |
| رفع فشل | تعذر رفع الملف. |

---

## 11) الأمان (SaaS)

1. لا تخزّن JWT في SharedPreferences غير المشفرة.
2. لا تسجّل التوكن أو كلمات المرور في اللوجات.
3. لا تعرض بيانات تاجر آخر أبداً — أي id في URL يجب أن يعود للسيرفر بالتحقق من التوكن.
4. استخدم HTTPS فقط.
5. لا تضمّن أي API keys لـ OpenAI/Meta/Google داخل التطبيق — كل شيء عبر Backend.
6. امسح التوكن عند Logout وحذف الحساب.

---

## 12) مراحل التسليم المقترحة

### المرحلة A — MVP
Auth، Profile، Dashboard، Inbox+SSE، Products، Orders، Settings، Billing (عرض خطط + رفع إثبات).

### المرحلة B
واتساب QR، حالة التكاملات، Telegram bots، إشعارات داخلية، CRM.

### المرحلة C
Facebook/Instagram OAuth، أتمتة تعليقات، نشر محتوى، Image Studio، Chat Test، Analytics، Affiliate، Support، Shopify/Storify.

### المرحلة D
Deep Links كاملة، إشعارات أصلية FCM/APNs (بالتنسيق مع الباك إند)، صقل المتاجر.

---

## 13) أمثلة طلبات جاهزة

### تسجيل دخول
```http
POST https://xo-bot.com/api/auth/login
Content-Type: application/json

{"email":"merchant@example.com","password":"Secret123!"}
```

### قائمة الوارد
```http
GET https://xo-bot.com/api/conversations?limit=30&offset=0
Authorization: Bearer eyJhbGciOi...
```

### رد بشري
```http
POST https://xo-bot.com/api/conversations/{id}/send-human-message
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json

{"message":"مرحباً، طلبك قيد التجهيز"}
```

### رفع صورة منتج ثم إنشاء منتج
1) `POST /upload/single` multipart  
2) `POST /products` مع `images: [url]` و `imageUrl: url`

### ترقية اشتراك
1) `GET /admin/subscriptions/public`  
2) `GET /billing/payment-methods`  
3) `POST /upload/proof`  
4) `POST /billing/payment-requests` `{ planKey, proofUrl, method }`

---

## 14) ما هو خارج النطاق الآن

- لوحة Super Admin وكل مسارات `/admin/*` المحمية ببوابة السر (ما عدا `/admin/subscriptions/public`).
- Webhooks الخاصة بـ Meta/Shopify/Telegram (خلفية السيرفر فقط).
- تعديل كود الباك إند أو قاعدة البيانات.
- الاعتماد على كوكي الويب HttpOnly كآلية أساسية على الموبايل.

---

## 15) قائمة تحقق قبل اعتبار التطبيق مكتملاً (MVP)

```text
[ ] تسجيل / دخول / خروج / نسيت كلمة المرور
[ ] حفظ JWT بأمان واستعادته بعد قتل التطبيق
[ ] Dashboard يعرض إحصائيات
[ ] Inbox يعرض محادثات ويتحدث لحظياً عبر SSE
[ ] إرسال رد بشري + إيقاف/تشغيل البوت
[ ] CRUD منتجات مع صور
[ ] عرض وتحديث حالات الطلبات
[ ] Settings + planCapabilities تُحترم في UI
[ ] شاشة ترقية عند TRIAL_EXPIRED
[ ] رفع إثبات دفع وطلب اشتراك
[ ] ربط واتساب عبر QR + SSE
[ ] واجهة عربية RTL ولون #FF9A00
[ ] لا تسريب توكنات في اللوجات
```

---

## 16) ملاحظة نهائية

هذا المستند هو **العقد الرسمي للموبايل**.  
إن تعارض سلوك السيرفر الحي مع مثال هنا في حقل اختياري، تكيّف مع الاستجابة الفعلية دون كسر التطبيق.  
الحقول المذكورة كـ required في Body يجب إرسالها؛ الباقي اختياري.

**ابدأ البناء الآن من المرحلة A دون الحاجة لأي ملفات إضافية من المستودع.**
