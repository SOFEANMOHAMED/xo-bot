import React, { useState } from 'react';
import { Shield, ArrowLeft, Loader2 } from 'lucide-react';

interface ImpersonationBannerProps {
  merchantName: string;
  merchantEmail: string;
  adminLabel?: string | null;
  onExit: () => Promise<void>;
}

const ImpersonationBanner: React.FC<ImpersonationBannerProps> = ({
  merchantName,
  merchantEmail,
  adminLabel,
  onExit,
}) => {
  const [loading, setLoading] = useState(false);

  const handleExit = async () => {
    try {
      setLoading(true);
      await onExit();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed md:sticky top-16 md:top-0 right-0 left-0 w-full z-20 bg-amber-500 text-amber-950 shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-start sm:items-center gap-2 min-w-0">
          <Shield size={18} className="flex-shrink-0 mt-0.5 sm:mt-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold">
              وضع الدعم الفني — أنت تتصفح حساب: {merchantName || merchantEmail}
            </p>
            <p className="text-xs opacity-80 truncate" dir="ltr">
              {merchantEmail}
              {adminLabel ? ` · بواسطة ${adminLabel}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExit}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 self-start sm:self-auto px-3 py-1.5 rounded-lg bg-amber-950 text-amber-50 text-xs font-bold hover:bg-black transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeft size={14} />}
          العودة للوحة الإدارة
        </button>
      </div>
    </div>
  );
};

export default ImpersonationBanner;
