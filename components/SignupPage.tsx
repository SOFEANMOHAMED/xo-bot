
import React, { useState, useEffect } from 'react';
import { Mail, Lock, User, Store, ArrowRight, Tag, Eye, EyeOff, Phone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { validateUserRegistration } from '../utils/validation';
import { handleApiError } from '../utils/errorHandler';
import CountryCodeSelector from './CountryCodeSelector';
import AuthLayout from './AuthLayout';
import BrandLogo from './BrandLogo';
import {
  captureAndPersistAttribution,
  getAttributionForApi,
  buildGoogleAuthQuery,
} from '../utils/marketingAttribution';
import apiService from '../services/api';
import OtpVerificationStep from './OtpVerificationStep';
import { DEFAULT_DIAL_CODE } from '../constants/countries';
import { useVisitorCountryDialCode } from '../hooks/useVisitorCountryDialCode';

interface SignupPageProps {
  onSignupSuccess: () => void;
  onNavigateToLogin: () => void;
  onBack?: () => void;
  onNavigateToPage?: (slug: string) => void;
}

const SignupPage: React.FC<SignupPageProps> = ({ onSignupSuccess, onNavigateToLogin, onBack, onNavigateToPage }) => {
  const [formData, setFormData] = useState({
    fullName: '',
    storeName: '',
    email: '',
    password: '',
    phone: '',
    countryCode: DEFAULT_DIAL_CODE,
    referralCode: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [signupOtpEnabled, setSignupOtpEnabled] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [resendAfterSeconds, setResendAfterSeconds] = useState(90);
  const { register } = useAuth();

  const { markUserPicked: markCountryUserPicked } = useVisitorCountryDialCode((dialCode) => {
    setFormData((prev) => ({ ...prev, countryCode: dialCode }));
  });

  useEffect(() => {
    apiService.getSignupOtpConfig()
      .then((cfg) => setSignupOtpEnabled(cfg.signupOtpEnabled))
      .catch(() => setSignupOtpEnabled(false));
  }, []);

  useEffect(() => {
    const attr = captureAndPersistAttribution();
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref') || attr.ref;
    if (refCode) {
      const cleanRefCode = refCode.toUpperCase().replace(/[^A-Z0-9\-_]/g, '');
      setFormData(prev => ({ ...prev, referralCode: cleanRefCode }));
      apiService.trackAffiliateClick(cleanRefCode).catch((err) => {
        console.warn('Failed to track affiliate click:', err);
      });
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const fullPhoneNumber = formData.countryCode + formData.phone.replace(/^\+?/, '');
    const validation = validateUserRegistration({
      email: formData.email,
      password: formData.password,
      name: formData.fullName,
      phone: fullPhoneNumber
    });

    if (!validation.isValid) {
      setError(validation.errors.join('، '));
      return;
    }
    if (!acceptedTerms) {
      setError('يجب الموافقة على سياسة الخصوصية وشروط الخدمة للمتابعة');
      return;
    }

    setIsLoading(true);
    try {
      const acquisition = getAttributionForApi();
      const fullPhoneNumber = formData.countryCode + formData.phone.replace(/^\+?/, '');

      if (signupOtpEnabled) {
        const start = await apiService.registerStart({
          email: formData.email,
          password: formData.password,
          name: formData.fullName,
          storeName: formData.storeName,
          phone: fullPhoneNumber.trim(),
          referralCode: formData.referralCode.trim() || undefined,
          acquisition,
        });
        setChallengeId(start.challengeId);
        setResendAfterSeconds(start.resendAfterSeconds);
        setOtpStep(true);
        return;
      }

      await register(
        formData.email,
        formData.password,
        formData.fullName,
        formData.referralCode.trim() || undefined,
        fullPhoneNumber.trim() || undefined,
        acquisition,
        formData.storeName
      );
      onSignupSuccess();
    } catch (err: any) {
      setError(handleApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpVerify = async (code: string) => {
    setError(null);
    setIsLoading(true);
    try {
      await apiService.registerVerify(challengeId, code);
      onSignupSuccess();
    } catch (err: any) {
      setError(handleApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpResend = async () => {
    setError(null);
    try {
      const result = await apiService.registerResend(challengeId);
      setChallengeId(result.challengeId);
      setResendAfterSeconds(result.resendAfterSeconds);
    } catch (err: any) {
      setError(handleApiError(err));
    }
  };

  const fullPhoneDisplay = `${formData.countryCode}${formData.phone || ''}`;

  const handleGoogleSignup = () => {
    const apiUrl = import.meta.env.VITE_API_URL || 'https://xo-bot.com/api';
    window.location.href = `${apiUrl}/auth/google${buildGoogleAuthQuery()}`;
  };

  const inputClass =
    'w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl py-3 pr-10 pl-4 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none transition-all placeholder-slate-400';

  return (
    <AuthLayout
      onBack={onBack}
      navActions={
        <>
          <button
            type="button"
            onClick={onNavigateToLogin}
            className="text-sm font-semibold text-slate-600 hover:text-brand transition-colors hidden sm:block"
          >
            تسجيل الدخول
          </button>
          <button
            type="button"
            onClick={onNavigateToLogin}
            className="px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm hover:bg-brand-600 transition-all shadow-lg shadow-brand/30"
          >
            تسجيل الدخول
          </button>
        </>
      }
    >
      <div className="text-center mb-8 animate-fade-in-up">
        <div className="inline-flex items-center justify-center mb-4">
          <BrandLogo className="h-14 w-auto select-none" />
        </div>
        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">إنشاء حساب جديد</h2>
        <p className="text-slate-500">ابدأ رحلتك مع Xo Bot وجرب الخدمة مجاناً لمدة 7 أيام</p>
      </div>

      {error && !otpStep && (
        <div id="signup-error" className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm" role="alert" aria-live="polite">
          {error}
        </div>
      )}

      {otpStep ? (
        <OtpVerificationStep
          phoneDisplay={fullPhoneDisplay}
          challengeId={challengeId}
          resendAfterSeconds={resendAfterSeconds}
          isLoading={isLoading}
          error={error}
          onVerify={handleOtpVerify}
          onResend={handleOtpResend}
          onBack={() => {
            setOtpStep(false);
            setError(null);
          }}
          submitLabel="إنشاء الحساب"
        />
      ) : (
      <form onSubmit={handleSubmit} className="space-y-4" aria-label="نموذج التسجيل">
        <div>
          <label htmlFor="signup-fullname" className="block text-sm font-medium text-slate-600 mb-1.5">الاسم الكامل</label>
          <div className="relative">
            <User className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} aria-hidden="true" />
            <input
              id="signup-fullname"
              type="text"
              required
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value.replace(/[^a-zA-Z0-9\s]/g, '') })}
              pattern="[a-zA-Z0-9 ]+"
              autoComplete="name"
              aria-required="true"
              className={inputClass}
              placeholder="Ahmed Mohamed"
            />
          </div>
        </div>

        <div>
          <label htmlFor="signup-storename" className="block text-sm font-medium text-slate-600 mb-1.5">اسم المتجر</label>
          <div className="relative">
            <Store className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} aria-hidden="true" />
            <input
              id="signup-storename"
              type="text"
              required
              value={formData.storeName}
              onChange={(e) => setFormData({ ...formData, storeName: e.target.value.replace(/[^a-zA-Z0-9\s]/g, '') })}
              pattern="[a-zA-Z0-9 ]+"
              autoComplete="organization"
              aria-required="true"
              className={inputClass}
              placeholder="My Store"
            />
          </div>
        </div>

        <div>
          <label htmlFor="signup-email" className="block text-sm font-medium text-slate-600 mb-1.5">البريد الإلكتروني</label>
          <div className="relative">
            <Mail className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} aria-hidden="true" />
            <input
              id="signup-email"
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              inputMode="email"
              autoComplete="email"
              aria-required="true"
              aria-invalid={error ? 'true' : 'false'}
              aria-describedby={error ? 'signup-error' : undefined}
              className={inputClass}
              placeholder="name@company.com"
            />
          </div>
        </div>

        <div>
          <label htmlFor="signup-phone" className="block text-sm font-medium text-slate-600 mb-1.5">رقم الهاتف</label>
          <div className="flex gap-2">
            <CountryCodeSelector
              value={formData.countryCode}
              onChange={(dialCode) => {
                markCountryUserPicked();
                setFormData({ ...formData, countryCode: dialCode });
              }}
              className="flex-shrink-0"
            />
            <div className="relative flex-1">
              <Phone className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} aria-hidden="true" />
              <input
                id="signup-phone"
                type="tel"
                required
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/[^\d]/g, '') })}
                inputMode="tel"
                autoComplete="tel"
                aria-required="true"
                maxLength={15}
                className={inputClass}
                placeholder="501234567"
              />
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            الرقم الكامل: {formData.countryCode}{formData.phone || '...'}
          </p>
        </div>

        <div>
          <label htmlFor="signup-password" className="block text-sm font-medium text-slate-600 mb-1.5">كلمة المرور</label>
          <div className="relative">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} aria-hidden="true" />
            <input
              id="signup-password"
              type={showPassword ? 'text' : 'password'}
              required
              value={formData.password}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  password: e.target.value.replace(/[^a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/g, '')
                })
              }
              autoComplete="new-password"
              aria-required="true"
              className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl py-3 pr-10 pl-12 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none transition-all placeholder-slate-400"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              aria-pressed={showPassword}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 rounded"
            >
              {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1.5">كود الإحالة (اختياري)</label>
          <div className="relative">
            <Tag className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              type="text"
              value={formData.referralCode}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  referralCode: e.target.value.replace(/[^a-zA-Z0-9\-_]/g, '').toUpperCase()
                })
              }
              pattern="[a-zA-Z0-9_-]+"
              className={inputClass}
              placeholder="REF-CODE"
            />
          </div>
        </div>

        <div className="flex items-start gap-3 mt-4">
          <input
            type="checkbox"
            id="accept-terms"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-1 w-4 h-4 text-brand bg-white border-slate-300 rounded focus:ring-brand/40 focus:ring-2 cursor-pointer accent-[#FF9A00]"
          />
          <label htmlFor="accept-terms" className="text-sm text-slate-500 leading-relaxed cursor-pointer">
            أوافق على{' '}
            <button type="button" onClick={() => onNavigateToPage?.('privacy-policy')} className="text-brand hover:text-brand-600 hover:underline font-medium">
              سياسة الخصوصية
            </button>
            {' '}و{' '}
            <button type="button" onClick={() => onNavigateToPage?.('terms-of-service')} className="text-brand hover:text-brand-600 hover:underline font-medium">
              شروط الخدمة
            </button>
          </label>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-brand text-white font-bold py-3.5 px-4 rounded-xl hover:bg-brand-600 shadow-lg shadow-brand/25 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed mt-2"
        >
          {isLoading ? (
            <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <span>إنشاء الحساب</span>
              <ArrowRight size={18} className="rotate-180" />
            </>
          )}
        </button>
      </form>
      )}

      {!otpStep && (
      <>
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-white text-slate-400">أو التسجيل عبر</span>
        </div>
      </div>

      <button
        onClick={handleGoogleSignup}
        className="w-full bg-white hover:bg-brand-50/50 border border-slate-200 text-slate-800 py-2.5 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors"
        aria-label="التسجيل باستخدام Google"
      >
        <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-5 h-5" alt="Google" />
        <span className="text-sm font-medium">Google</span>
      </button>
      </>
      )}

      <p className="mt-8 text-center text-slate-500 text-sm">
        لديك حساب بالفعل؟{' '}
        <button onClick={onNavigateToLogin} className="text-brand hover:text-brand-600 font-semibold hover:underline">
          سجل الدخول هنا
        </button>
      </p>
    </AuthLayout>
  );
};

export default SignupPage;
