import { Product, MerchantSettings, Service } from './types';

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: '1',
    name: 'قميص قطني فاخر',
    price: 25,
    currency: 'USD',
    category: 'ملابس رجالية',
    stock: 120,
    description: 'قميص مصنوع من القطن المصري الفاخر 100%، مناسب للصيف والربيع.',
    sizes: ['S', 'M', 'L', 'XL'],
    imageUrl: 'https://picsum.photos/200/200?random=1',
    source: 'manual'
  },
  {
    id: '2',
    name: 'حذاء رياضي للمشي',
    price: 85,
    currency: 'USD',
    category: 'أحذية',
    stock: 45,
    description: 'حذاء مريح جداً للمشي لمسافات طويلة، نعل طبي.',
    sizes: ['40', '41', '42', '43', '44'],
    imageUrl: 'https://picsum.photos/200/200?random=2',
    source: 'manual'
  },
  {
    id: '3',
    name: 'ساعة يد كلاسيكية',
    price: 150,
    currency: 'USD',
    category: 'إكسسوارات',
    stock: 10,
    description: 'ساعة يد مقاومة للماء بتصميم كلاسيكي وحزام جلدي.',
    sizes: [],
    imageUrl: 'https://picsum.photos/200/200?random=3',
    source: 'manual'
  },
  {
    id: '4',
    name: 'حقيبة ظهر ذكية',
    price: 45,
    currency: 'USD',
    category: 'حقائب',
    stock: 200,
    description: 'حقيبة ظهر مع منفذ USB للشحن ومكان مخصص للابتوب.',
    sizes: [],
    imageUrl: 'https://picsum.photos/200/200?random=4',
    source: 'manual'
  }
];

// --- Mock Services Data ---
export const INITIAL_SERVICES: Service[] = [
  {
    id: 'svc_1',
    name: 'إدارة حملات إعلانية',
    category: 'تسويق رقمي',
    type: 'اشتراك شهري',
    shortDescription: 'إدارة كاملة لحملات السوشيال ميديا على فيسبوك وإنستغرام',
    fullDescription: 'نقوم بدراسة جمهورك المستهدف وإطلاق حملات إعلانية مركزة لتحقيق أفضل عائد على الاستثمار.',
    priceLabel: 'ابتداءً من 200 دولار شهرياً',
    pricingType: 'subscription',
    duration: 'شهر واحد قابل للتجديد',
    deliveryTime: 'يبدأ العمل خلال 48 ساعة من الدفع',
    includedItems: [
        'تصميم 4 إعلانات إبداعية',
        'كتابة النصوص الإعلانية (Copywriting)',
        'استهداف دقيق للجمهور',
        'تقرير أداء أسبوعي'
    ],
    requirements: [
        'حساب إعلاني مفعل',
        'صور عالية الجودة للمنتجات',
        'تحديد الميزانية الإعلانية'
    ],
    previousWorkTemplates: [
        'حملة لمتجر ملابس: https://example.com/case-study-1',
        'نتائج حملة مطعم: زيادة 30% في الطلبات'
    ],
    bookingLink: 'https://calendly.com/demo/ads',
    contactChannel: 'WhatsApp'
  },
  {
    id: 'svc_2',
    name: 'استشارة تطوير أعمال',
    category: 'استشارات',
    type: 'جلسة واحدة',
    shortDescription: 'جلسة استشارية مدتها ساعة عبر زووم',
    fullDescription: 'نناقش فيها تحديات مشروعك ونضع خطة عمل واضحة للنمو.',
    priceLabel: '150 دولار للجلسة',
    pricingType: 'one_time',
    duration: '60 دقيقة',
    deliveryTime: 'حسب المواعيد المتاحة في التقويم',
    includedItems: [
        'تحليل الوضع الحالي للمشروع',
        'تحديد نقاط الضعف والقوة',
        'اقتراح حلول عملية',
        'تسجيل للجلسة'
    ],
    requirements: [
        'إرسال ملخص عن المشروع قبل الجلسة',
        'تحضير الأسئلة المراد مناقشتها'
    ],
    previousWorkTemplates: [],
    bookingLink: 'https://calendly.com/demo/consulting',
    contactChannel: 'Email'
  }
];

export const DEFAULT_SETTINGS: MerchantSettings = {
  storeName: 'متجر الأناقة',
  telegramBotToken: '',
  welcomeMessage: 'أهلاً بك في متجرنا! كيف يمكنني مساعدتك اليوم؟',
  systemPrompt: 'أنت مساعد ذكي لمتجر إلكتروني. استخدم البيانات المقدمة للإجابة على أسئلة العملاء.',
  autoReplyComments: false,
  autoReplyMessenger: false,
  storeCurrency: 'SAR',
  botPersona: 'friendly',
  storePolicies: {
    shippingPolicy: 'الشحن متاح لجميع المناطق. تكلفة الشحن تعتمد على المدينة.',
    deliveryTime: '3-5 أيام عمل',
    paymentMethods: 'الدفع عند الاستلام، بطاقة مدى， Apple Pay',
    returnPolicy: '',
    additionalNotes: '',
    enableAIInjection: true
  },
  signupDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
  // Sales optimization defaults
  enableCrossSelling: true,
  enableUpselling: true,
  enableUrgencyMessages: true,
  enableSocialProof: true,
  defaultDiscountPercentage: 10,
  salesScripts: {},
  abandonedReminderEnabled: true,
  abandonedReminderDelayMinutes: 45,
  abandonedReminderMessage: '',
};

export const SAAS_MARKETING_DATA = {
  product_name: "Xo Bot للمتاجر",
  main_value: "بوت مبيعات ذكي عربي يرد على عملائك ويبيع عنك على واتساب وفيسبوك وإنستغرام وتيليجرام — من التعليق إلى الطلب في لوحة واحدة.",
  pricing_notes: "نقدم تجربة مجانية لمدة 7 أيام. الباقات: التعليقات (5$)، القناة الواحدة (21$)، السوشيال (35$)، والسنوية (200$).",
  features: [
    "بوت مبيعات على واتساب، ماسنجر فيسبوك، إنستغرام، وتيليجرام",
    "رد آلي على التعليقات وتحويل المهتمين لرسائل خاصة",
    "فهم اللهجات العربية (مصري، خليجي، شامي)",
    "إدارة منتجات وطلبات وCRM وتحليلات من لوحة عربية",
    "نشر محتوى وستوديو صور تسويقية بالذكاء الاصطناعي"
  ],
  cta: "يمكنك البدء الآن مجاناً بالضغط على زر 'جرب مجاناً 7 أيام' في أعلى الصفحة!"
};

export const SAAS_SUPPORT_DATA = {
  tutorials: {
    add_product: [
      "انتقل إلى صفحة 'إدارة المنتجات' من القائمة الجانبية.",
      "اضغط على زر 'منتج جديد' في الأعلى.",
      "أدخل اسم المنتج، السعر، والصورة.",
      "يمكنك استخدام زر 'اكتب الوصف تلقائياً' لتوليد وصف مميز.",
      "اضغط 'حفظ المنتج'."
    ],
    connect_channel: [
      "انتقل إلى صفحة 'الربط والتكامل'.",
      "اختر القناة: واتساب أو فيسبوك أو إنستغرام أو تيليجرام.",
      "اضغط 'ربط' واتبع التعليمات لتفويض الحساب.",
      "بعد النجاح يمكنك تفعيل الرد الآلي واختبار البوت."
    ],
    test_bot: [
      "انتقل إلى صفحة 'تجربة البوت'.",
      "اختر شخصية البوت (ودود، رسمي، مبيعات...) من القائمة العلوية.",
      "اكتب أي سؤال في المحادثة لتر كيف سيرد البوت على عملائك."
    ]
  },
  support_contact: "إذا واجهت أي مشكلة تقنية، يمكنك مراسلتنا على support@xo-bot.com"
};