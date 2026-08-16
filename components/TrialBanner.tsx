
import React from 'react';
import { Clock, AlertTriangle, AlertCircle, Sparkles } from 'lucide-react';

interface TrialBannerProps {
  trialEndsAt: Date | string | null;
  trialDurationDays?: number; // Default 7
  onUpgrade?: () => void;
}

const TrialBanner: React.FC<TrialBannerProps> = ({ 
  trialEndsAt, 
  trialDurationDays = 7, 
  onUpgrade 
}) => {
  // If no trial end date, don't show banner
  if (!trialEndsAt) {
    return null;
  }
  
  // Calculate remaining days
  const now = new Date();
  const endDate = new Date(trialEndsAt);
  
  // Validate date
  if (isNaN(endDate.getTime())) {
    return null;
  }
  
  const diffTime = endDate.getTime() - now.getTime();
  const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  const isExpired = remainingDays <= 0;
  const isEndingSoon = remainingDays === 1;

  // Render nothing if user is somehow older than reasonable trial check but marked as valid (future safeguard)
  // But for this feature, we assume always show based on dates.

  // 1. Expired State
  if (isExpired) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 p-3 flex items-center justify-between gap-4 animate-fade-in transition-colors">
        <div className="flex items-center gap-3">
          <div className="bg-red-100 dark:bg-red-800 p-2 rounded-full text-red-600 dark:text-red-200">
            <AlertCircle size={20} />
          </div>
          <div>
            <p className="font-bold text-red-800 dark:text-red-300 text-sm">انتهت الفترة التجريبية المجانية</p>
            <p className="text-red-600 dark:text-red-400 text-xs">يرجى ترقية الباقة للاستمرار في استخدام ميزات البوت الذكي.</p>
          </div>
        </div>
        <button 
          onClick={onUpgrade}
          className="whitespace-nowrap px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
        >
          ترقية الخطة الآن
        </button>
      </div>
    );
  }

  // 2. Ending Soon (1 Day Left) - Orange
  if (isEndingSoon) {
    return (
      <div className="bg-orange-50 dark:bg-orange-900/20 border-b border-orange-200 dark:border-orange-800 p-3 flex items-center justify-between gap-4 animate-fade-in transition-colors">
        <div className="flex items-center gap-3">
          <div className="bg-orange-100 dark:bg-orange-800 p-2 rounded-full text-orange-600 dark:text-orange-200">
            <Clock size={20} className="animate-pulse" />
          </div>
          <div>
            <p className="font-bold text-orange-800 dark:text-orange-300 text-sm">تنبيه: يوم واحد متبقي في فترتك التجريبية</p>
            <p className="text-orange-600 dark:text-orange-400 text-xs">لا تفقد إعداداتك وبيانات البوت. اشترك اليوم.</p>
          </div>
        </div>
        <button 
          onClick={onUpgrade}
          className="whitespace-nowrap px-4 py-2 bg-brand hover:bg-brand-600 text-white text-xs font-bold rounded-lg shadow-sm shadow-brand/25 transition-colors"
        >
          ترقية الحساب
        </button>
      </div>
    );
  }

  // 3. Active Trial (> 1 Day) - Yellow/Gold
  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/10 border-b border-yellow-200 dark:border-yellow-800 p-3 flex items-center justify-between gap-4 animate-fade-in transition-colors">
      <div className="flex items-center gap-3">
        <div className="bg-yellow-100 dark:bg-yellow-800/50 p-2 rounded-full text-yellow-600 dark:text-yellow-400">
          <Sparkles size={20} />
        </div>
        <div>
          <p className="font-bold text-yellow-800 dark:text-yellow-400 text-sm">
            أنت تستخدم النسخة التجريبية ({trialDurationDays} أيام)
          </p>
          <p className="text-yellow-700 dark:text-yellow-500/80 text-xs flex items-center gap-1">
             <Clock size={12} />
             متبقي <span className="font-bold">{remainingDays} أيام</span> - استمتع بجميع المميزات مجاناً.
          </p>
        </div>
      </div>
      <button 
        onClick={onUpgrade}
        className="whitespace-nowrap px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
      >
        عرض الباقات
      </button>
    </div>
  );
};

export default TrialBanner;
