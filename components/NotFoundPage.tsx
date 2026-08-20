import React from 'react';
import { Bot } from 'lucide-react';
import SeoHead from './SeoHead';

interface NotFoundPageProps {
  onBack: () => void;
}

const NotFoundPage: React.FC<NotFoundPageProps> = ({ onBack }) => {
  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans" dir="rtl">
      <SeoHead
        title="الصفحة غير موجودة"
        description="الصفحة التي تبحث عنها غير موجودة على Xo Bot."
        canonicalPath="/404"
        noindex
      />

      <header className="border-b border-slate-100">
        <div className="container mx-auto px-6 py-4">
          <button onClick={onBack} type="button" className="flex items-center gap-2.5">
            <div className="bg-brand p-2 rounded-xl shadow-md shadow-brand/25">
              <Bot size={22} className="text-white" />
            </div>
            <span className="text-xl font-extrabold tracking-tight text-slate-900">
              Xo <span className="text-brand">Bot</span>
            </span>
          </button>
        </div>
      </header>

      <main id="main-content" className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="text-center max-w-md">
          <p className="text-7xl font-extrabold text-brand/20 mb-4" aria-hidden>
            404
          </p>
          <h1 className="text-2xl font-bold text-slate-900 mb-3">الصفحة غير موجودة</h1>
          <p className="text-slate-500 mb-8 leading-relaxed">
            الرابط الذي طلبته غير صحيح أو أُزيلت الصفحة. يمكنك العودة للصفحة الرئيسية.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-3 rounded-xl bg-brand text-white font-bold hover:bg-brand-600 transition-colors"
          >
            العودة للرئيسية
          </button>
        </div>
      </main>
    </div>
  );
};

export default NotFoundPage;
