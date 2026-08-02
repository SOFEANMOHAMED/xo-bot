import React, { useEffect } from 'react';
import { AlertCircle, CreditCard } from 'lucide-react';
import SubscriptionModal from './SubscriptionModal';
import { useSubscriptionCheck } from '../hooks/useSubscriptionCheck';

interface TrialExpiredBlockProps {
  children: React.ReactNode;
  onUpgrade?: () => void;
}

const TrialExpiredBlock: React.FC<TrialExpiredBlockProps> = ({ children, onUpgrade }) => {
  const { requiresUpgrade, isTrialExpired } = useSubscriptionCheck();
  const [showModal, setShowModal] = React.useState(false);

  useEffect(() => {
    if (requiresUpgrade && isTrialExpired) {
      setShowModal(true);
    }
  }, [requiresUpgrade, isTrialExpired]);

  if (requiresUpgrade && isTrialExpired) {
    return (
      <>
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <div className="bg-red-100 dark:bg-red-900/20 p-6 rounded-full mb-6">
            <AlertCircle className="w-16 h-16 text-red-600 dark:text-red-400" />
          </div>
          
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
            انتهت الفترة التجريبية المجانية
          </h2>
          
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-8 max-w-md">
            للاستمرار في استخدام جميع ميزات المنصة، يرجى ترقية باقاتك إلى إحدى الخطط المدفوعة.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={() => {
                setShowModal(true);
                onUpgrade?.();
              }}
              className="px-8 py-4 bg-brand hover:bg-brand-700 text-white font-bold rounded-lg shadow-lg hover:shadow-xl transition-all flex items-center gap-2"
            >
              <CreditCard size={20} />
              ترقية الباقة الآن
            </button>
            
            <button
              onClick={() => window.location.href = '/api/auth/profile'}
              className="px-8 py-4 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-bold rounded-lg transition-all"
            >
              عرض الملف الشخصي
            </button>
          </div>

          <div className="mt-8 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg max-w-md">
            <p className="text-sm text-yellow-800 dark:text-yellow-300">
              💡 <strong>ملاحظة:</strong> يمكنك الوصول إلى صفحة الملف الشخصي وإعدادات الاشتراك فقط حتى تقوم بالترقية.
            </p>
          </div>
        </div>

        {showModal && (
          <SubscriptionModal onClose={() => setShowModal(false)} />
        )}
      </>
    );
  }

  return <>{children}</>;
};

export default TrialExpiredBlock;

