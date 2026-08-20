/** Public marketing site origin (no trailing slash). */
export function getSiteOrigin(): string {
  const raw =
    (typeof import.meta !== 'undefined'
      ? (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SITE_URL
      : undefined) || 'https://xo-bot.com';
  return raw.replace(/\/+$/, '');
}

export const SEO_DEFAULTS = {
  siteName: 'Xo Bot',
  title: 'Xo Bot للمتاجر',
  description:
    'بوت مبيعات عربي على واتساب وفيسبوك وإنستغرام وتيليجرام — يرد على الرسائل والتعليقات ويبيع عنك.',
  ogImagePath: '/cpu_xo_bot_v2.png',
  locale: 'ar_SA',
  supportEmail: 'support@xo-bot.com',
} as const;

/** Public marketing routes included in sitemap generation scripts. */
export const MARKETING_ROUTES = ['/', '/about', '/storify', '/whatsapp-bot'] as const;

export const ABOUT_FAQ = [
  {
    question: 'ما الفرق بين Xo Bot وManyChat أو Chatfuel؟',
    answer:
      'Xo Bot مبني للسوق العربي أولاً — يفهم اللهجات العربية، ويدمج واتساب + فيسبوك + إنستغرام + تيليجرام في منصة واحدة بأسعار مناسبة للمتاجر الصغيرة والمتوسطة.',
  },
  {
    question: 'هل Xo Bot مناسب للمتاجر التي تبيع عبر واتساب فقط؟',
    answer:
      'نعم — باقة القناة الواحدة ($21/شهر) تتيح ربط واتساب فقط مع بوت مبيعات كامل وكتalog منتجات.',
  },
  {
    question: 'هل بيانات متجري معزولة عن التجار الآخرين؟',
    answer:
      'نعم — Xo Bot منصة SaaS multi-tenant: كل تاجر يرى بياناته فقط (منتجات، محادثات، طلبات).',
  },
  {
    question: 'هل يستخدم Xo Bot WhatsApp Business API رسمياً؟',
    answer:
      'يربط واتساب عبر QR (الأجهزة المرتبطة) — الرقم يبقى على جوال المتجر. لا حاجة لإعداد API معقد في أغلب الحالات.',
  },
  {
    question: 'هل يمكن تجربة Xo Bot مجاناً؟',
    answer: 'نعم — 7 أيام تجربة مجانية من xo-bot.com/signup',
  },
] as const;

export const PUBLIC_PRICING_OFFERS = [
  { name: 'Comments', price: '5', period: 'month', description: 'Facebook & Instagram comment auto-reply' },
  { name: 'Single channel', price: '21', period: 'month', description: 'One sales channel' },
  { name: 'Social', price: '35', period: 'month', description: 'Facebook + Instagram + WhatsApp' },
  { name: 'Yearly', price: '200', period: 'year', description: 'All main channels' },
] as const;

export function absoluteUrl(path: string): string {
  const origin = getSiteOrigin();
  if (!path) return origin;
  return path.startsWith('http') ? path : `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

export function formatPageTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return SEO_DEFAULTS.title;
  if (/xo\s*bot/i.test(trimmed)) return trimmed;
  return `${trimmed} | ${SEO_DEFAULTS.siteName}`;
}

export const LANDING_FAQ = [
  {
    question: 'هل يدعم البوت اللهجات العربية العامية؟',
    answer:
      'نعم — يفهم ويرد باللهجات المصرية والخليجية والشامية وغيرها بدقة عالية، فيبدو كموظف مبيعات حقيقي.',
  },
  {
    question: 'هل أحتاج إلى خبرة برمجية لاستخدام المنصة؟',
    answer:
      'إطلاقاً. الربط مع واتساب وفيسبوك وإنستغرام وتيليجرام يتم من لوحة التحكم بخطوات بسيطة ودون كتابة أي كود.',
  },
  {
    question: 'كيف يتم تحديث معلومات المنتجات والأسعار؟',
    answer:
      'أضف المنتجات يدوياً أو ارفعها من ملف Excel. أي تعديل على الكتالوج ينعكس فوراً على إجابات البوت.',
  },
  {
    question: 'ما الفرق بين باقة التعليقات وباقات المبيعات؟',
    answer:
      'باقة التعليقات للرد الآلي على تعليقات فيسبوك وإنستغرام فقط. باقات المبيعات تضيف بوت الرسائل الخاصة (واتساب / ماسنجر / إنستغرام / تيليجرام حسب الباقة) مع إدارة منتجات وطلبات.',
  },
  {
    question: 'كيف أربط واتساب؟',
    answer:
      'من لوحة الربط اضغط ربط واتساب، ثم امسح رمز QR من واتساب على جوال المتجر (الأجهزة المرتبطة). الرقم يبقى على هاتفك، والمنصة تظهر كجهاز مرتبط للرد على الزبائن.',
  },
  {
    question: 'هل هناك فترة تجربة مجانية؟',
    answer: 'نعم — تجربة مجانية لمدة 7 أيام لاختبار المنصة قبل الاشتراك.',
  },
  {
    question: 'ماذا يحدث إذا لم يعرف البوت الإجابة؟',
    answer:
      'لا يخترع أسعاراً أو معلومات. يعتذر بلطف ويحوّل الحوار للدعم البشري من صندوق الوارد عند الحاجة.',
  },
] as const;

export function buildFaqJsonLd(
  items: ReadonlyArray<{ question: string; answer: string }> = LANDING_FAQ
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

export function buildOrganizationJsonLd(): Record<string, unknown> {
  const origin = getSiteOrigin();
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SEO_DEFAULTS.siteName,
    url: origin,
    logo: absoluteUrl('/icons/icon-512.png'),
    description: SEO_DEFAULTS.description,
    email: SEO_DEFAULTS.supportEmail,
    sameAs: [
      origin,
      `${origin}/about`,
      `${origin}/whatsapp-bot`,
    ],
  };
}

export function buildAboutJsonLd(): Record<string, unknown> {
  const origin = getSiteOrigin();
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: 'About Xo Bot',
    url: `${origin}/about`,
    description: SEO_DEFAULTS.description,
    inLanguage: ['ar', 'en'],
    isPartOf: {
      '@type': 'WebSite',
      name: SEO_DEFAULTS.siteName,
      url: origin,
    },
  };
}

export function buildSoftwareApplicationJsonLd(): Record<string, unknown> {
  const origin = getSiteOrigin();
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SEO_DEFAULTS.siteName,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: origin,
    description: SEO_DEFAULTS.description,
    inLanguage: 'ar',
    offers: PUBLIC_PRICING_OFFERS.map((plan) => ({
      '@type': 'Offer',
      name: plan.name,
      price: plan.price,
      priceCurrency: 'USD',
      description: plan.description,
      url: `${origin}/signup`,
    })),
  };
}
