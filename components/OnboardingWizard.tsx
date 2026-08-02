
import React, { useState, useEffect } from 'react';
import { Package, MessageSquare, Link2, X, ChevronLeft, CheckCircle, ArrowRight } from 'lucide-react';
import { AppView } from '../types';

interface OnboardingWizardProps {
  onNavigate: (view: AppView) => void;
  onComplete: () => void;
}

const STORAGE_KEY = 'almusaid_onboarding_completed';

const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onNavigate, onComplete }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    // Check if onboarding was previously completed
    const isCompleted = localStorage.getItem(STORAGE_KEY);
    if (!isCompleted) {
      setIsVisible(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setIsVisible(false);
    onComplete();
  };

  const steps = [
    {
      id: 1,
      title: 'الخطوة ١: أضف أول منتج',
      description: 'ابدأ بإضافة منتج واحد على الأقل حتى يتمكن Xo Bot من التعامل معه والرد على الأسئلة بخصوصه.',
      icon: Package,
      targetView: AppView.PRODUCTS,
      buttonText: 'إضافة منتج الآن',
      color: 'bg-brand-50 text-brand'
    },
    {
      id: 2,
      title: 'الخطوة ٢: جرّب Xo Bot',
      description: 'اختبر كيف يجيب المساعد على أسئلة العملاء حول منتجاتك باستخدام الذكاء الاصطناعي.',
      icon: MessageSquare,
      targetView: AppView.CHAT_TEST,
      buttonText: 'تجربة البوت',
      color: 'bg-orange-50 text-brand'
    },
    {
      id: 3,
      title: 'الخطوة ٣: اربط منصتك',
      description: 'قم بربط متجرك أو قنوات البيع (فيسبوك/شوبيفاي) لبدء استقبال رسائل العملاء بشكل فعلي.',
      icon: Link2,
      targetView: AppView.INTEGRATIONS,
      buttonText: 'فتح صفحة التكاملات',
      color: 'bg-emerald-50 text-emerald-600'
    }
  ];

  const handleAction = () => {
    // Navigate to the specific page
    onNavigate(steps[currentStep].targetView);
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleClose();
    }
  };

  if (!isVisible) return null;

  const CurrentIcon = steps[currentStep].icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl shadow-brand/10 border border-brand-100 overflow-hidden flex flex-col relative transition-colors duration-300">
        
        {/* Close / Skip Button */}
        <button 
          onClick={handleClose}
          className="absolute top-4 left-4 text-slate-400 hover:text-slate-600 transition-colors text-sm font-medium z-10"
        >
          تخطي
        </button>

        {/* Progress Bar */}
        <div className="h-2 bg-brand-50 w-full">
          <div 
            className="h-full bg-brand transition-all duration-500 ease-out"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          ></div>
        </div>

        {/* Header */}
        <div className="pt-10 pb-4 px-8 text-center">
            <h2 className="text-2xl font-extrabold text-slate-900 mb-2">مرحباً بك في Xo Bot!</h2>
            <p className="text-slate-500 text-sm">دعنا نجهز حسابك للنجاح في 3 خطوات بسيطة.</p>
        </div>

        {/* Content */}
        <div className="p-8 pt-2 flex flex-col items-center text-center flex-1">
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 transition-colors duration-300 ${steps[currentStep].color}`}>
             <CurrentIcon size={40} />
          </div>

          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            الخطوة {currentStep + 1} من {steps.length}
          </span>
          
          <h3 className="text-xl font-bold text-slate-900 mb-3">
            {steps[currentStep].title}
          </h3>
          
          <p className="text-slate-600 mb-8 leading-relaxed max-w-sm">
            {steps[currentStep].description}
          </p>

          <button 
            onClick={handleAction}
            className="w-full py-3.5 bg-brand text-white rounded-xl font-bold hover:bg-brand-600 shadow-lg shadow-brand/25 transition-all mb-4 flex items-center justify-center gap-2"
          >
            <span>{steps[currentStep].buttonText}</span>
            <ArrowRight size={18} className="rotate-180" />
          </button>

          <button 
            onClick={handleNext}
            className="text-brand font-medium hover:underline text-sm"
          >
            {currentStep === steps.length - 1 ? 'إتمام وإنهاء' : 'تم، انتقل للخطوة التالية'}
          </button>
        </div>

        {/* Footer Dots */}
        <div className="p-6 bg-brand-50/50 flex justify-center gap-2">
           {steps.map((_, idx) => (
             <div 
               key={idx} 
               className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                 idx === currentStep ? 'bg-brand w-6' : 
                 idx < currentStep ? 'bg-emerald-500' : 'bg-slate-200'
               }`}
             ></div>
           ))}
        </div>
      </div>
    </div>
  );
};

export default OnboardingWizard;
