import React, { useMemo } from 'react';
import { Bot, MessageCircle, Clock, Shield, ArrowRight, Smartphone } from 'lucide-react';
import SeoHead from './SeoHead';
import MarketingShell from './marketing/MarketingShell';
import { buildFaqJsonLd, buildSoftwareApplicationJsonLd } from '../utils/seo';

export interface WhatsAppBotPageProps {
  onNavigateToLogin: () => void;
  onNavigateToSignup: () => void;
  onBack?: () => void;
  onNavigateToPage?: (slug: string) => void;
}

const WHATSAPP_FAQ = [
  {
    question: 'هل أحتاج WhatsApp Business API؟',
    answer:
      'لا بالضرورة. Xo Bot يربط واتساب عبر QR (الأجهزة المرتبطة) — الرقم يبقى على جوالك وترد المنصة نيابةً عنك.',
  },
  {
    question: 'هل البوت يرد باللهجات العربية على واتساب؟',
    answer:
      'نعم — يفهم اللهجة التي يكتب بها العميل ويرد بأسلوب طبيعي (مصري، خليجي، شامي…).',
  },
  {
    question: 'ماذا يسأل العملاء عادةً على واتساب؟',
    answer:
      'السعر، المقاسات، الألوان، التوفر، الشحن — البوت يجيب من كتalog متجرك المحدّث.',
  },
  {
    question: 'ماذا لو سأل العميل سؤالاً لا يعرفه البوت؟',
    answer:
      'يعتذر بلطف ويحوّل المحادثة للدعم البشري من صندوق الوارد — دون اختراع معلومات.',
  },
] as const;

const WhatsAppBotPage: React.FC<WhatsAppBotPageProps> = ({
  onNavigateToLogin,
  onNavigateToSignup,
  onBack,
  onNavigateToPage,
}) => {
  const jsonLd = useMemo(
    () => [
      buildSoftwareApplicationJsonLd(),
      buildFaqJsonLd(WHATSAPP_FAQ),
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'بوت واتساب للمتاجر — Xo Bot',
        description:
          'بوت واتساب عربي للمتاجر الإلكترونية — يرد على العملاء تلقائياً ويبيع عنك 24/7.',
        url: 'https://xo-bot.com/whatsapp-bot',
      },
    ],
    []
  );

  return (
    <MarketingShell
      onNavigateToLogin={onNavigateToLogin}
      onNavigateToSignup={onNavigateToSignup}
      onBack={onBack}
      onNavigateToPage={onNavigateToPage}
    >
      <SeoHead
        title="بوت واتساب للمتاجر — رد آلي وبيع 24/7"
        description="بوت واتساب عربي للمتاجر الإلكترونية. يرد على أسئلة السعر والمقاسات والتوفر باللهجات العربية. ربط بـ QR بدون برمجة. تجربة مجانية 7 أيام."
        canonicalPath="/whatsapp-bot"
        jsonLd={jsonLd}
      />

      <article className="container mx-auto px-6 py-16 max-w-4xl">
        <header className="mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-50 text-green-700 text-sm font-semibold mb-6">
            <MessageCircle size={16} />
            WhatsApp Sales Bot
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold text-slate-900 mb-5 leading-tight">
            بوت واتساب يرد على عملائك ويبيع عنك
          </h1>
          <p className="text-lg text-slate-500 leading-relaxed max-w-2xl">
            حوّل رسائل «كم السعر؟» و«متى يوصل؟» على واتساب إلى مبيعات — بوت عربي
            يفهم اللهجات ويجيب من كتalog متجرك الحقيقي.
          </p>
        </header>

        <section className="grid sm:grid-cols-3 gap-4 mb-14">
          {[
            { icon: <Smartphone size={22} />, title: 'ربط بـ QR', desc: 'دقائق — بدون API معقد' },
            { icon: <Clock size={22} />, title: '24/7', desc: 'لا تفوّت رسالة بعد اليوم' },
            { icon: <Shield size={22} />, title: 'بدون اختراع', desc: 'يجيب من بيانات متجرك فقط' },
          ].map((item) => (
            <div key={item.title} className="p-5 rounded-2xl border border-slate-100 text-center">
              <div className="text-brand flex justify-center mb-3">{item.icon}</div>
              <h2 className="font-bold text-slate-900 mb-1">{item.title}</h2>
              <p className="text-sm text-slate-500">{item.desc}</p>
            </div>
          ))}
        </section>

        <section className="mb-14">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">كيف يعمل؟</h2>
          <ol className="space-y-4">
            {[
              'أنشئ حساباً على Xo Bot وفعّل التجربة المجانية',
              'أضف منتجاتك (يدوياً أو Excel)',
              'من لوحة الربط → واتساب → امسح QR من جوال المتجر',
              'البوت يبدأ الرد على العملاء تلقائياً',
            ].map((step, i) => (
              <li key={step} className="flex items-start gap-4">
                <span className="w-8 h-8 rounded-full bg-brand text-white font-bold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <span className="text-slate-600 pt-1">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mb-14">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">أسئلة شائعة — بوت واتساب</h2>
          <dl className="space-y-6">
            {WHATSAPP_FAQ.map((item) => (
              <div key={item.question}>
                <dt className="font-bold text-slate-900 mb-2">{item.question}</dt>
                <dd className="text-slate-600 leading-relaxed">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mb-10 p-6 rounded-2xl bg-brand-50 border border-brand-100" lang="en" dir="ltr">
          <h2 className="font-bold text-slate-900 mb-2">English: Arabic WhatsApp sales bot</h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            Xo Bot offers an Arabic WhatsApp sales bot for e-commerce stores. Link via QR code,
            dialect-aware replies, product catalog integration, 7-day free trial.
            https://xo-bot.com/whatsapp-bot
          </p>
        </section>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={onNavigateToSignup}
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-brand text-white font-bold hover:bg-brand-600 shadow-xl shadow-brand/30"
          >
            <Bot size={20} />
            جرّب بوت واتساب مجاناً
            <ArrowRight size={18} className="rotate-180" />
          </button>
          <a
            href="/about"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl border border-slate-200 text-slate-700 font-bold hover:border-brand hover:text-brand transition-colors"
          >
            المزيد عن Xo Bot
          </a>
        </div>
      </article>
    </MarketingShell>
  );
};

export default WhatsAppBotPage;
