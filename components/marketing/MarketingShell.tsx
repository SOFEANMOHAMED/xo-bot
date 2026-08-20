import React from 'react';
import { Bot, Store } from 'lucide-react';
import { usePublishedFooterPages } from '../../hooks/usePublishedFooterPages';

export interface MarketingShellProps {
  children: React.ReactNode;
  onNavigateToLogin: () => void;
  onNavigateToSignup: () => void;
  onBack?: () => void;
  onNavigateToPage?: (slug: string) => void;
}

const MarketingShell: React.FC<MarketingShellProps> = ({
  children,
  onNavigateToLogin,
  onNavigateToSignup,
  onBack,
  onNavigateToPage,
}) => {
  const cmsFooterPages = usePublishedFooterPages();

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans" dir="rtl">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-brand-100/80">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center gap-4">
          <button type="button" onClick={onBack} className="flex items-center gap-2.5 shrink-0">
            <div className="bg-brand p-2 rounded-xl shadow-md shadow-brand/25">
              <Bot size={22} className="text-white" />
            </div>
            <span className="text-xl font-extrabold tracking-tight text-slate-900">
              Xo <span className="text-brand">Bot</span>
            </span>
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-slate-600">
            <a href="/" className="hover:text-brand transition-colors">الرئيسية</a>
            <a href="/about" className="hover:text-brand transition-colors">عن المنصة</a>
            <a href="/whatsapp-bot" className="hover:text-brand transition-colors">بوت واتساب</a>
            <a href="/storify" className="text-[#8fa82b] hover:text-[#718520] transition-colors flex items-center gap-1">
              <Store size={14} /> شراكة ستوريفاي
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onNavigateToLogin}
              className="text-sm font-semibold text-slate-600 hover:text-brand transition-colors hidden sm:block"
            >
              تسجيل الدخول
            </button>
            <button
              type="button"
              onClick={onNavigateToSignup}
              className="px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm hover:bg-brand-600 transition-all shadow-lg shadow-brand/30"
            >
              جرب مجاناً
            </button>
          </div>
        </div>
      </header>

      <main id="main-content">{children}</main>

      <footer className="bg-slate-900 text-white pt-14 pb-8 mt-16">
        <div className="container mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-10 mb-10 border-b border-slate-800 pb-10">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="bg-brand p-1.5 rounded-lg">
                  <Bot size={18} className="text-white" />
                </div>
                <span className="text-lg font-bold">Xo Bot</span>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed">
                بوت مبيعات عربي للمتاجر الإلكترونية — واتساب، فيسبوك، إنستغرام، وتيليجرام.
              </p>
            </div>

            <div>
              <h4 className="font-bold mb-4">المنتج</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><a href="/" className="hover:text-brand transition-colors">الرئيسية</a></li>
                <li><a href="/about" className="hover:text-brand transition-colors">عن Xo Bot</a></li>
                <li><a href="/whatsapp-bot" className="hover:text-brand transition-colors">بوت واتساب</a></li>
                <li><a href="/storify" className="hover:text-brand transition-colors">شراكة ستوريفاي</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold mb-4">قانوني</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><a href="/privacy-policy" className="hover:text-brand transition-colors">سياسة الخصوصية</a></li>
                <li><a href="/terms-of-service" className="hover:text-brand transition-colors">الشروط والأحكام</a></li>
                {cmsFooterPages.map((page) => (
                  <li key={page.slug}>
                    {onNavigateToPage ? (
                      <button
                        type="button"
                        onClick={() => onNavigateToPage(page.slug)}
                        className="hover:text-brand transition-colors text-right"
                      >
                        {page.title}
                      </button>
                    ) : (
                      <a href={`/${page.slug}`} className="hover:text-brand transition-colors">{page.title}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-bold mb-4">للمساعدة الآلية</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><a href="/llms.txt" className="hover:text-brand transition-colors">llms.txt</a></li>
                <li><a href="/llms-full.txt" className="hover:text-brand transition-colors">llms-full.txt</a></li>
              </ul>
            </div>
          </div>
          <p className="text-center text-slate-500 text-sm">
            © {new Date().getFullYear()} Xo Bot. جميع الحقوق محفوظة.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default MarketingShell;
