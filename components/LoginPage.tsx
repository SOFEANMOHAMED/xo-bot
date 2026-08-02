
import React, { useState } from 'react';
import { Bot, Mail, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { UserRole } from '../types';
import { useAuth } from '../contexts/AuthContext';
import AuthLayout from './AuthLayout';

interface LoginPageProps {
  onLoginSuccess: (role?: UserRole) => void;
  onBack: () => void;
  onNavigateToSignup: () => void;
  onNavigateToForgotPassword?: () => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, onBack, onNavigateToSignup, onNavigateToForgotPassword }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const user = await login(email, password);
      const role = (user as any)?.role || 'user';
      onLoginSuccess(role as UserRole);
    } catch (err: any) {
      setError(err.message || 'فشل تسجيل الدخول. يرجى التحقق من البيانات.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    const apiUrl = import.meta.env.VITE_API_URL || 'https://xo-bot.com/api';
    window.location.href = `${apiUrl}/auth/google`;
  };

  return (
    <AuthLayout
      onBack={onBack}
      navActions={
        <>
          <button
            type="button"
            onClick={onNavigateToSignup}
            className="text-sm font-semibold text-slate-600 hover:text-brand transition-colors hidden sm:block"
          >
            إنشاء حساب
          </button>
          <button
            type="button"
            onClick={onNavigateToSignup}
            className="px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm hover:bg-brand-600 transition-all shadow-lg shadow-brand/30"
          >
            جرب مجاناً 7 أيام
          </button>
        </>
      }
    >
      <div className="text-center mb-8 animate-fade-in-up">
        <div
          onClick={onBack}
          className="inline-flex items-center justify-center w-16 h-16 bg-brand rounded-2xl mb-4 cursor-pointer hover:bg-brand-600 transition-colors shadow-lg shadow-brand/30"
        >
          <Bot size={32} className="text-white" />
        </div>
        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">مرحباً بك مجدداً</h2>
        <p className="text-slate-500">سجل الدخول للمتابعة إلى لوحة التحكم</p>
      </div>

      <div className="space-y-4 mb-8">
        <button
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="w-full bg-white text-slate-900 font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-3 border border-slate-200 hover:border-brand-200 hover:bg-brand-50/40 transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-70 disabled:cursor-not-allowed"
          aria-label="تسجيل الدخول باستخدام Google"
        >
          <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-5 h-5" alt="" aria-hidden="true" />
          <span>المتابعة باستخدام Google</span>
        </button>
      </div>

      <div className="relative mb-8">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-white text-slate-400">أو عن طريق البريد الإلكتروني</span>
        </div>
      </div>

      {error && (
        <div id="login-error" className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm" role="alert" aria-live="polite">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5" aria-label="نموذج تسجيل الدخول">
        <div>
          <label htmlFor="login-email" className="block text-sm font-medium text-slate-600 mb-1.5">البريد الإلكتروني</label>
          <div className="relative">
            <Mail className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} aria-hidden="true" />
            <input
              id="login-email"
              type="email"
              required
              maxLength={255}
              value={email}
              onChange={(e) => e.target.value.length <= 255 && setEmail(e.target.value)}
              inputMode="email"
              autoComplete="email"
              aria-required="true"
              aria-invalid={error ? 'true' : 'false'}
              aria-describedby={error ? 'login-error' : undefined}
              className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl py-3 pr-10 pl-4 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none transition-all placeholder-slate-400"
              placeholder="name@company.com"
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label htmlFor="login-password" className="block text-sm font-medium text-slate-600">كلمة المرور</label>
            {onNavigateToForgotPassword ? (
              <button
                type="button"
                onClick={onNavigateToForgotPassword}
                className="text-xs text-brand hover:text-brand-600 focus:outline-none focus:ring-2 focus:ring-brand/40 rounded"
                aria-label="نسيت كلمة المرور"
              >
                نسيت كلمة المرور؟
              </button>
            ) : (
              <a href="#" className="text-xs text-brand hover:text-brand-600">نسيت كلمة المرور؟</a>
            )}
          </div>
          <div className="relative">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} aria-hidden="true" />
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              required
              maxLength={128}
              minLength={6}
              value={password}
              onChange={(e) => e.target.value.length <= 128 && setPassword(e.target.value)}
              autoComplete="current-password"
              aria-required="true"
              aria-invalid={error ? 'true' : 'false'}
              aria-describedby={error ? 'login-error' : undefined}
              className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl py-3 pr-10 pl-12 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none transition-all placeholder-slate-400"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 rounded"
              aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          aria-busy={isLoading}
          className="w-full bg-brand text-white font-bold py-3.5 px-4 rounded-xl hover:bg-brand-600 shadow-lg shadow-brand/25 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand/40"
        >
          {isLoading ? (
            <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
          ) : (
            <>
              <span>تسجيل الدخول</span>
              <ArrowRight size={18} className="rotate-180" aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      <p className="mt-8 text-center text-slate-500 text-sm">
        ليس لديك حساب؟{' '}
        <button onClick={onNavigateToSignup} className="text-brand hover:text-brand-600 font-semibold hover:underline">
          أنشئ حساباً جديداً
        </button>
      </p>
    </AuthLayout>
  );
};

export default LoginPage;
