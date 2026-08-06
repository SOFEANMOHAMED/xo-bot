import React, { useState } from 'react';
import { Download, Smartphone, X, Share, CheckCircle } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { createPortal } from 'react-dom';

type Variant = 'header' | 'header-icon' | 'sidebar' | 'card';

interface InstallAppButtonProps {
  variant?: Variant;
  className?: string;
}

const InstallAppButton: React.FC<InstallAppButtonProps> = ({
  variant = 'header',
  className = '',
}) => {
  const { installed, canPrompt, isIos, showInstall, promptInstall } = usePwaInstall();
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!showInstall) {
    if (variant === 'card' && installed) {
      return (
        <div className={`flex items-center gap-2 text-sm text-green-700 dark:text-green-300 ${className}`}>
          <CheckCircle size={16} />
          التطبيق مثبت على هذا الجهاز
        </div>
      );
    }
    return null;
  }

  const handleClick = async () => {
    if (canPrompt) {
      setBusy(true);
      try {
        await promptInstall();
      } finally {
        setBusy(false);
      }
      return;
    }
    // iOS or browsers without deferred prompt → show instructions
    setShowIosHelp(true);
  };

  const label = 'تثبيت التطبيق';

  const baseBtn =
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50';

  let buttonClass = baseBtn;
  let content: React.ReactNode;

  if (variant === 'header-icon') {
    buttonClass +=
      ' p-2 text-brand hover:bg-brand-50 dark:hover:bg-brand-900/30 ' + className;
    content = <Download size={20} aria-hidden="true" />;
  } else if (variant === 'sidebar') {
    buttonClass +=
      ' w-full px-4 py-3 text-brand bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/40 ' +
      className;
    content = (
      <>
        <Download size={20} aria-hidden="true" />
        <span>{label}</span>
      </>
    );
  } else if (variant === 'card') {
    buttonClass +=
      ' px-4 py-2.5 bg-brand text-white text-sm font-bold hover:bg-brand-600 ' + className;
    content = (
      <>
        <Download size={16} aria-hidden="true" />
        <span>{label}</span>
      </>
    );
  } else {
    // header
    buttonClass +=
      ' px-3 py-2 text-sm text-brand bg-brand-50 dark:bg-brand-900/30 hover:bg-brand-100 dark:hover:bg-brand-900/50 ' +
      className;
    content = (
      <>
        <Download size={18} aria-hidden="true" />
        <span className="hidden lg:inline">{label}</span>
        <span className="lg:hidden">تثبيت</span>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={buttonClass}
        aria-label={label}
        title={label}
      >
        {content}
      </button>

      {showIosHelp &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-app-title"
            onClick={() => setShowIosHelp(false)}
          >
            <div
              className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-brand/10 border border-brand/20">
                    <Smartphone className="text-brand" size={22} />
                  </div>
                  <div>
                    <h2
                      id="install-app-title"
                      className="text-lg font-bold text-gray-900 dark:text-white"
                    >
                      تثبيت Xo Bot
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      أضفه للشاشة الرئيسية لاستقبال الإشعارات
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIosHelp(false)}
                  className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg"
                  aria-label="إغلاق"
                >
                  <X size={20} />
                </button>
              </div>

              {isIos ? (
                <ol className="space-y-3 text-sm text-gray-700 dark:text-gray-200 list-decimal list-inside mr-1">
                  <li className="leading-relaxed">
                    اضغط زر المشاركة{' '}
                    <Share size={14} className="inline text-brand mx-0.5" aria-hidden="true" />{' '}
                    في شريط Safari السفلي
                  </li>
                  <li className="leading-relaxed">
                    اختر <strong>«إضافة إلى الشاشة الرئيسية»</strong>
                  </li>
                  <li className="leading-relaxed">
                    افتح التطبيق من الأيقونة ثم فعّل الإشعارات من صفحة الإشعارات
                  </li>
                </ol>
              ) : (
                <div className="space-y-3 text-sm text-gray-700 dark:text-gray-200">
                  <p className="leading-relaxed">
                    من قائمة المتصفح (⋮ أو ⋯) اختر{' '}
                    <strong>«تثبيت التطبيق»</strong> أو{' '}
                    <strong>«Add to Home screen»</strong>.
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    إذا لم يظهر الخيار، افتح الموقع في Chrome أو Edge وحدّث الصفحة بعد تسجيل الدخول.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowIosHelp(false)}
                className="w-full px-4 py-2.5 rounded-xl bg-brand text-white font-bold hover:bg-brand-600 transition-colors"
              >
                حسناً
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default InstallAppButton;
