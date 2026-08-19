import React, { useState, useEffect, useRef } from 'react';
import {
  Package, ShoppingCart, BarChart2, CreditCard, Megaphone, Palette,
  Sparkles, ArrowLeft, ExternalLink, CheckCircle, Zap, Store,
  TrendingUp, Users, Globe, Tag, LayoutTemplate, Bot, ChevronDown,
  Star, ArrowRight,
} from 'lucide-react';
import { usePublishedFooterPages } from '../hooks/usePublishedFooterPages';

interface StorifyPartnerPageProps {
  onNavigateToLogin: () => void;
  onNavigateToSignup: () => void;
  onNavigateToPage?: (slug: string) => void;
  onBack?: () => void;
}

/* ─── Animated counter ───────────────────────────────────────────── */
function useCountUp(target: number, duration = 1800, start = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf: number;
    const startTime = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, start]);
  return count;
}

/* ─── Intersection observer hook ────────────────────────────────── */
function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { threshold }
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

/* ─── Stat card ─────────────────────────────────────────────────── */
function StatCard({ value, suffix, label, inView }: { value: number; suffix: string; label: string; inView: boolean }) {
  const count = useCountUp(value, 1600, inView);
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-4xl md:text-5xl font-extrabold text-brand">
        {count.toLocaleString('en-US')}{suffix}
      </span>
      <span className="text-sm text-slate-500 text-center">{label}</span>
    </div>
  );
}

/* ─── Feature card ──────────────────────────────────────────────── */
function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="relative group p-7 rounded-2xl bg-white border border-slate-100 hover:border-storify-300 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-storify-500/10 overflow-hidden">
      <div className="absolute inset-0 grad-hover opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="relative z-10 mb-5 inline-flex p-3.5 rounded-xl bg-storify-50 text-storify-600 group-hover:bg-storify-400 group-hover:text-slate-900 transition-colors duration-300">
        {icon}
      </div>
      <h3 className="relative z-10 text-lg font-bold mb-2 text-slate-900">{title}</h3>
      <p className="relative z-10 text-slate-500 leading-relaxed text-sm">{description}</p>
    </div>
  );
}

/* ─── Integration badge ─────────────────────────────────────────── */
function IntegrationBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-sm text-slate-700 font-medium shadow-sm">
      {children}
    </span>
  );
}

/* ─── Step card ─────────────────────────────────────────────────── */
function StepCard({ step, title, description }: { step: number; title: string; description: string }) {
  return (
    <div className="flex gap-5 items-start">
      <div className="shrink-0 w-11 h-11 rounded-full grad-step text-slate-900 flex items-center justify-center font-extrabold text-lg shadow-md shadow-storify-400/30">
        {step}
      </div>
      <div className="pt-1">
        <h4 className="font-bold text-slate-900 mb-1">{step === 1 ? title : title}</h4>
        <p className="text-sm text-slate-500 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Main Page Component
═══════════════════════════════════════════════════════════════════ */
const StorifyPartnerPage: React.FC<StorifyPartnerPageProps> = ({
  onNavigateToLogin,
  onNavigateToSignup,
  onNavigateToPage,
  onBack,
}) => {
  const cmsFooterPages = usePublishedFooterPages();
  const statsSection = useInView(0.3);

  const STORIFY_URL = 'https://app.storify.it.com/login?ref=Z8DVTTF5';

  const features = [
    {
      icon: <Sparkles size={22} />,
      title: 'ذكاء اصطناعي مدمج',
      description: 'يساعدك على إضافة المنتجات والتصنيفات وتصميم الصفحات بأوامر بسيطة — بدون أي خبرة تقنية.',
    },
    {
      icon: <Package size={22} />,
      title: 'إدارة ذكية للمنتجات',
      description: 'أضف منتجات غير محدودة مع دعم الفيديو التعريفي، متغيرات متعددة (ألوان، مقاسات، خامات)، ومخزون دقيق.',
    },
    {
      icon: <ShoppingCart size={22} />,
      title: 'منظومة طلبات متطورة',
      description: 'إدارة طلبات سلسة، إنشاء طلبات داخلية يدوياً، واستعادة السلات المتروكة تلقائياً لتعظيم المبيعات.',
    },
    {
      icon: <BarChart2 size={22} />,
      title: 'تحليلات متكاملة ومباشرة',
      description: 'تقارير تفصيلية للزيارات والمبيعات ومعدلات التحويل، مع رصد حي للزوار وتحديد الدول التي يتصفحون منها.',
    },
    {
      icon: <CreditCard size={22} />,
      title: 'بوابات دفع وشحن مجانية',
      description: 'ربط مباشر مع أشهر بوابات الدفع وشركات الشحن، مع إمكانية طلب ربط مخصص مجاني لأي مزود آخر.',
    },
    {
      icon: <Megaphone size={22} />,
      title: 'أدوات تسويق متكاملة',
      description: 'ربط Meta Pixel، TikTok وGoogle، نطاق خاص لعلامتك، وكوبونات خصم لتحفيز العملاء.',
    },
    {
      icon: <LayoutTemplate size={22} />,
      title: 'محرر صفحات بدون تعقيد',
      description: 'واجهة تعديل سلسة ومرنة لتصميم صفحات متجرك بالكامل — بدون أي كود.',
    },
    {
      icon: <Tag size={22} />,
      title: 'تخصيص كامل لصفحة الدفع',
      description: 'مرونة تامة في تصميم صفحة الدفع لضمان تجربة شراء سريعة ومريحة تزيد من معدل الإتمام.',
    },
  ];

  const steps = [
    { title: 'أنشئ متجرك على ستوريفاي', description: 'سجّل في ستوريفاي وأنشئ متجرك خلال دقائق معدودة بمساعدة الذكاء الاصطناعي.' },
    { title: 'فعّل xoBot على متجرك', description: 'اربط بوت المبيعات الذكي من xoBot وابدأ الرد الآلي على عملائك عبر كل قنواتك.' },
    { title: 'راقب وحقق نتائج حقيقية', description: 'تابع تحليلات متجرك وأداء البوت من مكان واحد واتخذ قرارات أذكى.' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans" dir="rtl">
      {/* ── Injected storify colors ─────────────────────────────────── */}
      <style>{`
        :root {
          --storify-50: #f6f9ef;
          --storify-100: #ebf2da;
          --storify-200: #d4e3aa;
          --storify-300: #bad176;
          --storify-400: #a2c037;
          --storify-500: #8fa82b;
          --storify-600: #718520;
          --storify-700: #556419;
        }
        .bg-storify-50 { background-color: var(--storify-50); }
        .bg-storify-400 { background-color: var(--storify-400); }
        .bg-storify-500 { background-color: var(--storify-500); }
        .bg-storify-600 { background-color: var(--storify-600); }
        .text-storify-600 { color: var(--storify-600); }
        .text-storify-500 { color: var(--storify-500); }
        .text-storify-700 { color: var(--storify-700); }
        .text-storify-400 { color: var(--storify-400); }
        .border-storify-300 { border-color: var(--storify-300); }
        .border-storify-400 { border-color: var(--storify-400); }
        .border-storify-500 { border-color: var(--storify-500); }
        .grad-hover { background-image: linear-gradient(to bottom right, rgba(246, 249, 239, 0.6), transparent); }
        .grad-step { background-image: linear-gradient(to bottom right, var(--storify-400), var(--storify-500)); }
        .grad-text { background-image: linear-gradient(to left, var(--storify-400), var(--storify-600)); }
        .grad-card { background-image: linear-gradient(to bottom, var(--storify-50), white); }
        .grad-cta { background-image: linear-gradient(to bottom right, var(--storify-600), var(--storify-700)); }
        .hover\\:bg-storify-500:hover { background-color: var(--storify-500); }
        .hover\\:bg-storify-600:hover { background-color: var(--storify-600); }
        .hover\\:border-storify-300:hover { border-color: var(--storify-300); }
        .hover\\:border-storify-400:hover { border-color: var(--storify-400); }
        .shadow-storify-400\\/30 { --tw-shadow-color: rgb(162 192 55 / 0.3); }
        .shadow-storify-500\\/10 { --tw-shadow-color: rgb(143 168 43 / 0.1); }
        .shadow-storify-500\\/30 { --tw-shadow-color: rgb(143 168 43 / 0.3); }
        .ring-storify-500 { --tw-ring-color: var(--storify-500); }
        .from-storify-500\\/20 { --tw-gradient-from: rgb(143 168 43 / 0.2); }
        .from-storify-400\\/10 { --tw-gradient-from: rgb(162 192 55 / 0.1); }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(28px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50%      { transform: translateY(-10px); }
        }
        .animate-fade-up    { animation: fadeUp 0.7s ease forwards; }
        .animate-fade-up-d1 { animation: fadeUp 0.7s 0.15s ease both; }
        .animate-fade-up-d2 { animation: fadeUp 0.7s 0.30s ease both; }
        .animate-fade-up-d3 { animation: fadeUp 0.7s 0.45s ease both; }
        .animate-float      { animation: float 4s ease-in-out infinite; }
      `}</style>

      {/* ── Navbar ────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo xoBot */}
          <button
            onClick={onBack}
            className="flex items-center gap-2 group"
            aria-label="الرئيسية"
          >
            <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center shadow-sm">
              <Bot size={18} className="text-white" />
            </div>
            <span className="font-extrabold text-slate-900 text-lg leading-none">
              xo<span className="text-brand">Bot</span>
            </span>
          </button>

          {/* Partnership badge */}
          <div className="hidden sm:flex items-center gap-2 px-4 py-1.5 rounded-full bg-storify-50 border border-storify-200 text-storify-700 text-sm font-semibold">
            <Star size={14} className="fill-storify-500 text-storify-500" />
            شراكة استراتيجية
          </div>

          {/* CTA */}
          <div className="flex items-center gap-2">
            <button
              onClick={onNavigateToLogin}
              className="hidden sm:block text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors px-3 py-1.5"
            >
              تسجيل الدخول
            </button>
            <a
              href={STORIFY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-storify-400 hover:bg-storify-500 text-slate-900 text-sm font-bold transition-colors shadow-sm"
            >
              <Store size={15} />
              ابدأ متجرك
            </a>
          </div>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-20 pb-24 px-4 sm:px-6">
        {/* Decorative blobs */}
        <div className="absolute -top-32 -right-32 w-[480px] h-[480px] rounded-full bg-storify-500/10 blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-[380px] h-[380px] rounded-full bg-brand/10 blur-[90px] pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          {/* Partnership label */}
          <div className="animate-fade-up inline-flex items-center gap-2 mb-6 px-5 py-2 rounded-full bg-white border border-slate-200 shadow-sm text-sm font-semibold text-slate-600">
            <span className="w-2 h-2 rounded-full bg-storify-500 animate-pulse" />
            شراكة xoBot × ستوريفاي
          </div>

          <h1 className="animate-fade-up-d1 text-4xl sm:text-5xl md:text-6xl font-extrabold text-slate-900 leading-[1.15] mb-6">
            متجرك الذكي
            <br />
            <span className="grad-text bg-clip-text text-transparent">
              يبيع وأنت نايم
            </span>
          </h1>

          <p className="animate-fade-up-d2 text-lg sm:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed mb-10">
            أنشئ متجرك الاحترافي مع <strong className="text-storify-600 font-bold">ستوريفاي</strong>، وفعّل بوت المبيعات الذكي من <strong className="text-brand font-bold">xoBot</strong> — ثنائي يجعل مشروعك يعمل على مدار الساعة بدون مبرمج.
          </p>

          <div className="animate-fade-up-d3 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href={STORIFY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-storify-400 hover:bg-storify-500 text-slate-900 font-bold text-base transition-all duration-200 shadow-lg shadow-storify-400/30 hover:scale-[1.03]"
            >
              <Store size={20} />
              ابدأ مجاناً مع ستوريفاي
              <ExternalLink size={16} />
            </a>
            <button
              onClick={onNavigateToSignup}
              className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-white border border-slate-200 hover:border-brand text-slate-800 font-bold text-base transition-all duration-200 hover:shadow-md"
            >
              <Bot size={20} className="text-brand" />
              جرّب xoBot مجاناً
            </button>
          </div>

          {/* Hero visual */}
          <div className="animate-float mt-16 relative mx-auto max-w-2xl">
            <div className="relative rounded-3xl bg-white border border-slate-200 shadow-2xl shadow-slate-200/80 overflow-hidden">
              {/* Mock browser bar */}
              <div className="flex items-center gap-2 px-5 py-3 bg-slate-50 border-b border-slate-100">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <div className="flex-1 h-6 rounded-lg bg-slate-200 text-xs text-slate-400 flex items-center px-3 gap-1.5">
                  <Globe size={12} />
                  mystore.storify.it.com
                </div>
              </div>
              {/* Mock store UI */}
              <div className="p-6 grid grid-cols-3 gap-3">
                {['👗 ملابس', '👟 أحذية', '🕶️ إكسسوار'].map((cat) => (
                  <div key={cat} className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-center">
                    <div className="text-2xl mb-1">{cat.split(' ')[0]}</div>
                    <div className="text-xs text-slate-600 font-medium">{cat.split(' ')[1]}</div>
                  </div>
                ))}
              </div>
              <div className="px-6 pb-6 grid grid-cols-2 gap-3">
                {[
                  { name: 'فستان صيفي', price: '89$', badge: '🔥 الأكثر مبيعاً' },
                  { name: 'حذاء رياضي', price: '149$', badge: '✨ جديد' },
                ].map((p) => (
                  <div key={p.name} className="rounded-xl grad-card border border-storify-100 p-4">
                    <div className="h-12 rounded-lg bg-storify-100 mb-3 flex items-center justify-center text-xl">🛍️</div>
                    <div className="text-xs font-bold text-slate-800">{p.name}</div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-storify-600 font-extrabold text-sm">{p.price}</span>
                      <span className="text-[10px] text-slate-400">{p.badge}</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* xoBot bubble */}
              <div className="absolute bottom-5 left-5 flex items-end gap-2">
                <div className="w-9 h-9 rounded-full bg-brand flex items-center justify-center shadow-md">
                  <Bot size={18} className="text-white" />
                </div>
                <div className="bg-brand text-white text-xs font-semibold px-3 py-2 rounded-2xl rounded-bl-sm shadow-md max-w-[160px]">
                  أهلاً! كيف أقدر أساعدك اليوم؟ 🤖
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ────────────────────────────────────────────────────── */}
      <section ref={statsSection.ref} className="py-16 bg-white border-y border-slate-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <StatCard value={5000} suffix="+" label="متجر نشط" inView={statsSection.inView} />
            <StatCard value={98} suffix="%" label="رضا التجار" inView={statsSection.inView} />
            <StatCard value={24} suffix="/7" label="دعم فني متاح" inView={statsSection.inView} />
            <StatCard value={0} suffix="$" label="رسوم ربط البوابات" inView={statsSection.inView} />
          </div>
        </div>
      </section>

      {/* ── About Storify ────────────────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <span className="inline-block mb-4 px-4 py-1.5 rounded-full bg-storify-50 text-storify-600 text-sm font-bold border border-storify-200">
                عن ستوريفاي
              </span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-5 leading-snug">
                منصة التجارة الإلكترونية
                <span className="text-storify-600"> الأذكى عربياً</span>
              </h2>
              <p className="text-slate-500 text-base leading-relaxed mb-6">
                ستوريفاي منصة متكاملة لإطلاق وإدارة متجرك الإلكتروني من الصفر — بذكاء اصطناعي يساعدك في كل خطوة، وأدوات احترافية تنافس المنصات العالمية بسعر في متناول الجميع.
              </p>
              <ul className="space-y-3">
                {[
                  'إطلاق متجر كامل في أقل من ساعة',
                  'ذكاء اصطناعي يبني متجرك معك خطوة بخطوة',
                  'ربط فوري مع كل بوابات الدفع المحلية والعالمية',
                  'بدون عمولة على مبيعاتك — أرباحك كلها لك',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle size={18} className="text-storify-500 mt-0.5 shrink-0" />
                    <span className="text-slate-700 text-sm font-medium">{item}</span>
                  </li>
                ))}
              </ul>
              <a
                href={STORIFY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-8 inline-flex items-center gap-2 text-storify-600 font-bold hover:text-storify-700 transition-colors group text-sm"
              >
                اكتشف ستوريفاي
                <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
              </a>
            </div>

            {/* Feature highlights grid */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: <Sparkles size={20} />, label: 'ذكاء اصطناعي' },
                { icon: <Package size={20} />, label: 'مخزون لا محدود' },
                { icon: <BarChart2 size={20} />, label: 'تحليلات مباشرة' },
                { icon: <Globe size={20} />, label: 'نطاق خاص' },
                { icon: <Tag size={20} />, label: 'كوبونات خصم' },
                { icon: <CreditCard size={20} />, label: 'بوابات دفع مجانية' },
                { icon: <TrendingUp size={20} />, label: 'سلات متروكة' },
                { icon: <Palette size={20} />, label: 'تصميم بدون كود' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-3 p-4 rounded-2xl bg-white border border-slate-100 hover:border-storify-300 hover:shadow-md transition-all duration-200 group"
                >
                  <span className="text-storify-500 group-hover:scale-110 transition-transform">{item.icon}</span>
                  <span className="text-slate-700 font-semibold text-sm">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <span className="inline-block mb-3 px-4 py-1.5 rounded-full bg-storify-50 text-storify-600 text-sm font-bold border border-storify-200">
              المميزات
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-4">
              كل ما تحتاجه في منصة واحدة
            </h2>
            <p className="text-slate-500 max-w-xl mx-auto text-base">
              من إدارة المنتجات إلى التسويق والتحليلات — ستوريفاي يضع بين يديك أدوات المتاجر الكبرى بسهولة استخدام لا تُضاهى.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map((f) => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Partnership / How it works ────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-start">
            {/* Steps */}
            <div>
              <span className="inline-block mb-4 px-4 py-1.5 rounded-full bg-brand/10 text-brand text-sm font-bold border border-brand/20">
                الشراكة معاً
              </span>
              <h2 className="text-3xl font-extrabold text-slate-900 mb-4 leading-snug">
                xoBot + ستوريفاي
                <br />
                <span className="text-brand">ثنائي المبيعات الذكي</span>
              </h2>
              <p className="text-slate-500 leading-relaxed mb-10">
                ستوريفاي يبني متجرك الاحترافي، وxoBot يتولى التواصل مع عملائك وإتمام المبيعات آلياً — معاً يُشكّلان منظومة متكاملة لنمو مشروعك.
              </p>
              <div className="space-y-8">
                {steps.map((s, i) => (
                  <StepCard key={s.title} step={i + 1} {...s} />
                ))}
              </div>
            </div>

            {/* Benefit cards */}
            <div className="space-y-4">
              {[
                {
                  icon: <Zap size={20} />,
                  title: 'إعداد في دقائق',
                  description: 'لا تحتاج لأي خبرة تقنية. الذكاء الاصطناعي في ستوريفاي وإعداد xoBot المبسّط يجعلان البدء أسهل من أي وقت.',
                  color: 'amber',
                },
                {
                  icon: <Bot size={20} />,
                  title: 'بوت مبيعات لا ينام',
                  description: 'xoBot يرد على استفسارات عملائك، يعرض المنتجات، ويكمل الطلبات آلياً — على واتساب، إنستغرام، فيسبوك وتيليجرام.',
                  color: 'brand',
                },
                {
                  icon: <TrendingUp size={20} />,
                  title: 'نمو مستمر وقابل للقياس',
                  description: 'تحليلات ستوريفاي وتقارير xoBot في مكان واحد — راقب أداء متجرك وبوتك واتخذ قرارات مبنية على البيانات.',
                  color: 'storify',
                },
                {
                  icon: <Users size={20} />,
                  title: 'تجربة عملاء استثنائية',
                  description: 'من تصفح المتجر حتى إتمام الدفع — تجربة سلسة وسريعة ترفع رضا العملاء وتُعزز ولاءهم.',
                  color: 'storify',
                },
              ].map((card) => (
                <div
                  key={card.title}
                  className="flex gap-4 p-5 rounded-2xl bg-white border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all duration-200 group"
                >
                  <div className={`shrink-0 mt-0.5 p-2.5 rounded-xl ${card.color === 'brand' ? 'bg-brand/10 text-brand' : 'bg-storify-50 text-storify-600'} group-hover:scale-110 transition-transform`}>
                    {card.icon}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 mb-1">{card.title}</h4>
                    <p className="text-sm text-slate-500 leading-relaxed">{card.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Integrations ─────────────────────────────────────────────── */}
      <section className="py-16 bg-white border-y border-slate-100 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-sm font-semibold text-slate-400 mb-6 uppercase tracking-widest">يتكامل مع</p>
          <div className="flex flex-wrap justify-center gap-3">
            {['Meta Pixel', 'Google Analytics', 'TikTok Pixel', 'واتساب', 'إنستغرام', 'فيسبوك', 'تيليجرام', 'مدى', 'STCPay', 'Stripe', 'Tabby', 'Tamara'].map((item) => (
              <IntegrationBadge key={item}>
                <span className="w-1.5 h-1.5 rounded-full bg-storify-500" />
                {item}
              </IntegrationBadge>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <div className="relative rounded-3xl overflow-hidden grad-cta text-white p-10 sm:p-14 text-center shadow-2xl shadow-storify-500/30">
            {/* Decorative circles */}
            <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/5 pointer-events-none" />
            <div className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />
            <div className="absolute top-6 left-1/2 -translate-x-1/2 flex gap-1">
              {[...Array(5)].map((_, i) => (
                <Star key={i} size={14} className="fill-brand text-brand" />
              ))}
            </div>

            <div className="relative z-10 pt-4">
              <div className="inline-flex items-center gap-3 mb-6 px-5 py-2 rounded-full bg-white/10 text-sm font-semibold">
                <Store size={16} />
                ابدأ مشروعك اليوم
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold mb-5 leading-snug">
                احصل على المتجر والبوت
                <br />
                <span className="text-storify-100">معاً في يوم واحد</span>
              </h2>
              <p className="text-white/80 text-base max-w-xl mx-auto mb-10 leading-relaxed">
                لا تنتظر — أنشئ متجرك الاحترافي على ستوريفاي الآن، وفعّل xoBot ليتولى مبيعاتك على مدار الساعة.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href={STORIFY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-white text-storify-700 font-extrabold text-base hover:bg-slate-50 transition-all duration-200 shadow-lg hover:scale-[1.03]"
                >
                  <Store size={20} />
                  أنشئ متجرك مجاناً
                  <ExternalLink size={15} />
                </a>
                <button
                  onClick={onNavigateToSignup}
                  className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-brand text-white font-bold text-base hover:bg-brand-600 transition-all duration-200 shadow-md"
                >
                  <Bot size={20} className="text-white" />
                  سجّل في xoBot
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="bg-white border-t border-slate-100 py-10 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-brand flex items-center justify-center">
                <Bot size={15} className="text-white" />
              </div>
              <span className="font-extrabold text-slate-800">
                xo<span className="text-brand">Bot</span>
              </span>
              <span className="text-slate-300 mx-2">×</span>
              <a
                href={STORIFY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-extrabold text-storify-600 hover:text-storify-700 transition-colors"
              >
                Storify
              </a>
            </div>

            {cmsFooterPages.length > 0 && (
              <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2">
                {cmsFooterPages.map((page) => (
                  <button
                    key={page.slug}
                    onClick={() => onNavigateToPage?.(page.slug)}
                    className="text-sm text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    {page.title}
                  </button>
                ))}
              </nav>
            )}

            <p className="text-sm text-slate-400">
              © {new Date().getFullYear()} xoBot — جميع الحقوق محفوظة
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default StorifyPartnerPage;
