import React, { useMemo, useState, useEffect } from 'react';
import {
  Package,
  MessageSquare,
  Link2,
  Settings,
  Truck,
  Sparkles,
  Inbox,
  ArrowRight,
  CheckCircle2,
  Store,
} from 'lucide-react';
import { AppView } from '../types';
import { useAuth } from '../contexts/AuthContext';

interface OnboardingWizardProps {
  onNavigate: (view: AppView) => void;
  onComplete: () => void;
}

type OnboardingStep = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  tips: string[];
  icon: React.ComponentType<{ size?: number; className?: string }>;
  targetView: AppView | null;
  buttonText: string | null;
  accent: string;
};

const storageKeyFor = (userId?: string | null) =>
  userId ? `xobot_onboarding_v2_${userId}` : 'xobot_onboarding_v2';

const STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'مرحباً بك في Xo Bot',
    subtitle: 'لنجهّز متجرك للبيع الآلي',
    description:
      'في دقائق قليلة ستُعرّف البوت على متجرك ومنتجاتك وسياساتك، ثم تختبره وتربط قنواتك.',
    tips: [
      'كل خطوة مهمة لدقة الردود ومنع اختراع أسعار أو سياسات',
      'يمكنك تخطي المعالج الآن والعودة لاحقاً من الإعدادات',
      'بيانات كل تاجر معزولة تماماً عن بقية المتاجر',
    ],
    icon: Sparkles,
    targetView: null,
    buttonText: null,
    accent: 'bg-brand-50 text-brand',
  },
  {
    id: 'store',
    title: 'هوية المتجر',
    subtitle: 'اسم المتجر والعملة',
    description:
      'افتح الإعدادات وحدّد اسم متجرك الظاهر للعملاء، واختر العملة التي سيعرض بها البوت الأسعار.',
    tips: [
      'اسم المتجر يظهر في ردود البوت والتعريف بالمتجر',
      'العملة يجب أن تطابق أسعار منتجاتك (مثال: ل.س أو $)',
      'بعد الحفظ يعتمد البوت هذه القيم فوراً في المحادثات',
    ],
    icon: Store,
    targetView: AppView.SETTINGS,
    buttonText: 'فتح الإعدادات — هوية المتجر',
    accent: 'bg-amber-50 text-amber-700',
  },
  {
    id: 'policies',
    title: 'سياسات الشحن والدفع',
    subtitle: 'معلومات ضرورية لإجابات دقيقة',
    description:
      'املأ سياسات الشحن ومدة التوصيل وطرق الدفع وسياسة الإرجاع. فعّل «الرد الذكي باستخدام السياسات» حتى يعتمد البوت عليها.',
    tips: [
      'سياسة الشحن: التكلفة، المناطق المدعومة، والقيود',
      'مدة التوصيل: مثال «3–5 أيام عمل داخل المدينة»',
      'طرق الدفع: عند الاستلام، تحويل، بطاقة…',
      'سياسة الإرجاع: المدة والشروط بوضوح',
    ],
    icon: Truck,
    targetView: AppView.SETTINGS,
    buttonText: 'تعبئة سياسات المتجر',
    accent: 'bg-sky-50 text-sky-700',
  },
  {
    id: 'ai-notes',
    title: 'تعليمات الذكاء الاصطناعي',
    subtitle: 'اللهجة، الشخصية، والملاحظات',
    description:
      'اختر شخصية البوت (ودود، رسمي، مبيعات…) واكتب ملاحظات لهجتكم وأي قواعد خاصة (ما يُقال / ما لا يُقال).',
    tips: [
      'حدد اللهجة: خليجي، مصري، شامي، فصحى مبسّطة…',
      'أضف ملاحظات مثل: لا تخترع خصومات، اطلب التأكيد قبل الطلب',
      'رسالة الترحيب تظهر في بداية المحادثة عند الحاجة',
      'احفظ الإعدادات قبل الانتقال للخطوة التالية',
    ],
    icon: Settings,
    targetView: AppView.SETTINGS,
    buttonText: 'ضبط شخصية البوت والملاحظات',
    accent: 'bg-violet-50 text-violet-700',
  },
  {
    id: 'products',
    title: 'أضف منتجاتك',
    subtitle: 'الكتالوج هو مصدر حقيقة البوت',
    description:
      'أضف منتجاً واحداً على الأقل مع السعر والوصف والصور والمقاسات/الألوان إن وجدت. يمكنك الرفع عبر Excel لاحقاً.',
    tips: [
      'بدون منتجات لن يستطيع البوت البيع أو الإجابة بدقة',
      'استخدم «اكتب الوصف تلقائياً» لتسريع الإدخال',
      'حدّث المخزون والأسعار باستمرار — البوت يعتمد على الكتالوج',
    ],
    icon: Package,
    targetView: AppView.PRODUCTS,
    buttonText: 'إضافة منتج الآن',
    accent: 'bg-brand-50 text-brand',
  },
  {
    id: 'test-bot',
    title: 'جرّب البوت',
    subtitle: 'اختبر قبل الربط الحقيقي',
    description:
      'من «تجربة البوت» اسأل عن السعر والتوفر والشحن وأكمل طلباً تجريبياً لتتأكد من جودة الردود.',
    tips: [
      'جرّب أسئلة بلهجتكم الحقيقية',
      'تحقق أن العملة والسياسات تظهر بشكل صحيح',
      'إذا أخطأ البوت: راجع السياسات أو وصف المنتج ثم أعد الاختبار',
    ],
    icon: MessageSquare,
    targetView: AppView.CHAT_TEST,
    buttonText: 'فتح تجربة البوت',
    accent: 'bg-orange-50 text-brand',
  },
  {
    id: 'channels',
    title: 'اربط قنواتك',
    subtitle: 'واتساب · فيسبوك · إنستغرام · تيليجرام',
    description:
      'من صفحة الربط والتكامل اربط القنوات التي تبيع عليها. بعد الربط يبدأ البوت بالرد على الرسائل والتعليقات حسب باقتك.',
    tips: [
      'واتساب عبر مسح رمز QR من هاتف المتجر',
      'فيسبوك ماسنجر + تعليقات المنشورات',
      'إنستغرام الرسائل والتعليقات',
      'تيليجرام كبوت مبيعات مستقل',
      'راقب المحادثات من صندوق الوارد وتدخل يدوياً عند الحاجة',
    ],
    icon: Link2,
    targetView: AppView.INTEGRATIONS,
    buttonText: 'فتح الربط والتكامل',
    accent: 'bg-emerald-50 text-emerald-700',
  },
  {
    id: 'inbox',
    title: 'صندوق الوارد جاهز',
    subtitle: 'أنت تتحكّم دائماً',
    description:
      'كل محادثات القنوات تظهر في صندوق وارد موحّد. يمكنك إيقاف البوت لمحادثة معيّنة والرد بنفسك في أي لحظة.',
    tips: [
      'فعّل إشعارات الطلبات لتصلك فوراً',
      'من إدارة التعليقات اربط المنشورات بالمنتجات لتحويل التعليق إلى بيع',
      'بعد الانتهاء أنت جاهز لاستقبال عملاء حقيقيين',
    ],
    icon: Inbox,
    targetView: AppView.INBOX,
    buttonText: 'فتح صندوق الوارد',
    accent: 'bg-slate-100 text-slate-700',
  },
];

const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onNavigate, onComplete }) => {
  const { user } = useAuth();
  const storageKey = useMemo(() => storageKeyFor(user?.id), [user?.id]);
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    try {
      const done = localStorage.getItem(storageKey);
      if (!done) {
        setIsVisible(true);
        setCurrentStep(0);
      }
    } catch {
      setIsVisible(true);
    }
  }, [storageKey]);

  const persistComplete = () => {
    try {
      localStorage.setItem(storageKey, 'true');
    } catch {
      // ignore quota / private mode
    }
  };

  const handleClose = () => {
    persistComplete();
    setIsVisible(false);
    onComplete();
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
      return;
    }
    handleClose();
  };

  const handleAction = () => {
    const step = STEPS[currentStep];
    if (step.targetView) {
      onNavigate(step.targetView);
    }
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  if (!isVisible) return null;

  const step = STEPS[currentStep];
  const CurrentIcon = step.icon;
  const progress = ((currentStep + 1) / STEPS.length) * 100;
  const isLast = currentStep === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-sm animate-fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="bg-white rounded-3xl w-full max-w-xl shadow-2xl shadow-brand/15 border border-brand-100 overflow-hidden flex flex-col max-h-[92vh]"
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-4 left-4 z-10 text-slate-400 hover:text-slate-700 transition-colors text-sm font-semibold px-2 py-1"
        >
          تخطي
        </button>

        <div className="h-2 bg-brand-50 w-full shrink-0">
          <div
            className="h-full bg-brand transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="overflow-y-auto custom-scrollbar flex-1">
          <div className="pt-9 pb-3 px-7 sm:px-9 text-center">
            <p className="text-xs font-bold text-brand mb-2 tracking-wide">
              إعداد الحساب · {currentStep + 1} / {STEPS.length}
            </p>
            <h2 id="onboarding-title" className="text-2xl font-extrabold text-slate-900 mb-1">
              {step.title}
            </h2>
            <p className="text-slate-500 text-sm font-medium">{step.subtitle}</p>
          </div>

          <div className="px-7 sm:px-9 pb-6 flex flex-col items-center text-center">
            <div
              className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-5 ${step.accent}`}
            >
              <CurrentIcon size={32} />
            </div>

            <p className="text-slate-600 leading-relaxed mb-5 max-w-md text-sm sm:text-[15px]">
              {step.description}
            </p>

            <ul className="w-full max-w-md text-right space-y-2.5 mb-7">
              {step.tips.map((tip) => (
                <li
                  key={tip}
                  className="flex items-start gap-2.5 bg-brand-50/60 border border-brand-100 rounded-xl px-3.5 py-2.5 text-sm text-slate-700"
                >
                  <CheckCircle2 size={16} className="text-brand shrink-0 mt-0.5" />
                  <span className="leading-snug">{tip}</span>
                </li>
              ))}
            </ul>

            {step.buttonText && step.targetView && (
              <button
                type="button"
                onClick={handleAction}
                className="w-full py-3.5 bg-brand text-white rounded-xl font-bold hover:bg-brand-600 shadow-lg shadow-brand/25 transition-all mb-3 flex items-center justify-center gap-2"
              >
                <span>{step.buttonText}</span>
                <ArrowRight size={18} className="rotate-180" />
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
                step.buttonText
                  ? 'text-brand hover:bg-brand-50'
                  : 'bg-brand text-white hover:bg-brand-600 shadow-lg shadow-brand/25'
              }`}
            >
              {isLast ? 'إتمام الإعداد والبدء' : step.buttonText ? 'تم — الخطوة التالية' : 'ابدأ الإعداد'}
            </button>
          </div>
        </div>

        <div className="p-4 bg-brand-50/60 border-t border-brand-100 flex justify-center gap-1.5 flex-wrap">
          {STEPS.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              aria-label={`الخطوة ${idx + 1}`}
              onClick={() => setCurrentStep(idx)}
              className={`h-2.5 rounded-full transition-all duration-300 ${
                idx === currentStep
                  ? 'bg-brand w-7'
                  : idx < currentStep
                    ? 'bg-emerald-500 w-2.5'
                    : 'bg-slate-200 w-2.5'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default OnboardingWizard;
