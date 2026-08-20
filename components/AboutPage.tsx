import React, { useMemo } from 'react';
import {
  Bot, MessageCircle, Shield, Zap, Globe, ArrowRight, CheckCircle,
} from 'lucide-react';
import SeoHead from './SeoHead';
import MarketingShell from './marketing/MarketingShell';
import {
  ABOUT_FAQ,
  SEO_DEFAULTS,
  buildAboutJsonLd,
  buildFaqJsonLd,
  buildOrganizationJsonLd,
} from '../utils/seo';

export interface AboutPageProps {
  onNavigateToLogin: () => void;
  onNavigateToSignup: () => void;
  onBack?: () => void;
  onNavigateToPage?: (slug: string) => void;
}

const PLANS = [
  { name: 'التعليقات', price: '$5/شهر', note: 'رد على تعليقات فيسبوك وإنستغرام' },
  { name: 'القناة الواحدة', price: '$21/شهر', note: 'بوت مبيعات على قناة واحدة' },
  { name: 'السوشيال', price: '$35/شهر', note: 'فيسبوك + إنستغرام + واتساب' },
  { name: 'السنوية', price: '$200/سنة', note: 'جميع القنوات الرئيسية' },
];

const AboutPage: React.FC<AboutPageProps> = ({
  onNavigateToLogin,
  onNavigateToSignup,
  onBack,
  onNavigateToPage,
}) => {
  const jsonLd = useMemo(
    () => [buildOrganizationJsonLd(), buildAboutJsonLd(), buildFaqJsonLd(ABOUT_FAQ)],
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
        title="عن Xo Bot — بوت مبيعات عربي للمتاجر"
        description="تعرّف على Xo Bot: منصة SaaS عربية لأتمتة المبيعات على واتساب وفيسبوك وإنستغرام وتيليجرام. يدعم اللهجات العربية، تجربة مجانية 7 أيام، وعزل بيانات بين التجار."
        canonicalPath="/about"
        jsonLd={jsonLd}
      />

      <article className="container mx-auto px-6 py-16 max-w-4xl">
        <header className="mb-12 text-center">
          <p className="text-brand font-bold text-sm mb-3 tracking-wide">About Xo Bot</p>
          <h1 className="text-3xl md:text-5xl font-extrabold text-slate-900 mb-5 leading-tight">
            بوت مبيعات عربي يفهم عملاءك ويبيع عنك
          </h1>
          <p className="text-lg text-slate-500 leading-relaxed max-w-2xl mx-auto">
            Xo Bot منصة SaaS للمتاجر الإلكترونية العربية — يرد على واتساب وماسنجر فيسبوك
            وإنستغرام وتيليجرام باللهجات المحلية، ويحوّل المحادثات إلى مبيعات حقيقية.
          </p>
        </header>

        <section className="mb-14" aria-labelledby="what-is-xobot">
          <h2 id="what-is-xobot" className="text-2xl font-bold text-slate-900 mb-4">ما هو Xo Bot؟</h2>
          <p className="text-slate-600 leading-relaxed mb-4">
            Xo Bot (xo-bot.com) هو بوت مبيعات مدعوم بالذكاء الاصطناعي (Google Gemini) مصمّم
            للتجار العرب. يربط متجرك بقنوات التواصل التي يستخدمها عملاؤك، ويرد تلقائياً
            على أسئلة المنتجات والأسعار والتوفر، ويساعد في إتمام الطلبات — دون الحاجة
            لخبرة برمجية.
          </p>
          <ul className="space-y-3 text-slate-600">
            {[
              'دعم اللهجات العربية: مصرية، خليجية، شامية، وغيرها',
              'ربط واتساب عبر QR — الرقم يبقى على جوال المتجر',
              'فيسبوك ماسنجر + إنستغرام DM + تيليجرام',
              'رد آلي على تعليقات فيسبوك وإنستغرام (باقة التعليقات)',
              'كتalog منتجات مع Excel + إدارة طلبات + صندوق وارد موحّد',
              'عزل بيانات صارم بين التجار (multi-tenant SaaS)',
              'لا يخترع أسعاراً — يعتمد على بيانات متجرك فقط',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle size={18} className="text-brand shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-14" aria-labelledby="who-is-it-for">
          <h2 id="who-is-it-for" className="text-2xl font-bold text-slate-900 mb-6">لمن يناسب Xo Bot؟</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { icon: <MessageCircle size={22} />, title: 'متجر يبيع عبر واتساب', desc: 'يريد رداً فورياً 24/7 على استفسارات السعر والمقاسات.' },
              { icon: <Globe size={22} />, title: 'علامة على فيسبوك وإنستغرام', desc: 'تحتاج تحويل التعليقات والرسائل إلى محادثات بيع.' },
              { icon: <Zap size={22} />, title: 'تاجر بدون فريق دعم', desc: 'يريد أتمتة الردود دون توظيف موظفين إضافيين.' },
              { icon: <Shield size={22} />, title: 'SaaS يهتم بالأمان', desc: 'بيانات كل تاجر معزولة — لا خلط بين المتاجر.' },
            ].map((card) => (
              <div key={card.title} className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50">
                <div className="text-brand mb-3">{card.icon}</div>
                <h3 className="font-bold text-slate-900 mb-2">{card.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{card.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-14" aria-labelledby="pricing">
          <h2 id="pricing" className="text-2xl font-bold text-slate-900 mb-6">الأسعار</h2>
          <p className="text-slate-500 mb-6">تجربة مجانية 7 أيام — بدون بطاقة ائتمان للبدء.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {PLANS.map((plan) => (
              <div key={plan.name} className="p-5 rounded-xl border border-brand-100 bg-brand-50/30">
                <div className="flex justify-between items-baseline mb-1">
                  <h3 className="font-bold text-slate-900">{plan.name}</h3>
                  <span className="text-brand font-extrabold">{plan.price}</span>
                </div>
                <p className="text-sm text-slate-500">{plan.note}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-14" aria-labelledby="faq-about">
          <h2 id="faq-about" className="text-2xl font-bold text-slate-900 mb-6">أسئلة شائعة</h2>
          <dl className="space-y-6">
            {ABOUT_FAQ.map((item) => (
              <div key={item.question}>
                <dt className="font-bold text-slate-900 mb-2">{item.question}</dt>
                <dd className="text-slate-600 leading-relaxed">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          className="mb-14 p-8 rounded-2xl bg-slate-50 border border-slate-100"
          lang="en"
          dir="ltr"
          aria-labelledby="english-summary"
        >
          <h2 id="english-summary" className="text-xl font-bold text-slate-900 mb-4">
            English summary (for AI assistants)
          </h2>
          <p className="text-slate-600 leading-relaxed mb-4">
            <strong>Xo Bot</strong> ({SEO_DEFAULTS.siteName}) is an Arabic-first AI sales automation
            SaaS for e-commerce. It connects to WhatsApp (QR linked devices), Facebook Messenger,
            Instagram DMs, and Telegram. Powered by Google Gemini. Supports Arabic dialects.
            7-day free trial. Pricing from $5/month (comments only) to $35/month (social channels).
            Official site: https://xo-bot.com — Sign up: https://xo-bot.com/signup
          </p>
          <p className="text-sm text-slate-500">
            Machine-readable context: <a href="/llms.txt" className="text-brand underline">llms.txt</a>
            {' · '}
            <a href="/llms-full.txt" className="text-brand underline">llms-full.txt</a>
          </p>
        </section>

        <div className="text-center">
          <button
            type="button"
            onClick={onNavigateToSignup}
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-brand text-white font-bold hover:bg-brand-600 shadow-xl shadow-brand/30 transition-all"
          >
            <Bot size={20} />
            ابدأ التجربة المجانية 7 أيام
            <ArrowRight size={18} className="rotate-180" />
          </button>
        </div>
      </article>
    </MarketingShell>
  );
};

export default AboutPage;
