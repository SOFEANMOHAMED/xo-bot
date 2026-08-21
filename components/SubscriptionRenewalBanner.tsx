import React, { useEffect, useState } from 'react';
import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';

interface SubscriptionRenewalBannerProps {
  subscriptionEndsAt: Date | string;
  onRenew?: () => void;
}

function formatCountdown(ms: number): { days: number; hours: number; minutes: number; seconds: number } {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}

const pad = (n: number) => String(n).padStart(2, '0');

const SubscriptionRenewalBanner: React.FC<SubscriptionRenewalBannerProps> = ({
  subscriptionEndsAt,
  onRenew
}) => {
  const endDate = new Date(subscriptionEndsAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (Number.isNaN(endDate.getTime())) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [subscriptionEndsAt]);

  if (Number.isNaN(endDate.getTime())) {
    return null;
  }

  const remainingMs = endDate.getTime() - now;
  if (remainingMs <= 0) {
    return null;
  }

  const { days, hours, minutes, seconds } = formatCountdown(remainingMs);
  const isUrgent = days <= 1;

  const containerClass = isUrgent
    ? 'bg-orange-50 dark:bg-orange-900/20 border-b border-orange-200 dark:border-orange-800'
    : 'bg-amber-50 dark:bg-amber-900/15 border-b border-amber-200 dark:border-amber-800';

  const titleClass = isUrgent
    ? 'text-orange-900 dark:text-orange-200'
    : 'text-amber-900 dark:text-amber-200';

  const subClass = isUrgent
    ? 'text-orange-700 dark:text-orange-400'
    : 'text-amber-800 dark:text-amber-400/90';

  const iconWrap = isUrgent
    ? 'bg-orange-100 dark:bg-orange-800 text-orange-600 dark:text-orange-200'
    : 'bg-amber-100 dark:bg-amber-800/60 text-amber-700 dark:text-amber-300';

  return (
    <div className={`${containerClass} p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in transition-colors`}>
      <div className="flex items-start sm:items-center gap-3 min-w-0">
        <div className={`${iconWrap} p-2 rounded-full shrink-0`}>
          {isUrgent ? <AlertTriangle size={20} className="animate-pulse" /> : <Clock size={20} />}
        </div>
        <div className="min-w-0">
          <p className={`font-bold text-sm ${titleClass}`}>
            اشتراكك على وشك الانتهاء — يرجى التجديد
          </p>
          <p className={`text-xs mt-0.5 ${subClass}`}>
            سيتوقف الوصول للميزات تلقائياً عند انتهاء المدة. جدّد الآن لتجنب انقطاع الخدمة.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0 self-stretch sm:self-auto justify-between sm:justify-end">
        <div
          className={`flex items-center gap-1.5 font-mono text-sm font-bold tabular-nums ${titleClass}`}
          aria-label="العد التنازلي لانتهاء الاشتراك"
        >
          <span className="inline-flex flex-col items-center min-w-[2.25rem] px-1.5 py-1 rounded-md bg-white/70 dark:bg-black/20">
            <span>{pad(days)}</span>
            <span className="text-[10px] font-sans font-medium opacity-70">يوم</span>
          </span>
          <span className="opacity-50">:</span>
          <span className="inline-flex flex-col items-center min-w-[2.25rem] px-1.5 py-1 rounded-md bg-white/70 dark:bg-black/20">
            <span>{pad(hours)}</span>
            <span className="text-[10px] font-sans font-medium opacity-70">ساعة</span>
          </span>
          <span className="opacity-50">:</span>
          <span className="inline-flex flex-col items-center min-w-[2.25rem] px-1.5 py-1 rounded-md bg-white/70 dark:bg-black/20">
            <span>{pad(minutes)}</span>
            <span className="text-[10px] font-sans font-medium opacity-70">دقيقة</span>
          </span>
          <span className="opacity-50">:</span>
          <span className="inline-flex flex-col items-center min-w-[2.25rem] px-1.5 py-1 rounded-md bg-white/70 dark:bg-black/20">
            <span>{pad(seconds)}</span>
            <span className="text-[10px] font-sans font-medium opacity-70">ثانية</span>
          </span>
        </div>

        <button
          type="button"
          onClick={onRenew}
          className="whitespace-nowrap px-4 py-2 bg-brand hover:bg-brand-600 text-white text-xs font-bold rounded-lg shadow-sm shadow-brand/25 transition-colors inline-flex items-center gap-1.5"
        >
          <RefreshCw size={14} />
          تجديد الاشتراك
        </button>
      </div>
    </div>
  );
};

export default SubscriptionRenewalBanner;
