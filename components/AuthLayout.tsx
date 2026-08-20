import React from 'react';
import BrandLogo from './BrandLogo';

interface AuthLayoutProps {
  children: React.ReactNode;
  onBack?: () => void;
  /** Extra actions on the left of the navbar (RTL: visual left) */
  navActions?: React.ReactNode;
  showNavLinks?: boolean;
  /** When false, no top navbar — useful for compact recovery screens */
  showNavbar?: boolean;
  cardClassName?: string;
}

const AuthLayout: React.FC<AuthLayoutProps> = ({
  children,
  onBack,
  navActions,
  showNavLinks = true,
  showNavbar = true,
  cardClassName = '',
}) => {
  return (
    <div className="min-h-screen bg-white flex flex-col font-sans dir-rtl relative overflow-hidden text-slate-900">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#FFF8EB_0%,_#ffffff_55%,_#ffffff_100%)]" />
        <div className="absolute -top-24 left-1/4 w-[380px] h-[380px] rounded-full bg-brand-200/40 blur-[100px]" />
        <div className="absolute bottom-0 right-1/4 w-[320px] h-[320px] rounded-full bg-brand-100/50 blur-[90px]" />
      </div>

      {showNavbar && (
        <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-brand-100/80">
          <div className="container mx-auto px-6 py-4 flex justify-between items-center">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-2.5"
              aria-label="العودة للرئيسية"
            >
              <BrandLogo className="h-9 w-auto select-none" />
            </button>

            {showNavLinks && (
              <div className="hidden md:flex items-center gap-7 text-sm font-semibold text-slate-600">
                <button type="button" onClick={onBack} className="hover:text-brand transition-colors">الرئيسية</button>
                <button type="button" onClick={onBack} className="hover:text-brand transition-colors">المميزات</button>
                <button type="button" onClick={onBack} className="hover:text-brand transition-colors">الأسعار</button>
                <button type="button" onClick={onBack} className="hover:text-brand transition-colors">اتصل بنا</button>
              </div>
            )}

            <div className="flex items-center gap-3">
              {navActions}
            </div>
          </div>
        </nav>
      )}

      <div className={`flex-1 flex items-center justify-center p-4 relative z-10 ${showNavbar ? 'pt-24' : ''}`}>
        <div
          className={`w-full max-w-md bg-white border border-brand-100 rounded-3xl shadow-xl shadow-brand/10 p-8 ${cardClassName}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
