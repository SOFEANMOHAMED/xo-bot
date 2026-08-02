import React, { useState, useEffect } from 'react';
import { Bot, Lock, ArrowRight, CheckCircle, Eye, EyeOff } from 'lucide-react';
import apiService from '../services/api';
import { validatePassword } from '../utils/validation';
import { handleApiError } from '../utils/errorHandler';
import AuthLayout from './AuthLayout';

interface ResetPasswordPageProps {
  onBack: () => void;
  onNavigateToLogin: () => void;
  token?: string;
}

const ResetPasswordPage: React.FC<ResetPasswordPageProps> = ({ onBack, onNavigateToLogin, token: propToken }) => {
  const getTokenFromUrl = () => {
    if (propToken) return propToken;
    const hash = window.location.hash;
    const match = hash.match(/token=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  };

  const [token] = useState<string | null>(getTokenFromUrl());
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) setError('رابط غير صالح. يرجى طلب رابط جديد.');
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      setError(passwordValidation.errors.join('، '));
      return;
    }
    if (password !== confirmPassword) {
      setError('كلمات المرور غير متطابقة');
      return;
    }
    if (!token) {
      setError('رابط غير صالح');
      return;
    }

    setIsLoading(true);
    try {
      await apiService.resetPassword(token, password);
      setSuccess(true);
    } catch (err: any) {
      setError(handleApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass =
    'w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl py-3 pr-10 pl-12 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none transition-all placeholder-slate-400';

  if (success) {
    return (
      <AuthLayout onBack={onBack} showNavLinks={false}>
        <div className="text-center animate-fade-in-up">
          <div className="flex items-center justify-center w-20 h-20 bg-emerald-50 rounded-2xl mx-auto mb-6">
            <CheckCircle size={40} className="text-emerald-500" />
          </div>
          <h2 className="text-3xl font-extrabold text-slate-900 mb-2">تم إعادة تعيين كلمة المرور</h2>
          <p className="text-slate-500 mb-8">
            تم إعادة تعيين كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.
          </p>
          <button
            onClick={onNavigateToLogin}
            className="w-full bg-brand text-white font-bold py-3.5 px-4 rounded-xl hover:bg-brand-600 shadow-lg shadow-brand/25 transition-all flex items-center justify-center gap-2"
          >
            <span>تسجيل الدخول</span>
            <ArrowRight size={18} className="rotate-180" />
          </button>
        </div>
      </AuthLayout>
    );
  }

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
          className="inline-flex items-center justify-center w-16 h-16 bg-brand rounded-2xl mb-4 cursor-pointer hover:bg-brand-600 transition-colors shadow-lg shadow-brand/30"
        >
          <Bot size={32} className="text-white" />
        </div>
        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">إعادة تعيين كلمة المرور</h2>
        <p className="text-slate-500">أدخل كلمة المرور الجديدة</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">{error}</div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1.5">كلمة المرور الجديدة</label>
          <div className="relative">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => e.target.value.length <= 128 && setPassword(e.target.value)}
              required
              maxLength={128}
              minLength={6}
              className={inputClass}
              placeholder="••••••••"
              aria-required="true"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">يجب أن تكون 6 أحرف على الأقل</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1.5">تأكيد كلمة المرور</label>
          <div className="relative">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => e.target.value.length <= 128 && setConfirmPassword(e.target.value)}
              required
              maxLength={128}
              minLength={6}
              className={inputClass}
              placeholder="••••••••"
              aria-required="true"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading || !token}
          className="w-full bg-brand text-white font-bold py-3.5 px-4 rounded-xl hover:bg-brand-600 shadow-lg shadow-brand/25 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <span>إعادة تعيين كلمة المرور</span>
              <ArrowRight size={18} className="rotate-180" />
            </>
          )}
        </button>
      </form>

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

export default ResetPasswordPage;
