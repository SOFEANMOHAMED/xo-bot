import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface OtpVerificationStepProps {
  phoneDisplay: string;
  challengeId: string;
  resendAfterSeconds: number;
  isLoading: boolean;
  error: string | null;
  onVerify: (code: string) => void;
  onResend: () => void;
  onBack?: () => void;
  submitLabel?: string;
}

const OtpVerificationStep: React.FC<OtpVerificationStepProps> = ({
  phoneDisplay,
  challengeId,
  resendAfterSeconds,
  isLoading,
  error,
  onVerify,
  onResend,
  onBack,
  submitLabel = 'تأكيد الرمز'
}) => {
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(resendAfterSeconds);

  useEffect(() => {
    setCooldown(resendAfterSeconds);
  }, [challengeId, resendAfterSeconds]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    onVerify(code);
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <h3 className="text-lg font-bold text-slate-900">تحقق من رقم الهاتف</h3>
        <p className="text-sm text-slate-500 mt-1">
          أرسلنا رمزاً مكوناً من 6 أرقام عبر واتساب إلى
          <span className="font-semibold text-slate-700" dir="ltr"> {phoneDisplay}</span>
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="otp-code" className="block text-sm font-medium text-slate-600 mb-1.5">
            رمز التحقق
          </label>
          <input
            id="otp-code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl py-3 px-4 text-center text-2xl tracking-[0.5em] font-mono focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none"
            placeholder="000000"
            autoComplete="one-time-code"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading || code.length !== 6}
          className="w-full bg-brand text-white font-bold py-3.5 px-4 rounded-xl hover:bg-brand-600 shadow-lg shadow-brand/25 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            submitLabel
          )}
        </button>
      </form>

      <div className="flex items-center justify-between text-sm">
        {onBack ? (
          <button type="button" onClick={onBack} className="text-slate-500 hover:text-slate-700">
            تعديل البيانات
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onResend}
          disabled={cooldown > 0 || isLoading}
          className="text-brand hover:text-brand-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
        >
          <RefreshCw size={14} />
          {cooldown > 0 ? `إعادة الإرسال (${cooldown}s)` : 'إعادة إرسال الرمز'}
        </button>
      </div>
    </div>
  );
};

export default OtpVerificationStep;
