import React, { useMemo } from 'react';
import {
  Building2,
  Handshake,
  Layers,
  Percent,
  ShieldCheck,
  Users,
  MessageCircle,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import SeoHead from './SeoHead';
import MarketingShell from './marketing/MarketingShell';
import { buildFaqJsonLd, buildOrganizationJsonLd } from '../utils/seo';
import { PATHS } from '../routes/paths';

export interface AgencyPartnerPageProps {
  onNavigateToLogin: () => void;
  onNavigateToSignup: () => void;
  onBack?: () => void;
  onNavigateToPage?: (slug: string) => void;
}

const AGENCY_FAQ = [
  {
    question: 'من يمكنه أن يصبح وكيلاً؟',
    answer:
      'وكالات التسويق، مدراء صفحات السوشيال، ومستشارو التجارة الإلكترونية الذين يديرون متاجر متعددة ويرغبون بتقديم Xo Bot لعملائهم بأسعار شراكة.',
  },
  {
    question: 'كيف يعمل التسعير؟',
    answer:
      'نحدد معك أسعاراً مخفّضة لكل باقة (تعليقات، قناة واحدة، سوشيال، سنوية). تفتح مقعداً لكل عميل وتدفع السعر المتفق عليه — ثم تسعّر لعملائك كما تشاء.',
  },
  {
    question: 'هل لعملائي حسابات مستقلة؟',
    answer:
      'نعم. كل عميل يحصل على حساب منفصل ببياناته وقنواته ومنتجاته — معزولة تماماً عن بقية عملاء وكالتك.',
  },
  {
    question: 'ماذا يشمل حساب الوكالة؟',
    answer:
      'لوحة إدارة للمقاعد والمدفوعات والتقارير فقط — بدون ربط قنوات تشغيلية على حساب الوكالة نفسه. التشغيل يكون على مقاعد العملاء.',
  },
] as const;

const BENEFITS = [
  {
    icon: Percent,
    title: 'أسعار شراكة مخفّضة',
    desc: 'اتفاق تسعير خاص بوكالتك لكل باقة — أقل من أسعار الكتالوج العامة.',
  },
  {
    icon: Users,
    title: 'مقاعد بلا حد عملي',
    desc: 'افتح مقعداً جديداً لكل عميل عند الحاجة وادفع فور التفعيل أو التجديد.',
  },
  {
    icon: Layers,
    title: 'إدارة مركزية',
    desc: 'لوحة واحدة لمتابعة المقاعد، التجديدات، المدفوعات، والتقارير.',
  },
  {
    icon: ShieldCheck,
    title: 'عزل كامل بين العملاء',
    desc: 'كل متجر على حساب مستقل — منتجاته وقنواته ومحادثاته لا تختلط.',
  },
] as const;

const STEPS = [
  {
    step: '01',
    title: 'قدّم طلب إنشاء حساب الوكالة',
    desc: 'سجّل بيانات الوكالة عبر النموذج — يصل الطلب إلى فريقنا للمراجعة.',
  },
  {
    step: '02',
    title: 'الموافقة وتفعيل الحساب',
    desc: 'بعد الموافقة نفعّل حسابك كوكالة ونحدد الأسعار المخفّضة المتفق عليها.',
  },
  {
    step: '03',
    title: 'افتح مقاعد لعملائك',
    desc: 'أنشئ حساباً لكل عميل، ادفع السعر المتفق عليه، وفعّل الباقة المناسبة.',
  },
] as const;

const WHATSAPP_AGENCY_URL =
  'https://wa.me/963933284664?text=' + encodeURIComponent('أريد أن أكون وكيلا');

const AgencyPartnerPage: React.FC<AgencyPartnerPageProps> = ({
  onNavigateToLogin,
  onNavigateToSignup,
  onBack,
  onNavigateToPage,
}) => {
  const jsonLd = useMemo(
    () => [
      buildOrganizationJsonLd(),
      buildFaqJsonLd([...AGENCY_FAQ]),
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'كن وكيلاً لـ Xo Bot',
        description:
          'برنامج وكلاء Xo Bot لوكالات التسويق: مقاعد عملاء بأسعار مخفّضة ولوحة إدارة مركزية.',
        url: 'https://xo-bot.com/become-agency',
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
        title="كن وكيلاً لـ Xo Bot — شراكة لمقاعد العملاء"
        description="انضم كوكيل لـ Xo Bot: أسعار مخفّضة متفق عليها، مقاعد مستقلة لعملائك، ولوحة إدارة للمدفوعات والتجديدات. تواصل معنا لبدء الشراكة."
        canonicalPath={PATHS.BECOME_AGENCY}
        jsonLd={jsonLd}
      />

      {/* Hero — one composition, brand first */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(249,115,22,0.18),transparent_55%),radial-gradient(ellipse_at_90%_20%,rgba(15,23,42,0.08),transparent_45%),linear-gradient(180deg,#fff7ed_0%,#ffffff_55%,#f8fafc_100%)]"
          aria-hidden
        />
        <div
          className="absolute inset-0 opacity-[0.35] bg-[url('data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23fb923c\' fill-opacity=\'0.08\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')]"
          aria-hidden
        />

        <div className="relative container mx-auto px-6 pt-16 pb-20 md:pt-24 md:pb-28 max-w-5xl">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/80 border border-orange-200/80 text-orange-800 text-sm font-semibold mb-8 shadow-sm backdrop-blur-sm animate-fade-in">
            <Handshake size={16} />
            برنامج الشركاء
          </div>

          <p
            className="text-4xl md:text-6xl font-black tracking-tight text-slate-900 mb-3 animate-fade-in"
            dir="ltr"
          >
            Xo <span className="text-brand">Bot</span>
          </p>

          <h1 className="text-3xl md:text-5xl font-extrabold text-slate-900 mb-5 leading-tight max-w-3xl animate-fade-in">
            كن وكيلاً وقدّم المنصة لعملائك بأسعار شراكة
          </h1>

          <p className="text-lg md:text-xl text-slate-600 leading-relaxed max-w-2xl mb-10 animate-fade-in">
            لوكالات التسويق ومديري المتاجر المتعددين: مقاعد مستقلة لكل عميل، تسعير مخفّض
            متفق عليه، ولوحة إدارة للمقاعد والمدفوعات — دون تعقيد تشغيلي على حسابك.
          </p>

          <div className="flex flex-wrap items-center gap-3 animate-fade-in">
            <button
              type="button"
              onClick={onNavigateToSignup}
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-brand text-white font-bold text-base hover:bg-brand-600 transition-all shadow-lg shadow-brand/25 hover:-translate-y-0.5"
            >
              <Building2 size={18} />
              إنشاء حساب وكالة
            </button>
            <button
              type="button"
              onClick={onNavigateToLogin}
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-white border border-slate-200 text-slate-800 font-bold text-base hover:border-brand hover:text-brand transition-all"
            >
              تسجيل دخول الوكالة
            </button>
            <a
              href={WHATSAPP_AGENCY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-[#25D366] text-white font-bold text-base hover:bg-[#1ebe57] transition-all shadow-lg shadow-green-500/25"
            >
              <MessageCircle size={18} />
              واتساب
            </a>
          </div>
        </div>
      </section>

      {/* Benefits — one job */}
      <section className="py-20 bg-white" aria-labelledby="agency-benefits">
        <div className="container mx-auto px-6 max-w-5xl">
          <h2 id="agency-benefits" className="text-2xl md:text-3xl font-extrabold text-slate-900 mb-3 text-center">
            لماذا تصبح وكيلاً؟
          </h2>
          <p className="text-slate-500 text-center mb-12 max-w-2xl mx-auto">
            ابنِ عرضاً متكرراً لعملائك على أساس <span dir="ltr" className="font-semibold">Xo Bot</span> مع هامش واضح وإدارة بسيطة.
          </p>
          <div className="grid sm:grid-cols-2 gap-6">
            {BENEFITS.map((item, i) => (
              <div
                key={item.title}
                className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:border-orange-200 hover:bg-orange-50/30 transition-colors"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="w-11 h-11 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center mb-4">
                  <item.icon size={22} />
                </div>
                <h3 className="font-bold text-slate-900 text-lg mb-2">{item.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 bg-slate-900 text-white relative overflow-hidden" aria-labelledby="agency-steps">
        <div
          className="absolute -left-20 top-10 w-72 h-72 rounded-full bg-brand/20 blur-3xl"
          aria-hidden
        />
        <div className="container mx-auto px-6 max-w-5xl relative">
          <h2 id="agency-steps" className="text-2xl md:text-3xl font-extrabold mb-3 text-center">
            كيف تبدأ؟
          </h2>
          <p className="text-slate-400 text-center mb-12">ثلاث خطوات واضحة من الطلب إلى أول مقعد مفعّل</p>
          <div className="grid md:grid-cols-3 gap-8">
            {STEPS.map((s) => (
              <div key={s.step} className="relative">
                <div className="text-5xl font-black text-brand/40 mb-3">{s.step}</div>
                <h3 className="text-xl font-bold mb-2">{s.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="py-20 bg-slate-50" aria-labelledby="agency-includes">
        <div className="container mx-auto px-6 max-w-4xl">
          <div className="flex items-center gap-3 justify-center mb-8">
            <Building2 className="text-brand" size={28} />
            <h2 id="agency-includes" className="text-2xl md:text-3xl font-extrabold text-slate-900">
              ماذا تحصل عليه؟
            </h2>
          </div>
          <ul className="space-y-4 max-w-2xl mx-auto">
            {[
              'حساب وكالة لإدارة المقاعد فقط (بدون قنوات تشغيلية على حسابك)',
              'تسعير مخفّض متفق عليه لكل باقة من باقات Xo Bot',
              'إنشاء حسابات عملاء مستقلة بإيميل وكلمة مرور',
              'دفع فوري لكل مقعد (تفعيل / تجديد / تغيير باقة)',
              'تقارير: المقاعد النشطة، المدفوعات، والتنبيهات قبل الانتهاء',
              'إعادة تعيين كلمة مرور العميل وتعديل بياناته من لوحتك',
            ].map((line) => (
              <li key={line} className="flex gap-3 text-slate-700">
                <CheckCircle2 className="text-brand shrink-0 mt-0.5" size={20} />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-white" aria-labelledby="agency-faq">
        <div className="container mx-auto px-6 max-w-3xl">
          <h2 id="agency-faq" className="text-2xl md:text-3xl font-extrabold text-slate-900 mb-10 text-center">
            أسئلة شائعة
          </h2>
          <div className="space-y-4">
            {AGENCY_FAQ.map((item) => (
              <details
                key={item.question}
                className="group rounded-2xl border border-slate-200 bg-slate-50/50 open:bg-white open:shadow-sm open:border-orange-200 transition-all"
              >
                <summary className="cursor-pointer list-none px-5 py-4 font-bold text-slate-900 flex items-center justify-between gap-3">
                  {item.question}
                  <Sparkles size={16} className="text-brand shrink-0 opacity-60 group-open:opacity-100" />
                </summary>
                <p className="px-5 pb-5 text-slate-600 text-sm leading-relaxed">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-50 via-white to-slate-100" />
        <div className="relative container mx-auto px-6 max-w-3xl text-center">
          <h2 className="text-2xl md:text-4xl font-extrabold text-slate-900 mb-4">
            جاهز لبناء محفظة عملاء على <span dir="ltr">Xo Bot</span>؟
          </h2>
          <p className="text-slate-600 mb-8 max-w-xl mx-auto">
            أرسل طلب إنشاء حساب الوكالة الآن، أو سجّل الدخول إن كان حسابك مفعّلاً.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={onNavigateToSignup}
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-brand text-white font-bold hover:bg-brand-600 transition-all shadow-lg shadow-brand/25"
            >
              <Building2 size={18} />
              إنشاء حساب وكالة
            </button>
            <button
              type="button"
              onClick={onNavigateToLogin}
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl border border-slate-300 text-slate-800 font-bold hover:border-brand hover:text-brand transition-all"
            >
              تسجيل دخول الوكالة
            </button>
            <a
              href={WHATSAPP_AGENCY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-[#25D366] text-white font-bold hover:bg-[#1ebe57] transition-all"
            >
              <MessageCircle size={18} />
              واتساب
            </a>
          </div>
          <p className="mt-6 text-sm text-slate-500" dir="ltr">
            +963 933 284 664
          </p>
        </div>
      </section>
    </MarketingShell>
  );
};

export default AgencyPartnerPage;
