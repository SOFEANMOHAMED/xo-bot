import React, { useState, useEffect, useMemo } from 'react';
import {
  Zap, MessageCircle, CheckCircle, Mail, ArrowRight, Shield,
  Plus, Minus, Loader2, TrendingUp, Clock, UserCircle, BarChart2,
  MessageSquare, Database, Cpu, Sparkles, Inbox, Image, Package,
  Send, Instagram, Facebook, ShoppingCart, Store
} from 'lucide-react';
import LandingChatBot from './LandingChatBot';
import AntigravityHero from './AntigravityHero';
import BrandLogo from './BrandLogo';
import SeoHead from './SeoHead';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { usePublishedFooterPages } from '../hooks/usePublishedFooterPages';
import { validateEmail, validateLength } from '../utils/validation';
import {
  LANDING_FAQ,
  SEO_DEFAULTS,
  buildFaqJsonLd,
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
} from '../utils/seo';

interface LandingPageProps {
  onNavigateToLogin: () => void;
  onNavigateToSignup: () => void;
  onNavigateToPage?: (slug: string) => void;
}

interface Plan {
  name: string;
  planKey: string;
  price: number;
  features: string[];
  billingPeriod?: 'monthly' | 'yearly';
  description?: string;
}

const LandingPage: React.FC<LandingPageProps> = ({ onNavigateToLogin, onNavigateToSignup, onNavigateToPage }) => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(true);
  const cmsFooterPages = usePublishedFooterPages();
  const landingJsonLd = useMemo(
    () => [buildOrganizationJsonLd(), buildSoftwareApplicationJsonLd(), buildFaqJsonLd()],
    []
  );

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        setIsLoadingPlans(true);
        const response = await apiService.getPublicSubscriptionPlans();
        if (response && typeof response === 'object' && 'plans' in response && Array.isArray(response.plans)) {
          setPlans(response.plans);
        } else {
          throw new Error('Unexpected response structure');
        }
      } catch (error: any) {
        logger.error('Failed to fetch subscription plans:', error);
        setPlans([
          {
            name: 'التعليقات',
            planKey: 'comments',
            price: 5,
            billingPeriod: 'monthly',
            description: 'رد آلي على التعليقات فقط — بدون بوت مبيعات.',
            features: [
              'رد على تعليقات فيسبوك وإنستغرام فقط',
              'بدون بوت مبيعات (رسائل خاصة)',
              'ربط صفحة فيسبوك واحدة',
              'ربط حساب إنستغرام واحد',
              'استخدام AI غير محدود',
              '5 صور تسويقية بالذكاء الاصطناعي شهرياً',
              'دعم فني عبر البريد'
            ]
          },
          {
            name: 'القناة الواحدة',
            planKey: 'single',
            price: 21,
            billingPeriod: 'monthly',
            description: 'بوت مبيعات على قناة واحدة من اختيارك.',
            features: [
              'بوت مبيعات ذكي',
              'ربط قناة واحدة: فيسبوك أو إنستغرام أو تيليجرام أو واتساب',
              'استخدام AI غير محدود',
              '20 صورة تسويقية بالذكاء الاصطناعي شهرياً',
              'إدارة منتجات وطلبات',
              'دعم فني'
            ]
          },
          {
            name: 'السوشيال',
            planKey: 'social',
            price: 35,
            billingPeriod: 'monthly',
            description: 'فيسبوك وإنستغرام وواتساب لبوت المبيعات.',
            features: [
              'بوت مبيعات ذكي',
              'ربط صفحة فيسبوك واحدة',
              'ربط حساب إنستغرام واحد',
              'ربط واتساب واحد',
              'استخدام AI غير محدود',
              '40 صورة تسويقية بالذكاء الاصطناعي شهرياً',
              'إدارة منتجات وطلبات',
              'تحليلات متقدمة',
              'دعم فني أولوية'
            ]
          },
          {
            name: 'السنوية',
            planKey: 'yearly',
            price: 200,
            billingPeriod: 'yearly',
            description: 'باقة سنوية شاملة للقنوات الرئيسية.',
            features: [
              'بوت مبيعات ذكي',
              'ربط صفحة فيسبوك واحدة',
              'ربط حساب إنستغرام واحد',
              'ربط بوت تيليجرام واحد',
              'ربط واتساب واحد',
              'استخدام AI غير محدود',
              '200 صورة تسويقية بالذكاء الاصطناعي سنوياً',
              'إدارة منتجات وطلبات',
              'تحليلات متقدمة',
              'فوترة سنوية بوفر واضح',
              'دعم فني أولوية'
            ]
          }
        ]);
      } finally {
        setIsLoadingPlans(false);
      }
    };
    fetchPlans();
  }, []);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' });
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactSuccess, setContactSuccess] = useState(false);

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setContactError(null);
    const errors: string[] = [];
    const nameValidation = validateLength(contactForm.name, 2, 100, 'الاسم');
    if (!nameValidation.isValid) errors.push(...nameValidation.errors);
    const emailValidation = validateEmail(contactForm.email);
    if (!emailValidation.isValid) errors.push(...emailValidation.errors);
    const messageValidation = validateLength(contactForm.message, 10, 1000, 'الرسالة');
    if (!messageValidation.isValid) errors.push(...messageValidation.errors);
    if (errors.length > 0) {
      setContactError(errors.join('، '));
      return;
    }
    setContactSuccess(true);
    setContactForm({ name: '', email: '', message: '' });
    setTimeout(() => setContactSuccess(false), 5000);
  };

  const getPlanDisplayProps = (planKey: string) => {
    const props: { [key: string]: { popular?: boolean } } = {
      comments: {},
      single: { popular: true },
      social: {},
      yearly: {}
    };
    return props[planKey] || {};
  };

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900 dir-rtl selection:bg-brand-200 selection:text-slate-900 overflow-x-hidden relative">
      <SeoHead
        title={SEO_DEFAULTS.title}
        description={SEO_DEFAULTS.description}
        canonicalPath="/"
        jsonLd={landingJsonLd}
      />
      {/* Soft warm atmosphere */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#FFF8EB_0%,_#ffffff_55%,_#ffffff_100%)]" />
        <div className="absolute -top-32 left-1/4 w-[420px] h-[420px] rounded-full bg-brand-200/40 blur-[100px] animate-blob" />
        <div className="absolute top-1/3 -right-20 w-[360px] h-[360px] rounded-full bg-brand-100/60 blur-[90px] animate-blob animation-delay-2000" />
        <div className="absolute bottom-0 left-1/3 w-[300px] h-[300px] rounded-full bg-orange-100/50 blur-[80px] animate-blob animation-delay-4000" />
      </div>
      <AntigravityHero />

      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-brand-100/80">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <BrandLogo className="h-9 w-auto select-none" />

          <div className="hidden md:flex items-center gap-7 text-sm font-semibold text-slate-600">
            <button onClick={() => scrollToSection('home')} className="hover:text-brand transition-colors">الرئيسية</button>
            <button onClick={() => scrollToSection('features')} className="hover:text-brand transition-colors">المميزات</button>
            <button onClick={() => scrollToSection('case-studies')} className="hover:text-brand transition-colors">قصص النجاح</button>
            <button onClick={() => scrollToSection('pricing')} className="hover:text-brand transition-colors">الأسعار</button>
            <a href="/storify" className="text-[#8fa82b] hover:text-[#718520] transition-colors flex items-center gap-1 font-bold"><Store size={14} /> شراكة ستوريفاي</a>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onNavigateToLogin}
              className="text-sm font-semibold text-slate-600 hover:text-brand transition-colors hidden sm:block"
            >
              تسجيل الدخول
            </button>
            <button
              onClick={onNavigateToSignup}
              className="px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm hover:bg-brand-600 transition-all shadow-lg shadow-brand/30"
            >
              جرب مجاناً 7 أيام
            </button>
          </div>
        </div>
      </nav>

      {/* Hero — brand first, one composition */}
      <section id="home" className="relative min-h-[100svh] flex flex-col justify-center pt-28 pb-16 md:pt-32 md:pb-24">
        <div className="container mx-auto px-6 relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            <div className="flex justify-center mb-6 animate-fade-in-up">
              <BrandLogo className="h-16 sm:h-20 md:h-24 w-auto select-none drop-shadow-sm" />
            </div>

            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-800 leading-snug mb-5 animate-fade-in-up" style={{ animationDelay: '0.08s' }}>
              ذكاء اصطناعي يرد على عملائك ويبيع عنك
            </h1>

            <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed mb-9 animate-fade-in-up" style={{ animationDelay: '0.16s' }}>
              بوت مبيعات يفهم اللهجات العربية — على واتساب، ماسنجر فيسبوك، إنستغرام، وتيليجرام — ويرد على التعليقات ويحوّلها لمحادثات بيع.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-in-up" style={{ animationDelay: '0.24s' }}>
              <button
                onClick={onNavigateToSignup}
                className="w-full sm:w-auto px-8 py-3.5 bg-brand text-white rounded-xl font-bold text-base hover:bg-brand-600 shadow-xl shadow-brand/30 transition-all flex items-center justify-center gap-2"
              >
                <span>ابدأ التجربة المجانية</span>
                <ArrowRight size={18} className="rotate-180" />
              </button>
              <button
                onClick={() => scrollToSection('how-it-works')}
                className="w-full sm:w-auto px-8 py-3.5 bg-white text-slate-800 rounded-xl font-bold text-base border border-slate-200 hover:border-brand-300 hover:text-brand transition-all"
              >
                كيف يعمل؟
              </button>
            </div>

            <div className="mt-5 flex justify-center animate-fade-in-up" style={{ animationDelay: '0.28s' }}>
              <a href="/storify" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-[#f6f9ef] to-white border border-[#d4e3aa] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all group">
                <span className="flex h-6 w-6 rounded-full bg-[#a2c037] items-center justify-center text-white">
                  <Store size={12} />
                </span>
                <span className="text-sm font-bold text-slate-800">
                  هل تحتاج متجراً إلكترونياً؟ <span className="text-[#8fa82b] group-hover:text-[#718520] transition-colors underline underline-offset-4 decoration-2 decoration-[#d4e3aa]">اكتشف عرض الشراكة مع ستوريفاي</span>
                </span>
              </a>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-5 mt-8 text-sm text-slate-500 animate-fade-in-up" style={{ animationDelay: '0.32s' }}>
              <span className="inline-flex items-center gap-1.5"><Sparkles size={14} className="text-brand" /> Gemini</span>
              <span className="inline-flex items-center gap-1.5"><Shield size={14} className="text-brand" /> عزل بيانات التجار</span>
              <span className="inline-flex items-center gap-1.5"><Zap size={14} className="text-brand" /> إعداد في دقائق</span>
              <span className="inline-flex items-center gap-1.5"><Clock size={14} className="text-brand" /> تجربة 7 أيام</span>
            </div>
          </div>

          {/* Product visual — full-bleed feel within container */}
          <div className="mt-14 md:mt-16 relative mx-auto max-w-5xl animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
            <div className="absolute -inset-4 bg-gradient-to-r from-brand-200 via-brand-100 to-transparent rounded-[2rem] blur-2xl opacity-70" />
            <div className="relative overflow-hidden rounded-2xl border border-brand-100 bg-gradient-to-br from-white via-brand-50/40 to-white shadow-2xl shadow-brand/10">
              <div className="absolute top-0 inset-x-0 h-9 bg-white/90 border-b border-brand-100 flex items-center px-4 gap-2 z-20">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <span className="mr-3 text-xs font-medium text-slate-400">Xo Bot · لوحة الذكاء</span>
              </div>

              <div className="relative pt-9 aspect-video md:aspect-[16/9] flex items-center justify-center">
                {/* Soft neural grid */}
                <svg className="absolute inset-0 w-full h-full opacity-[0.12]" aria-hidden>
                  <defs>
                    <pattern id="ai-grid" width="36" height="36" patternUnits="userSpaceOnUse">
                      <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#FF9A00" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#ai-grid)" />
                </svg>

                {/* Conversation chips */}
                <div className="absolute top-14 right-4 md:right-10 max-w-[180px] bg-white/90 backdrop-blur border border-brand-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5 shadow-lg animate-float z-20">
                  <p className="text-sm font-medium text-slate-700">كم السعر؟</p>
                </div>
                <div className="absolute top-28 left-4 md:left-10 max-w-[200px] bg-brand text-white rounded-2xl rounded-br-sm px-3.5 py-2.5 shadow-lg shadow-brand/25 animate-float-delayed z-20">
                  <p className="text-sm font-medium">السعر 149 $ مع التوصيل</p>
                </div>
                <div className="absolute bottom-16 right-6 md:right-16 max-w-[190px] bg-white/90 backdrop-blur border border-brand-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5 shadow-lg animate-float z-20" style={{ animationDelay: '0.8s' }}>
                  <p className="text-sm font-medium text-slate-700">هل متوفر مقاس L؟</p>
                </div>

                <BrandLogo
                  className="relative z-10 max-w-[85%] md:max-w-[70%] h-auto drop-shadow-xl"
                  style={{ maxHeight: '280px' }}
                  alt="Xo Bot — بوت المبيعات الذكي"
                />
              </div>
            </div>

            {/* Floating signals outside overflow */}
            <div className="hidden md:flex absolute top-1/3 -right-6 bg-white border border-brand-100 p-3.5 rounded-2xl shadow-xl items-center gap-3 animate-bounce z-20" style={{ animationDuration: '3.2s' }}>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-500">
                <CheckCircle size={20} />
              </div>
              <div>
                <p className="text-xs text-slate-400">تم البيع</p>
                <p className="font-bold text-slate-800">+ 125.00$</p>
              </div>
            </div>
            <div className="hidden md:flex absolute bottom-1/4 -left-6 bg-white border border-brand-100 p-3.5 rounded-2xl shadow-xl items-center gap-3 animate-bounce z-20" style={{ animationDuration: '4s' }}>
              <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center text-brand">
                <MessageCircle size={20} />
              </div>
              <div>
                <p className="text-xs text-slate-400">استفسار جديد</p>
                <p className="font-bold text-slate-800">متوفر مقاس L؟</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 relative z-10 bg-white">
        <div className="container mx-auto px-6">
          <div className="text-center mb-14 max-w-2xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-3">
              من الإعداد إلى <span className="text-brand">البيع</span> في ثلاث خطوات
            </h2>
            <p className="text-slate-500">
              بدون برمجة — أضف منتجاتك، اربط قناتك، ودع البوت يبيع.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              { step: '1', icon: <Package size={24} />, title: 'أضف منتجاتك', desc: 'أدخلها يدوياً أو ارفعها من Excel، واستخدم الذكاء الاصطناعي لكتابة وصف تسويقي.' },
              { step: '2', icon: <Send size={24} />, title: 'اربط قناتك', desc: 'واتساب و/أو فيسبوك و/أو إنستغرام و/أو تيليجرام — بضغطة من لوحة الربط.' },
              { step: '3', icon: <ShoppingCart size={24} />, title: 'البوت يبيع', desc: 'يرد، يعرض المنتج، ويبني الطلب — وأنت تتدخل من صندوق الوارد عند الحاجة.' },
            ].map((item) => (
              <div key={item.step} className="relative p-7 rounded-2xl bg-white border border-slate-100 hover:border-brand-200 transition-all hover:shadow-xl hover:shadow-brand/10">
                <span className="absolute top-5 left-5 text-4xl font-extrabold text-brand-100">{item.step}</span>
                <div className="mb-5 p-3.5 rounded-xl w-fit bg-brand-50 text-brand">
                  {item.icon}
                </div>
                <h3 className="text-lg font-bold mb-2 text-slate-900">{item.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 relative z-10 bg-slate-50">
        <div className="container mx-auto px-6">
          <div className="text-center mb-14 max-w-2xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-3">
              من الاستفسار إلى الطلب — <span className="text-brand">بدون فريق كبير</span>
            </h2>
            <p className="text-slate-500">
              أدوات مبيعات وخدمة عملاء مبنية لمتاجر السوشيال ميديا العربية.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard icon={<MessageCircle size={28} />} title="بوت مبيعات متعدد القنوات" description="واتساب، ماسنجر فيسبوك، رسائل إنستغرام، وتيليجرام — بلهجة عربية طبيعية كأن موظفاً حقيقياً يرد." />
            <FeatureCard icon={<MessageSquare size={28} />} title="من التعليق إلى البيع" description="رد آلي على تعليقات فيسبوك وإنستغرام مع رسالة خاصة تلقائية للمهتمين." />
            <FeatureCard icon={<Inbox size={28} />} title="صندوق وارد موحّد" description="كل المحادثات في مكان واحد — رد بشري أو إيقاف البوت لمحادثة معينة متى شئت." />
            <FeatureCard icon={<Database size={28} />} title="كتالوج وطلبات" description="إدارة منتجات بألوان ومقاسات وصور، استيراد Excel، وطلبات من البوت أو يدوياً." />
            <FeatureCard icon={<UserCircle size={28} />} title="CRM للعملاء" description="ملاحظات، حالات، وتاريخ تفاعل لكل عميل — بدون خلط بيانات بين التجار." />
            <FeatureCard icon={<BarChart2 size={28} />} title="تحليلات وتقارير" description="أداء المبيعات والمحادثات والمنتجات بمؤشرات واضحة في لوحة واحدة." />
            <FeatureCard icon={<Image size={28} />} title="نشر محتوى + ستوديو صور" description="جدولة منشورات فيسبوك وإنستغرام، وتوليد صور تسويقية بالذكاء الاصطناعي." />
            <FeatureCard icon={<Shield size={28} />} title="أمان SaaS" description="عزل كامل بين التجار، بيانات منفصلة لكل متجر، وتحكّم بشري عند الحاجة." />
            <FeatureCard icon={<Cpu size={28} />} title="تذكير السلة المتروكة" description="متابعة من بدأ الطلب ولم يُكمل عبر قنوات الدردشة لاسترجاع البيع." />
          </div>
        </div>
      </section>

      {/* Active channels */}
      <section id="integrations" className="py-24 relative z-10 bg-brand-50/40">
        <div className="container mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-3">
              القنوات الجاهزة الآن
            </h2>
            <p className="text-slate-500 max-w-2xl mx-auto">
              اربط واتساب وفيسبوك وإنستغرام وتيليجرام وابدأ البيع — ويمكنك تجربة البوت داخل اللوحة قبل الربط.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
            {[
              { icon: <Facebook size={22} />, title: 'فيسبوك', desc: 'ماسنجر + رد على التعليقات وتحويل المهتمين لرسائل خاصة', note: 'جاهز للربط' },
              { icon: <Instagram size={22} />, title: 'إنستغرام', desc: 'رسائل مباشرة وتعليقات مع أتمتة ذكية للمنشورات', note: 'جاهز للربط' },
              { icon: <WhatsAppMark />, title: 'واتساب', desc: 'امسح رمز QR من هاتف المتجر لربط الرقم والرد تلقائياً على الزبائن', note: 'جاهز للربط' },
              { icon: <Send size={22} />, title: 'تيليجرام', desc: 'بوت مبيعات على تيليجرام مع كتالوجك وسياسات متجرك', note: 'جاهز للربط' },
            ].map((item) => (
              <div
                key={item.title}
                className="group bg-white border border-brand-100 rounded-2xl p-6 hover:border-brand-300 hover:shadow-lg hover:shadow-brand/10 transition-all duration-300 hover:-translate-y-1"
              >
                <div className="w-11 h-11 bg-brand-50 text-brand rounded-xl flex items-center justify-center mb-4 group-hover:bg-brand group-hover:text-white transition-colors">
                  {item.icon}
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{item.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed mb-4">{item.desc}</p>
                <div className="flex items-center gap-1.5 text-brand text-sm font-medium">
                  <CheckCircle size={14} />
                  <span>{item.note}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Case studies */}
      <section id="case-studies" className="py-24 relative z-10 bg-white">
        <div className="container mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-3">قصص نجاح عملائنا</h2>
            <p className="text-slate-500 max-w-2xl mx-auto">كيف حوّل التجار تعليقات ورسائل السوشيال إلى طلبات فعلية</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            <CaseStudyCard storeName="متجر الأزياء الراقية" industry="أزياء" metric="+40%" metricLabel="زيادة في المبيعات" description="الرد الفوري على تعليقات المنشورات وتحويلها لرسائل ماسنجر رفع معدل إتمام الطلب." improvement="من ساعات انتظار إلى رد خلال ثوانٍ" />
            <CaseStudyCard storeName="متجر الإلكترونيات" industry="إلكترونيات" metric="+65%" metricLabel="استفسارات مُجابة آلياً" description="البوت أجاب عن الأسعار والتوفر عبر واتساب وإنستغرام وفيسبوك، والصندوق الوارد للتدخل عند الحاجة." improvement="توفير نحو 20 ساعة عمل أسبوعياً" />
            <CaseStudyCard storeName="متجر العطور" industry="عطور ومستحضرات" metric="+85%" metricLabel="رضا العملاء" description="ردود دقيقة من الكتالوج على تيليجرام والرسائل الخاصة رفعت تقييم التجربة بشكل ملحوظ." improvement="رد فوري على أغلب الاستفسارات" />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 relative z-10 bg-slate-50">
        <div className="container mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-3">باقات تناسب مرحلتك</h2>
            <p className="text-slate-500">من رد التعليقات فقط إلى بوت مبيعات على واتساب وفيسبوك وإنستغرام وتيليجرام — مع تجربة 7 أيام.</p>
          </div>

          {isLoadingPlans ? (
            <div className="flex justify-center items-center py-20">
              <Loader2 className="animate-spin text-brand" size={40} />
            </div>
          ) : plans.length > 0 ? (
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 max-w-7xl mx-auto">
              {plans.map((plan) => {
                const displayProps = getPlanDisplayProps(plan.planKey);
                const isPopular = !!displayProps.popular;
                const periodLabel = plan.billingPeriod === 'yearly' ? 'سنوياً' : 'شهرياً';
                return (
                  <div
                    key={plan.planKey}
                    className={`relative rounded-2xl p-8 transition-all bg-white border ${
                      isPopular
                        ? 'border-brand shadow-xl shadow-brand/15 md:-translate-y-3'
                        : 'border-slate-200 hover:border-brand-200'
                    }`}
                  >
                    {isPopular && (
                      <div className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 bg-brand text-white px-4 py-1 rounded-lg text-xs font-bold shadow-md shadow-brand/30">
                        الأكثر طلباً
                      </div>
                    )}
                    <h3 className="text-xl font-bold mb-2 text-slate-900">{plan.name}</h3>
                    <div className="flex items-baseline gap-1 mb-5">
                      <span className={`font-extrabold text-slate-900 ${isPopular ? 'text-5xl' : 'text-4xl'}`}>{plan.price}$</span>
                      <span className="text-slate-400">/ {periodLabel}</span>
                    </div>
                    <p className="text-sm mb-7 text-slate-500">
                      {plan.description || ''}
                    </p>
                    <button
                      onClick={onNavigateToSignup}
                      className={`w-full py-3 rounded-xl font-bold transition-colors mb-7 ${
                        isPopular
                          ? 'bg-brand text-white hover:bg-brand-600 shadow-lg shadow-brand/25'
                          : 'border border-slate-200 text-slate-800 hover:border-brand hover:text-brand'
                      }`}
                    >
                      {plan.planKey === 'yearly' ? 'اشترك سنوياً' : isPopular ? 'جرب مجاناً' : 'ابدأ الآن'}
                    </button>
                    <ul className="space-y-3 text-sm text-slate-600">
                      {plan.features.map((feature, idx) => (
                        <li key={idx} className="flex gap-2.5">
                          <CheckCircle size={16} className="text-brand shrink-0 mt-0.5" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-20">
              <p className="text-slate-400">لا توجد باقات متاحة حالياً</p>
            </div>
          )}
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-24 relative z-10 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-white to-brand-50/60" />
        <div className="container mx-auto px-6 relative z-10">
          <div className="max-w-4xl mx-auto bg-white border border-brand-100 rounded-3xl p-8 md:p-12 shadow-xl shadow-brand/10">
            <div className="grid md:grid-cols-2 gap-12">
              <div>
                <h2 className="text-3xl font-extrabold text-slate-900 mb-4">تواصل معنا</h2>
                <p className="text-slate-500 mb-8">هل لديك استفسار؟ فريقنا جاهز للرد عليك في أي وقت.</p>
                <div className="space-y-5">
                  <div className="flex items-center gap-4 text-slate-700">
                    <div className="w-12 h-12 bg-brand-50 rounded-xl flex items-center justify-center text-brand">
                      <Mail size={22} />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">البريد الإلكتروني</p>
                      <p className="font-semibold">support@xo-bot.com</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-slate-700">
                    <div className="w-12 h-12 bg-brand-50 rounded-xl flex items-center justify-center text-brand">
                      <MessageCircle size={22} />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">الدعم المباشر</p>
                      <p className="font-semibold">متاح 24/7 عبر الدردشة</p>
                    </div>
                  </div>
                </div>
              </div>

              <form className="space-y-4" onSubmit={handleContactSubmit}>
                {contactError && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">{contactError}</div>
                )}
                {contactSuccess && (
                  <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-700 text-sm">
                    تم إرسال رسالتك بنجاح! سنتواصل معك قريباً.
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">الاسم الكامل <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={contactForm.name}
                    onChange={(e) => e.target.value.length <= 100 && setContactForm({ ...contactForm, name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none transition"
                    placeholder="محمد أحمد"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">البريد الإلكتروني <span className="text-red-500">*</span></label>
                  <input
                    type="email"
                    required
                    maxLength={255}
                    value={contactForm.email}
                    onChange={(e) => e.target.value.length <= 255 && setContactForm({ ...contactForm, email: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none transition"
                    placeholder="name@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">الرسالة <span className="text-red-500">*</span></label>
                  <textarea
                    rows={4}
                    required
                    maxLength={1000}
                    value={contactForm.message}
                    onChange={(e) => e.target.value.length <= 1000 && setContactForm({ ...contactForm, message: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none transition"
                    placeholder="كيف يمكننا مساعدتك؟"
                  />
                  <p className="text-xs text-slate-400 mt-1">{contactForm.message.length}/1000</p>
                </div>
                <button type="submit" className="w-full py-3.5 bg-brand hover:bg-brand-600 text-white rounded-xl font-bold transition-colors shadow-lg shadow-brand/25">
                  إرسال الرسالة
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 relative z-10 bg-white">
        <div className="container mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-3">الأسئلة الشائعة</h2>
            <p className="text-slate-500">إجابات سريعة على التساؤلات الأكثر شيوعاً</p>
          </div>
          <div className="max-w-3xl mx-auto space-y-3">
            {LANDING_FAQ.map((item) => (
              <FaqItem key={item.question} question={item.question} answer={item.answer} />
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 bg-slate-900 text-white pt-16 pb-8">
        <div className="container mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-12 mb-12 border-b border-slate-800 pb-12">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <BrandLogo variant="mark" className="h-9 w-9 object-contain" decorative />
                <span className="text-lg font-bold">
                  Xo <span className="text-brand">Bot</span>
                </span>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed">
                بوت مبيعات عربي لمتاجر السوشيال ميديا — واتساب، فيسبوك، إنستغرام، وتيليجرام في لوحة واحدة.
              </p>
            </div>

            <div className="col-span-1 md:col-span-2 flex justify-around gap-8">
              <div>
                <h4 className="font-bold mb-5">روابط هامة</h4>
                <ul className="space-y-3 text-sm text-slate-400">
                  <li><button onClick={() => scrollToSection('home')} className="hover:text-brand transition-colors">الرئيسية</button></li>
                  <li><button onClick={() => scrollToSection('features')} className="hover:text-brand transition-colors">المميزات</button></li>
                  <li><button onClick={() => scrollToSection('pricing')} className="hover:text-brand transition-colors">الأسعار</button></li>
                  <li><a href="/about" className="hover:text-brand transition-colors">عن Xo Bot</a></li>
                  <li><a href="/whatsapp-bot" className="hover:text-brand transition-colors">بوت واتساب</a></li>
                  <li><a href="/storify" className="hover:text-brand transition-colors">شراكة ستوريفاي</a></li>
                </ul>
              </div>
              <div>
                <h4 className="font-bold mb-5">قانوني</h4>
                <ul className="space-y-3 text-sm text-slate-400">
                  <li>
                    <a href="/privacy-policy" className="hover:text-brand transition-colors">
                      سياسة الخصوصية
                    </a>
                  </li>
                  <li>
                    <a href="/terms-of-service" className="hover:text-brand transition-colors">
                      الشروط والأحكام
                    </a>
                  </li>
                </ul>
              </div>
              {cmsFooterPages.length > 0 && (
                <div>
                  <h4 className="font-bold mb-5">صفحات</h4>
                  <ul className="space-y-3 text-sm text-slate-400">
                    {cmsFooterPages.map((p) => (
                      <li key={p.slug}>
                        {onNavigateToPage ? (
                          <button type="button" onClick={() => onNavigateToPage(p.slug)} className="hover:text-brand transition-colors text-right">{p.title}</button>
                        ) : (
                          <a href={`/${p.slug}`} className="hover:text-brand transition-colors">{p.title}</a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div>
              <h4 className="font-bold mb-5">كن على تواصل</h4>
              <div className="flex gap-3">
                <a href="#" className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 hover:bg-brand hover:text-white transition-all">
                  <span className="sr-only">Facebook</span>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
                </a>
                <a href="#" className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 hover:bg-brand hover:text-white transition-all">
                  <span className="sr-only">Twitter</span>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" /></svg>
                </a>
              </div>
            </div>
          </div>
          <div className="text-center text-slate-500 text-sm">
            © {new Date().getFullYear()} Xo Bot. جميع الحقوق محفوظة.
          </div>
        </div>
        <LandingChatBot />
      </footer>
    </div>
  );
};

const WhatsAppMark = () => (
  <svg className="w-[22px] h-[22px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413" />
  </svg>
);

const FeatureCard = ({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) => (
  <div className="p-7 rounded-2xl bg-white border border-slate-100 hover:border-brand-200 transition-all duration-300 hover:-translate-y-1 group hover:shadow-xl hover:shadow-brand/10 relative overflow-hidden">
    <div className="mb-5 p-3.5 rounded-xl w-fit bg-brand-50 text-brand group-hover:bg-brand group-hover:text-white transition-colors relative z-10">
      {icon}
    </div>
    <div className="absolute top-0 left-0 w-28 h-28 bg-brand-100 blur-[50px] opacity-0 group-hover:opacity-70 transition-opacity duration-500 rounded-full -mr-8 -mt-8 pointer-events-none" />
    <h3 className="text-lg font-bold mb-2 text-slate-900 relative z-10">{title}</h3>
    <p className="text-slate-500 leading-relaxed text-sm relative z-10">{description}</p>
  </div>
);

const CaseStudyCard = ({
  storeName, industry, metric, metricLabel, description, improvement
}: {
  storeName: string; industry: string; metric: string; metricLabel: string; description: string; improvement: string;
}) => (
  <div className="p-7 rounded-2xl bg-white border border-slate-100 hover:border-brand-200 transition-all duration-300 hover:-translate-y-1 group hover:shadow-xl hover:shadow-brand/10">
    <div className="flex items-start justify-between mb-4 gap-3">
      <div>
        <h3 className="text-lg font-bold text-slate-900 mb-0.5">{storeName}</h3>
        <p className="text-sm text-slate-400">{industry}</p>
      </div>
      <div className="text-left shrink-0">
        <div className="text-3xl font-extrabold text-brand">{metric}</div>
        <div className="text-xs text-slate-400">{metricLabel}</div>
      </div>
    </div>
    <p className="text-slate-600 mb-4 leading-relaxed text-sm">{description}</p>
    <div className="flex items-center gap-2 text-sm text-brand font-medium">
      <TrendingUp size={15} />
      <span>{improvement}</span>
    </div>
  </div>
);

const FaqItem = ({ question, answer }: { question: string; answer: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className={`border rounded-2xl bg-white transition-all duration-300 ${isOpen ? 'border-brand shadow-md shadow-brand/10' : 'border-slate-100'}`}>
      <button onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between p-5 text-right focus:outline-none gap-4">
        <span className={`font-bold text-base transition-colors ${isOpen ? 'text-brand' : 'text-slate-900'}`}>{question}</span>
        {isOpen ? <Minus size={18} className="text-brand shrink-0" /> : <Plus size={18} className="text-slate-400 shrink-0" />}
      </button>
      <div className={`grid transition-all duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="px-5 pb-5 text-slate-500 leading-relaxed border-t border-slate-100 pt-3 text-sm">
            {answer}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;

if (typeof document !== 'undefined') {
  const styleId = 'landing-light-animations';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes float {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-14px); }
      }
      @keyframes float-delayed {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-10px); }
      }
      .animate-float { animation: float 3.5s ease-in-out infinite; }
      .animate-float-delayed { animation: float-delayed 3.5s ease-in-out infinite; animation-delay: 1.2s; }
    `;
    document.head.appendChild(style);
  }
}
