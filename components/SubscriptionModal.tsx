import React, { useState, useEffect } from 'react';
import {
  X, CheckCircle, Zap, Star, Briefcase, Loader2,
  Copy, Upload, ArrowRight, Check
} from 'lucide-react';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { PaymentMethodLogo, paymentMethodHint } from './PaymentMethodLogo';

interface SubscriptionModalProps {
  onClose: () => void;
}

interface PlanFromAPI {
  name: string;
  planKey: string;
  price: number;
  features: string[];
  billingPeriod?: 'monthly' | 'yearly';
  description?: string;
}

interface DisplayPlan {
  name: string;
  planKey: string;
  priceLabel: string;
  priceValue: number;
  period: string;
  description: string;
  icon: typeof Zap;
  color: string;
  popular?: boolean;
  features: string[];
}

interface OfflinePaymentMethod {
  id: string;
  name: string;
  walletAddress: string;
  qrImageUrl: string;
  network?: string;
  instructions?: string;
}

type Step = 'plans' | 'payment' | 'success';

const SubscriptionModal: React.FC<SubscriptionModalProps> = ({ onClose }) => {
  const [plans, setPlans] = useState<DisplayPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [step, setStep] = useState<Step>('plans');
  const [selectedPlan, setSelectedPlan] = useState<DisplayPlan | null>(null);
  const [methods, setMethods] = useState<OfflinePaymentMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<OfflinePaymentMethod | null>(null);
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const getPlanDisplayProps = (planKey: string): { icon: typeof Zap; description: string; popular?: boolean } => {
    const props: { [key: string]: { icon: typeof Zap; description: string; popular?: boolean } } = {
      comments: {
        icon: Zap,
        description: 'رد آلي على التعليقات فقط — بدون بوت مبيعات.'
      },
      single: {
        icon: Star,
        description: 'بوت مبيعات على قناة واحدة من اختيارك.',
        popular: true
      },
      social: {
        icon: Briefcase,
        description: 'فيسبوك وإنستغرام وواتساب لبوت المبيعات.'
      },
      yearly: {
        icon: Star,
        description: 'باقة سنوية شاملة للقنوات الرئيسية.'
      }
    };
    return props[planKey] || { icon: Zap, description: '' };
  };

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        setIsLoading(true);
        const response = await apiService.getPublicSubscriptionPlans();

        if (response && typeof response === 'object' && 'plans' in response && Array.isArray(response.plans)) {
          const displayPlans: DisplayPlan[] = response.plans.map((plan: PlanFromAPI) => {
            const displayProps = getPlanDisplayProps(plan.planKey);
            const isYearly = plan.billingPeriod === 'yearly' || plan.planKey === 'yearly';
            return {
              name: plan.name,
              planKey: plan.planKey,
              priceLabel: `${plan.price}$`,
              priceValue: plan.price,
              period: isYearly ? 'سنوياً' : 'شهرياً',
              description: plan.description || displayProps.description,
              icon: displayProps.icon,
              color: plan.planKey === 'comments' ? 'blue' : plan.planKey === 'single' ? 'indigo' : plan.planKey === 'social' ? 'purple' : 'amber',
              popular: displayProps.popular,
              features: plan.features
            };
          });
          setPlans(displayPlans);
        } else {
          throw new Error('Unexpected response structure');
        }
      } catch (err: any) {
        logger.error('Failed to fetch subscription plans in modal:', err);
        setError('تعذر تحميل الخطط. حاول مرة أخرى.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchPlans();
  }, []);

  const handleSelectPlan = async (plan: DisplayPlan) => {
    setSelectedPlan(plan);
    setError(null);
    setProofFile(null);
    setProofPreview(null);
    setSelectedMethod(null);
    setLoadingPayment(true);
    setStep('payment');

    try {
      const response = await apiService.getBillingPaymentMethods();
      const available = response.methods || [];
      setMethods(available);
      if (available.length === 0) {
        setError('لا توجد وسائل دفع مُعدّة حالياً. يرجى التواصل مع الدعم.');
      } else if (available.length === 1) {
        setSelectedMethod(available[0]);
      }
    } catch (err: any) {
      logger.error('Failed to load payment methods:', err);
      setError(err.message || 'تعذر تحميل بيانات الدفع');
      setMethods([]);
    } finally {
      setLoadingPayment(false);
    }
  };

  const handleProofChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setError('يُسمح بالصور وملفات PDF فقط');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('حجم الملف يجب أن لا يتجاوز 10 ميجابايت');
      return;
    }

    setError(null);
    setProofFile(file);
    if (file.type.startsWith('image/')) {
      setProofPreview(URL.createObjectURL(file));
    } else {
      setProofPreview(null);
    }
  };

  const handleCopyWallet = async () => {
    if (!selectedMethod?.walletAddress) return;
    try {
      await navigator.clipboard.writeText(selectedMethod.walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('تعذر نسخ العنوان');
    }
  };

  const handleSubmitPayment = async () => {
    if (!selectedPlan || !selectedMethod || !proofFile) {
      setError('يرجى اختيار وسيلة الدفع ورفع إثبات الدفع');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const uploadResult = await apiService.uploadPaymentProof(proofFile);
      const proofUrl = uploadResult.file.path || uploadResult.file.url;
      await apiService.submitSubscriptionPaymentRequest(
        selectedPlan.planKey,
        proofUrl,
        selectedMethod.id
      );
      setStep('success');
    } catch (err: any) {
      logger.error('Failed to submit payment request:', err);
      setError(err.message || 'فشل إرسال طلب الدفع');
    } finally {
      setSubmitting(false);
    }
  };

  const headerTitle =
    step === 'plans' ? 'اختر خطة الاشتراك' :
    step === 'payment' ? 'اختر وسيلة الدفع' :
    'تم إرسال الطلب';

  const headerSubtitle =
    step === 'plans' ? 'اختر الخطة المناسبة ثم أكمل التحويل.' :
    step === 'payment' ? `خطة ${selectedPlan?.name} — ${selectedPlan?.priceLabel} / ${selectedPlan?.period}` :
    'بانتظار تأكيد الدفع من الإدارة';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in overflow-y-auto">
      <div className="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-5xl shadow-2xl relative border border-gray-100 dark:border-gray-700 flex flex-col max-h-[90vh]">

        <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-900 z-10 rounded-t-3xl">
          <div className="flex items-center gap-3">
            {step === 'payment' && (
              <button
                onClick={() => {
                  setStep('plans');
                  setError(null);
                }}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-500"
                title="رجوع"
              >
                <ArrowRight size={20} />
              </button>
            )}
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{headerTitle}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{headerSubtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors text-gray-500 dark:text-gray-400"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar">
          {error && step !== 'success' && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm border border-red-100 dark:border-red-800">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center items-center py-20">
              <Loader2 className="animate-spin text-brand" size={40} />
            </div>
          ) : step === 'plans' ? (
            plans.length > 0 ? (
              <div className="grid md:grid-cols-3 gap-6">
                {plans.map((plan) => (
                  <div
                    key={plan.planKey}
                    className={`relative rounded-2xl p-6 border transition-all duration-300 hover:-translate-y-1 ${
                      plan.popular
                        ? 'bg-brand-50/50 dark:bg-brand-900/10 border-brand-200 dark:border-brand-800 ring-1 ring-brand shadow-xl shadow-brand/10'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-brand-200 dark:hover:border-gray-600'
                    }`}
                  >
                    {plan.popular && (
                      <div className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 bg-brand text-white px-3 py-1 rounded-full text-xs font-bold shadow-sm">
                        الأكثر طلباً
                      </div>
                    )}

                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
                      plan.popular ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    }`}>
                      <plan.icon size={24} />
                    </div>

                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{plan.name}</h3>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mb-4 min-h-[40px]">{plan.description}</p>

                    <div className="flex items-baseline gap-1 mb-6">
                      <span className="text-4xl font-bold text-gray-900 dark:text-white">{plan.priceLabel}</span>
                      <span className="text-gray-500 dark:text-gray-400 text-sm">/ {plan.period}</span>
                    </div>

                    <button
                      onClick={() => handleSelectPlan(plan)}
                      className={`w-full py-3 rounded-xl font-bold text-sm transition-colors mb-6 ${
                        plan.popular
                          ? 'bg-brand hover:bg-brand-700 text-white shadow-lg shadow-brand/25 dark:shadow-none'
                          : 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100'
                      }`}
                    >
                      اشترك الآن
                    </button>

                    <div className="space-y-3">
                      {plan.features.map((feature, idx) => (
                        <div key={idx} className="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-300">
                          <CheckCircle size={16} className={`mt-0.5 shrink-0 ${plan.popular ? 'text-brand dark:text-brand' : 'text-gray-400'}`} />
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-20">
                <p className="text-gray-500 dark:text-gray-400">لا توجد باقات متاحة حالياً</p>
              </div>
            )
          ) : step === 'payment' ? (
            loadingPayment ? (
              <div className="flex justify-center items-center py-20">
                <Loader2 className="animate-spin text-brand" size={40} />
              </div>
            ) : methods.length > 0 ? (
              <div className="max-w-xl mx-auto space-y-6">
                <div className={`grid gap-3 ${methods.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                  {methods.map((method) => {
                    const selected = selectedMethod?.id === method.id;
                    return (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => {
                          setSelectedMethod(method);
                          setProofFile(null);
                          setProofPreview(null);
                          setError(null);
                        }}
                        className={`relative flex items-center gap-4 p-4 rounded-2xl border text-right transition-all ${
                          selected
                            ? 'border-brand bg-brand-50 dark:bg-brand-900/25 ring-2 ring-brand/30 shadow-sm'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 hover:border-brand-300 hover:shadow-sm'
                        }`}
                      >
                        <PaymentMethodLogo methodId={method.id} className="w-14 h-14 shrink-0 rounded-[14px] shadow-sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-base font-bold text-gray-900 dark:text-white">
                            {method.name}
                          </span>
                          <span className="block text-xs font-medium text-gray-500 dark:text-gray-400 mt-0.5">
                            {paymentMethodHint(method.id, method.network)}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                            selected
                              ? 'border-brand bg-brand text-white'
                              : 'border-gray-300 dark:border-gray-600'
                          }`}
                          aria-hidden
                        >
                          {selected ? <Check size={14} strokeWidth={3} /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {selectedMethod ? (
                  <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-6 bg-gray-50 dark:bg-gray-800/50 space-y-5">
                    <div className="flex items-center gap-3">
                      <PaymentMethodLogo
                        methodId={selectedMethod.id}
                        className="w-12 h-12 shrink-0 rounded-xl shadow-sm"
                      />
                      <div>
                        <h3 className="font-bold text-gray-900 dark:text-white">{selectedMethod.name}</h3>
                        <p className="text-xs text-gray-500">
                          {selectedMethod.network
                            ? `الشبكة: ${selectedMethod.network} — حوّل ثم ارفع الإثبات`
                            : 'حوّل المبلغ ثم ارفع إثبات الدفع'}
                        </p>
                      </div>
                    </div>

                    {selectedMethod.instructions && (
                      <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                        {selectedMethod.instructions}
                      </p>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-2">عنوان المحفظة</label>
                      <div className="flex gap-2">
                        <input
                          readOnly
                          value={selectedMethod.walletAddress}
                          className="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm font-mono text-gray-900 dark:text-white"
                          dir="ltr"
                        />
                        <button
                          type="button"
                          onClick={handleCopyWallet}
                          className="px-3 py-2 rounded-xl bg-brand hover:bg-brand-700 text-white text-sm font-medium flex items-center gap-1.5"
                        >
                          <Copy size={14} />
                          {copied ? 'تم' : 'نسخ'}
                        </button>
                      </div>
                    </div>

                    {selectedMethod.qrImageUrl ? (
                      <div className="flex justify-center">
                        <img
                          src={selectedMethod.qrImageUrl}
                          alt={`QR ${selectedMethod.name}`}
                          className="w-48 h-48 object-contain rounded-2xl border border-gray-200 dark:border-gray-600 bg-white p-3"
                        />
                      </div>
                    ) : null}

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-2">إثبات الدفع (صورة أو PDF)</label>
                      <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl p-6 cursor-pointer hover:border-brand transition-colors bg-white dark:bg-gray-900">
                        <Upload size={22} className="text-gray-400" />
                        <span className="text-sm text-gray-600 dark:text-gray-300">
                          {proofFile ? proofFile.name : 'اختر ملفاً أو اسحبه هنا'}
                        </span>
                        <span className="text-xs text-gray-400">JPG, PNG, WEBP, PDF — حتى 10MB</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.pdf"
                          className="hidden"
                          onChange={handleProofChange}
                        />
                      </label>
                      {proofPreview && (
                        <img src={proofPreview} alt="معاينة الإثبات" className="mt-3 max-h-40 rounded-xl border border-gray-200 dark:border-gray-700 mx-auto" />
                      )}
                    </div>

                    <button
                      onClick={handleSubmitPayment}
                      disabled={submitting || !proofFile}
                      className="w-full py-3 rounded-xl font-bold text-sm bg-brand hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white flex items-center justify-center gap-2"
                    >
                      {submitting ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />
                          جاري الإرسال...
                        </>
                      ) : (
                        'تأكيد وإرسال طلب الدفع'
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-10 text-gray-500 text-sm">
                    اختر وسيلة الدفع للمتابعة
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-16 text-gray-500">
                وسيلة الدفع غير متاحة حالياً
              </div>
            )
          ) : (
            <div className="text-center py-16 max-w-md mx-auto space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">تم إرسال طلبك بنجاح</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                سيتم مراجعة إثبات الدفع عبر <strong>{selectedMethod?.name}</strong> وتفعيل خطة <strong>{selectedPlan?.name}</strong> بعد التأكيد من الإدارة.
              </p>
              <button
                onClick={onClose}
                className="mt-4 px-6 py-2.5 rounded-xl bg-brand hover:bg-brand-700 text-white font-bold text-sm"
              >
                حسناً
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SubscriptionModal;
