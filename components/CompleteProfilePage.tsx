
import React, { useState, useEffect } from 'react';
import { Lock, Phone, Tag, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { handleApiError } from '../utils/errorHandler';
import CountryCodeSelector from './CountryCodeSelector';
import apiService from '../services/api';
import AuthLayout from './AuthLayout';
import BrandLogo from './BrandLogo';
import { captureAndPersistAttribution, getAttributionForApi } from '../utils/marketingAttribution';

interface CompleteProfilePageProps {
  onComplete: () => void;
}

const CompleteProfilePage: React.FC<CompleteProfilePageProps> = ({ onComplete }) => {
  const [formData, setFormData] = useState({
    password: '',
    phone: '',
    countryCode: '+966',
    referralCode: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refreshUser } = useAuth();

  useEffect(() => {
    const attr = captureAndPersistAttribution();
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref') || attr.ref;
    if (refCode) {
      const cleanRefCode = refCode.toUpperCase().replace(/[^A-Z0-9\-_]/g, '');
      setFormData((prev) => ({ ...prev, referralCode: cleanRefCode }));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.password || formData.password.length < 6) {
      setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    if (!formData.phone || formData.phone.trim() === '') {
      setError('رقم الهاتف مطلوب');
      return;
    }

    const fullPhoneNumber = formData.countryCode + formData.phone.replace(/^\+?/, '');
    setIsLoading(true);

    try {
      await apiService.completeProfile({
        password: formData.password,
        phone: fullPhoneNumber,
        referralCode: formData.referralCode.trim() || undefined,
        acquisition: getAttributionForApi()
      });
      await refreshUser();
      onComplete();
    } catch (err: any) {
      setError(handleApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass =
    'w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl py-3 pr-10 pl-4 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none transition-all placeholder-slate-400';

  return (
    <AuthLayout showNavLinks={false}>
      <div className="text-center mb-8 animate-fade-in-up">
        <div className="inline-flex items-center justify-center mb-4">
          <BrandLogo className="h-14 w-auto select-none" />
        </div>
        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">إكمال الملف الشخصي</h2>
        <p className="text-slate-500">يرجى إكمال معلوماتك لإتمام عملية التسجيل</p>
      </div>

      {error && (
        <div id="complete-profile-error" className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm" role="alert" aria-live="polite">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" aria-label="نموذج إكمال الملف الشخصي">
        <div>
          <label htmlFor="complete-password" className="block text-sm font-medium text-slate-600 mb-1.5">
            كلمة المرور <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} aria-hidden="true" />
            <input
              id="complete-password"
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
              minLength={6}
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
          <p className="mt-1 text-xs text-slate-400">يجب أن تكون 6 أحرف على الأقل</p>
        </div>

        <div>
          <label htmlFor="complete-phone" className="block text-sm font-medium text-slate-600 mb-1.5">
            رقم الهاتف <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-2">
            <CountryCodeSelector
              value={formData.countryCode}
              onChange={(dialCode) => setFormData({ ...formData, countryCode: dialCode })}
              className="flex-shrink-0"
            />
            <div className="relative flex-1">
              <Phone className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} aria-hidden="true" />
              <input
                id="complete-phone"
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

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-brand text-white font-bold py-3.5 px-4 rounded-xl hover:bg-brand-600 shadow-lg shadow-brand/25 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed mt-2"
        >
          {isLoading ? (
            <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <span>إكمال التسجيل</span>
              <ArrowRight size={18} className="rotate-180" />
            </>
          )}
        </button>
      </form>
    </AuthLayout>
  );
};

export default CompleteProfilePage;
