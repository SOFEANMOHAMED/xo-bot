import React, { useEffect, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import apiService from '../services/api';
import { logger } from '../utils/logger';
import { usePublishedFooterPages } from '../hooks/usePublishedFooterPages';

interface PageViewProps {
  slug: string;
  onBack: () => void;
  onNavigateToLogin?: () => void;
  onNavigateToSignup?: () => void;
  onNavigateToPage?: (slug: string) => void;
}

const PageView: React.FC<PageViewProps> = ({
  slug,
  onBack,
  onNavigateToLogin,
  onNavigateToSignup,
  onNavigateToPage
}) => {
  const [page, setPage] = useState<{
    title: string;
    content: string;
    updated_at: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cmsFooterPages = usePublishedFooterPages();

  const formatContent = (content: string): string => {
    if (/<[a-z][\s\S]*>/i.test(content)) {
      return content;
    }
    const paragraphs = content.split(/\n\s*\n/);
    return paragraphs.map(paragraph => {
      const trimmed = paragraph.trim();
      if (!trimmed) return '';
      const withBreaks = trimmed.replace(/\n/g, '<br>');
      if (/^[\d]+[)\-\.]/.test(trimmed) || /^[أ-ي][)\-\.]/.test(trimmed)) {
        return `<h3>${withBreaks}</h3>`;
      }
      if (trimmed.length < 60 && !trimmed.includes(':') && !trimmed.includes('،')) {
        return `<h2>${withBreaks}</h2>`;
      }
      return `<p>${withBreaks}</p>`;
    }).filter(p => p).join('\n');
  };

  useEffect(() => {
    const fetchPage = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setPage(null);
        const response = await apiService.getPageBySlug(slug);
        setPage(response);
      } catch (err: any) {
        logger.error('Failed to fetch page:', err);
        setPage(null);
        const status = typeof err?.status === 'number' ? err.status : undefined;
        if (status === 404) {
          setError('الصفحة غير موجودة');
        } else if (status != null && status >= 500) {
          setError('تعذر تحميل الصفحة من الخادم. حاول لاحقاً.');
        } else {
          setError('الصفحة غير موجودة');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchPage();
  }, [slug]);

  const handleNavigateToPage = (pageSlug: string) => {
    if (onNavigateToPage) {
      onNavigateToPage(pageSlug);
    } else {
      window.location.href = `/${pageSlug}`;
    }
  };

  const Navbar = () => (
    <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-brand-100/80">
      <div className="container mx-auto px-6 py-4 flex justify-between items-center">
        <button onClick={onBack} className="flex items-center gap-2.5">
          <div className="bg-brand p-2 rounded-xl shadow-md shadow-brand/25">
            <Bot size={22} className="text-white" />
          </div>
          <span className="text-xl font-extrabold tracking-tight text-slate-900">
            Xo <span className="text-brand">Bot</span>
          </span>
        </button>

        <div className="hidden md:flex items-center gap-6 text-sm font-semibold text-slate-600">
          <button onClick={onBack} className="hover:text-brand transition-colors">الرئيسية</button>
          <button onClick={() => handleNavigateToPage('privacy-policy')} className="hover:text-brand transition-colors">سياسة الخصوصية</button>
          <button onClick={() => handleNavigateToPage('terms-of-service')} className="hover:text-brand transition-colors">الشروط والأحكام</button>
        </div>

        <div className="flex items-center gap-3">
          {onNavigateToLogin && (
            <button onClick={onNavigateToLogin} className="text-sm font-semibold text-slate-600 hover:text-brand transition-colors hidden sm:block">
              تسجيل الدخول
            </button>
          )}
          {onNavigateToSignup && (
            <button
              onClick={onNavigateToSignup}
              className="px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm hover:bg-brand-600 transition-all shadow-lg shadow-brand/30"
            >
              جرب مجاناً
            </button>
          )}
        </div>
      </div>
    </nav>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="animate-spin text-brand" size={40} />
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center pt-20">
          <div className="text-center max-w-md px-4">
            <h1 className="text-2xl font-bold text-slate-900 mb-4">{error || 'الصفحة غير موجودة'}</h1>
            <button onClick={onBack} className="text-brand hover:text-brand-600 font-semibold">
              العودة للرئيسية
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans" dir="rtl">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#FFF8EB_0%,_#ffffff_60%,_#ffffff_100%)]" />
      </div>
      <Navbar />

      <main className="flex-1 pt-24 pb-16 relative z-10">
        <div className="container mx-auto px-6">
          <div className="max-w-4xl mx-auto">
            <div className="mb-8 text-center">
              <h1 className="text-3xl lg:text-4xl font-extrabold text-slate-900 mb-4">{page.title}</h1>
              <div className="h-1 w-24 bg-brand mx-auto rounded-full" />
            </div>

            <div className="bg-white rounded-3xl p-8 lg:p-12 border border-brand-100 shadow-xl shadow-brand/5">
              <style>{`
                .page-content h1 {
                  font-size: 2rem;
                  font-weight: 700;
                  color: #0f172a;
                  margin-bottom: 1.5rem;
                  margin-top: 2rem;
                  line-height: 1.3;
                }
                .page-content h2 {
                  font-size: 1.5rem;
                  font-weight: 700;
                  color: #0f172a;
                  margin-bottom: 1rem;
                  margin-top: 2rem;
                  line-height: 1.4;
                  border-bottom: 1px solid #ffefcc;
                  padding-bottom: 0.5rem;
                }
                .page-content h3 {
                  font-size: 1.25rem;
                  font-weight: 600;
                  color: #1e293b;
                  margin-bottom: 0.75rem;
                  margin-top: 1.5rem;
                  line-height: 1.4;
                }
                .page-content h4 {
                  font-size: 1.1rem;
                  font-weight: 600;
                  color: #334155;
                  margin-bottom: 0.5rem;
                  margin-top: 1.25rem;
                }
                .page-content p {
                  color: #475569;
                  margin-bottom: 1rem;
                  line-height: 1.9;
                  font-size: 1rem;
                }
                .page-content ul, .page-content ol {
                  color: #475569;
                  margin-bottom: 1rem;
                  padding-right: 1.5rem;
                  line-height: 1.8;
                }
                .page-content ul { list-style-type: disc; }
                .page-content ol { list-style-type: decimal; }
                .page-content li { margin-bottom: 0.5rem; padding-right: 0.25rem; }
                .page-content li::marker { color: #FF9A00; }
                .page-content a {
                  color: #E68A00;
                  text-decoration: underline;
                  text-underline-offset: 2px;
                }
                .page-content a:hover { color: #FF9A00; }
                .page-content strong, .page-content b {
                  color: #0f172a;
                  font-weight: 600;
                }
                .page-content blockquote {
                  border-right: 4px solid #FF9A00;
                  padding-right: 1rem;
                  padding-top: 0.5rem;
                  padding-bottom: 0.5rem;
                  margin: 1.5rem 0;
                  background: #FFF8EB;
                  border-radius: 0 0.5rem 0.5rem 0;
                  color: #475569;
                  font-style: italic;
                }
                .page-content code {
                  background: #f1f5f9;
                  color: #c2410c;
                  padding: 0.125rem 0.375rem;
                  border-radius: 0.25rem;
                  font-size: 0.875rem;
                  font-family: ui-monospace, monospace;
                }
                .page-content pre {
                  background: #f8fafc;
                  padding: 1rem;
                  border-radius: 0.5rem;
                  overflow-x: auto;
                  margin: 1rem 0;
                  border: 1px solid #e2e8f0;
                }
                .page-content pre code {
                  background: transparent;
                  padding: 0;
                  color: #334155;
                }
                .page-content table {
                  width: 100%;
                  border-collapse: collapse;
                  margin: 1.5rem 0;
                }
                .page-content th, .page-content td {
                  border: 1px solid #e2e8f0;
                  padding: 0.75rem;
                  text-align: right;
                }
                .page-content th {
                  background: #FFF8EB;
                  color: #0f172a;
                  font-weight: 600;
                }
                .page-content td { color: #475569; }
                .page-content hr {
                  border: none;
                  border-top: 1px solid #ffefcc;
                  margin: 2rem 0;
                }
                .page-content img {
                  max-width: 100%;
                  height: auto;
                  border-radius: 0.5rem;
                  margin: 1rem 0;
                }
                .page-content > *:first-child { margin-top: 0; }
                .page-content > *:last-child { margin-bottom: 0; }
              `}</style>
              <div
                className="page-content"
                dangerouslySetInnerHTML={{ __html: formatContent(page.content) }}
              />

              <div className="mt-10 pt-6 border-t border-brand-100 text-sm text-slate-400 flex items-center justify-between">
                <span>
                  آخر تحديث: {new Date(page.updated_at).toLocaleDateString('ar-SA-u-nu-latn', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </span>
                <button onClick={onBack} className="text-brand hover:text-brand-600 transition-colors font-medium">
                  ← العودة للرئيسية
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 bg-slate-900 text-white pt-16 pb-8">
        <div className="container mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-12 mb-12 border-b border-slate-800 pb-12">
            <div>
              <button onClick={onBack} className="flex items-center gap-2 text-white mb-4">
                <div className="bg-brand p-1.5 rounded-lg">
                  <Bot size={18} className="text-white" />
                </div>
                <span className="text-lg font-bold">Xo Bot</span>
              </button>
              <p className="text-slate-400 text-sm leading-relaxed">
                الحل الأمثل للمتاجر الإلكترونية العربية. خدمة عملاء ذكية، آلية، وسريعة.
              </p>
            </div>

            <div className="col-span-1 md:col-span-2 flex justify-around gap-8">
              <div>
                <h4 className="font-bold mb-5">روابط هامة</h4>
                <ul className="space-y-3 text-sm text-slate-400">
                  <li><button onClick={onBack} className="hover:text-brand transition-colors">الرئيسية</button></li>
                  {onNavigateToLogin && (
                    <li><button onClick={onNavigateToLogin} className="hover:text-brand transition-colors">تسجيل الدخول</button></li>
                  )}
                  {onNavigateToSignup && (
                    <li><button onClick={onNavigateToSignup} className="hover:text-brand transition-colors">إنشاء حساب</button></li>
                  )}
                </ul>
              </div>
              <div>
                <h4 className="font-bold mb-5">قانوني</h4>
                <ul className="space-y-3 text-sm text-slate-400">
                  <li>
                    <button onClick={() => handleNavigateToPage('privacy-policy')} className="hover:text-brand transition-colors">
                      سياسة الخصوصية
                    </button>
                  </li>
                  <li>
                    <button onClick={() => handleNavigateToPage('terms-of-service')} className="hover:text-brand transition-colors">
                      الشروط والأحكام
                    </button>
                  </li>
                </ul>
              </div>
              {cmsFooterPages.length > 0 && (
                <div>
                  <h4 className="font-bold mb-5">صفحات</h4>
                  <ul className="space-y-3 text-sm text-slate-400">
                    {cmsFooterPages.map((p) => (
                      <li key={p.slug}>
                        <button
                          type="button"
                          onClick={() => handleNavigateToPage(p.slug)}
                          className="hover:text-brand transition-colors text-right"
                        >
                          {p.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div>
              <h4 className="font-bold mb-5">كن على تواصل</h4>
              <div className="flex gap-3">
                <a href="#" className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 hover:bg-brand hover:text-white transition-all">
                  <span className="sr-only">Facebook</span>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
                </a>
                <a href="#" className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 hover:bg-brand hover:text-white transition-all">
                  <span className="sr-only">Twitter</span>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" /></svg>
                </a>
              </div>
            </div>
          </div>
          <div className="text-center text-slate-500 text-sm">
            © {new Date().getFullYear()} Xo Bot. جميع الحقوق محفوظة.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PageView;
