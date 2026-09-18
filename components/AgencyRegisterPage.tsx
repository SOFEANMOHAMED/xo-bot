import React, { useState } from 'react';
import { Mail, Lock, Building2, Phone, Eye, EyeOff, CheckCircle2, ArrowLeft } from 'lucide-react';
import AuthLayout from './AuthLayout';
import BrandLogo from './BrandLogo';
import CountryCodeSelector from './CountryCodeSelector';
import { DEFAULT_DIAL_CODE } from '../constants/countries';
import { useVisitorCountryDialCode } from '../hooks/useVisitorCountryDialCode';
import apiService from '../services/api';
import { handleApiError } from '../utils/errorHandler';

interface AgencyRegisterPageProps {
  onNavigateToLogin: () => void;
  onBack?: () => void;
}

const AgencyRegisterPage: React.FC<AgencyRegisterPageProps> = ({
  onNavigateToLogin,
  onBack,
}) => {
  const [form, setForm] = useState({
    agencyName: '',
    email: '',
    password: '',
    phone: '',
    countryCode: DEFAULT_DIAL_CODE,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const { markUserPicked: markCountryUserPicked } = useVisitorCountryDialCode((dialCode) => {
    setForm((prev) => ({ ...prev, countryCode: dialCode }));
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.agencyName.trim() || !form.email.trim() || !form.password || !form.phone.trim()) {
      setError('يرجى تعبئة جميع الحقول');
      return;
    }
    if (form.password.length < 8) {
      setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
      return;
    }

    setIsLoading(true);
    try {
      const phone = `${form.countryCode}${form.phone.replace(/\D/g, '')}`;
      await apiService.submitAgencySignupRequest({
        email: form.email.trim(),
        password: form.password,
        phone,
        agencyName: form.agencyName.trim(),
      });
      setSubmitted(true);
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      onBack={onBack}
      showNavLinks
      navActions={
        <button
          type="button"
          onClick={onNavigateToLogin}
          className="px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm hover:bg-brand-600 transition-all shadow-lg shadow-brand/30"
        >
          تسجيل دخول الوكالة
        </button>
      }
    >
      <div className="text-center mb-8 animate-fade-in-up">
        <BrandLogo className="mx-auto mb-4" />
        <h1 className="text-2xl font-extrabold text-slate-900 mb-2">إنشاء حساب وكالة</h1>
        <p className="text-slate-500 text-sm">
          أرسل طلب الشراكة — سنراجعه ونرد عليك في أقرب وقت
        </p>
      </div>

      {submitted ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-8 text-center animate-fade-in">
          <CheckCircle2 className="mx-auto text-emerald-600 mb-4" size={48} />
          <h2 className="text-xl font-bold text-emerald-900 mb-2">تم استلام طلبك</h2>
          <p className="text-emerald-800 leading-relaxed mb-6">
            طلب إنشاء حساب الوكالة وصل إلينا، وسيتم الرد عليه في أقرب وقت ممكن بعد المراجعة.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={onNavigateToLogin}
              className="px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm"
            >
              تسجيل الدخول لاحقاً
            </button>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm"
              >
                <ArrowLeft size={16} />
                الرئيسية
              </button>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in-up">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">اسم الوكالة</label>
            <div className="relative">
              <Building2 className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                required
                value={form.agencyName}
                onChange={(e) => setForm((p) => ({ ...p, agencyName: e.target.value }))}
                className="w-full pr-10 pl-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none"
                placeholder="اسم الوكالة أو الشركة"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">البريد الإلكتروني</label>
            <div className="relative">
              <Mail className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="email"
                required
                dir="ltr"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                className="w-full pr-10 pl-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none text-left"
                placeholder="agency@example.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">كلمة المرور</label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                className="w-full pr-10 pl-12 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none"
                placeholder="8 أحرف على الأقل"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">رقم الهاتف</label>
            <div className="flex gap-2" dir="ltr">
              <CountryCodeSelector
                value={form.countryCode}
                onChange={(code) => {
                  markCountryUserPicked();
                  setForm((p) => ({ ...p, countryCode: code }));
                }}
              />
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="tel"
                  required
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value.replace(/[^\d\s-]/g, '') }))}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none"
                  placeholder="9XXXXXXXX"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 rounded-xl bg-brand text-white font-bold hover:bg-brand-600 transition-all shadow-lg shadow-brand/25 disabled:opacity-60"
          >
            {isLoading ? 'جاري الإرسال...' : 'إرسال طلب إنشاء الحساب'}
          </button>

          <p className="text-center text-sm text-slate-500">
            لديك حساب وكالة مفعّل؟{' '}
            <button
              type="button"
              onClick={onNavigateToLogin}
              className="text-brand font-semibold hover:underline"
            >
              تسجيل الدخول
            </button>
          </p>
        </form>
      )}
    </AuthLayout>
  );
};

export default AgencyRegisterPage;
