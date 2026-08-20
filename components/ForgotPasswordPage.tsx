import React, { useState } from 'react';
import { Mail, ArrowRight, CheckCircle } from 'lucide-react';
import apiService from '../services/api';
import { validateEmail } from '../utils/validation';
import { handleApiError } from '../utils/errorHandler';
import AuthLayout from './AuthLayout';
import BrandLogo from './BrandLogo';

interface ForgotPasswordPageProps {
  onBack: () => void;
  onNavigateToLogin: () => void;
}

const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({ onBack, onNavigateToLogin }) => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      setError(emailValidation.errors.join('، '));
      return;
    }
    setIsLoading(true);
    try {
      await apiService.forgotPassword(email);
      setSuccess(true);
    } catch (err: any) {
      setError(handleApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      onBack={onBack}
      showNavLinks={false}
      navActions={
        <button
          type="button"
          onClick={onNavigateToLogin}
          className="px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm hover:bg-brand-600 transition-all shadow-lg shadow-brand/30"
        >
          تسجيل الدخول
        </button>
      }
    >
      <div className="text-center mb-8 animate-fade-in-up">
        <div
          onClick={onBack}
          className="inline-flex items-center justify-center mb-4 cursor-pointer"
        >
          <BrandLogo className="h-14 w-auto select-none" />
        </div>
        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">استعادة كلمة المرور</h2>
        <p className="text-slate-500">
          {success
            ? 'تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني'
            : 'أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإعادة تعيين كلمة المرور'}
        </p>
      </div>

      {success ? (
        <div className="space-y-6">
          <div className="flex items-center justify-center w-20 h-20 bg-emerald-50 rounded-2xl mx-auto">
            <CheckCircle size={40} className="text-emerald-500" />
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-center">
            <p className="text-slate-600 text-sm mb-2">تم إرسال رابط استعادة كلمة المرور إلى:</p>
            <p className="text-brand font-semibold">{email}</p>
          </div>

          <div className="space-y-3">
            <p className="text-slate-500 text-sm text-center">
              يرجى التحقق من بريدك الإلكتروني واتباع التعليمات لإعادة تعيين كلمة المرور.
            </p>

            <button
              onClick={onNavigateToLogin}
              className="w-full bg-brand text-white font-bold py-3.5 px-4 rounded-xl hover:bg-brand-600 shadow-lg shadow-brand/25 transition-all flex items-center justify-center gap-2"
            >
              <span>العودة لتسجيل الدخول</span>
              <ArrowRight size={18} className="rotate-180" />
            </button>

            <button
              onClick={() => {
                setSuccess(false);
                setEmail('');
              }}
              className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-medium py-3 px-4 rounded-xl transition-all"
            >
              إرسال رابط آخر
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">البريد الإلكتروني</label>
            <div className="relative">
              <Mail className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type="email"
                value={email}
                onChange={(e) => e.target.value.length <= 255 && setEmail(e.target.value)}
                required
                maxLength={255}
                className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl py-3 pr-10 pl-4 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none transition-all placeholder-slate-400"
                placeholder="name@company.com"
                aria-required="true"
                aria-invalid={error ? 'true' : 'false'}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-brand text-white font-bold py-3.5 px-4 rounded-xl hover:bg-brand-600 shadow-lg shadow-brand/25 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>إرسال رابط الاستعادة</span>
                <ArrowRight size={18} className="rotate-180" />
              </>
            )}
          </button>
        </form>
      )}

      <div className="mt-6 pt-6 border-t border-slate-100">
        <p className="text-center text-slate-500 text-sm">
          تذكرت كلمة المرور؟{' '}
          <button onClick={onNavigateToLogin} className="text-brand hover:text-brand-600 font-semibold hover:underline">
            سجل الدخول هنا
          </button>
        </p>
      </div>

      <button
        onClick={onBack}
        className="mt-4 w-full text-slate-400 hover:text-brand transition-colors text-sm flex items-center justify-center gap-2"
      >
        <ArrowRight size={16} />
        العودة للصفحة الرئيسية
      </button>
    </AuthLayout>
  );
};

export default ForgotPasswordPage;
