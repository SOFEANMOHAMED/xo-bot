import React, { useEffect, useRef, useState } from 'react';
import { Link2, MessageCircle, MessageSquare } from 'lucide-react';
import { apiService } from '../services/api';
import { MerchantSettings } from '../types';
import SocialAutomationPanel from './SocialAutomationPanel';
import SocialStoriesPanel from './SocialStoriesPanel';

interface SocialAutomationPageProps {
  settings: MerchantSettings;
  onUpdateSettings: (s: MerchantSettings) => Promise<void> | void;
  showNotification?: (message: string, type: 'success' | 'error' | 'info' | 'warning', duration?: number) => void;
  onGoToIntegrations?: () => void;
}

const SocialAutomationPage: React.FC<SocialAutomationPageProps> = ({
  settings,
  onUpdateSettings,
  showNotification,
  onGoToIntegrations
}) => {
  const [initialLoading, setInitialLoading] = useState(true);
  const [facebookConnected, setFacebookConnected] = useState(false);
  const [instagramConnected, setInstagramConnected] = useState(false);
  const [facebookPageId, setFacebookPageId] = useState<string | undefined>();
  const [instagramUserId, setInstagramUserId] = useState<string | undefined>();
  const [igAutoReplyDM, setIgAutoReplyDM] = useState(true);
  const notifyRef = useRef(showNotification);
  notifyRef.current = showNotification;
  const hasSalesBot = settings.planCapabilities?.hasSalesBot !== false;

  // Load connection status once on mount — never remount UI on later parent re-renders
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const integrations = await apiService.getIntegrations();
        if (cancelled) return;
        const fb = integrations.facebook;
        const ig = integrations.instagram;
        setFacebookConnected(!!fb?.isConnected);
        setInstagramConnected(!!ig?.isConnected);
        setFacebookPageId(fb?.platformId || fb?.pages?.[0]?.pageId);
        setInstagramUserId(ig?.platformId);
        setIgAutoReplyDM(ig?.autoReplyDM ?? true);
      } catch {
        if (!cancelled) {
          notifyRef.current?.('تعذّر تحميل حالة الربط', 'error');
        }
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-gray-500 dark:text-gray-400 text-sm">
        جاري التحميل…
      </div>
    );
  }

  if (!facebookConnected && !instagramConnected) {
    return (
      <div className="max-w-xl mx-auto mt-10 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-8 text-center shadow-sm">
        <div className="mx-auto w-12 h-12 rounded-xl bg-brand-50 dark:bg-brand-900/40 text-brand flex items-center justify-center mb-4">
          <Link2 size={22} />
        </div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
          أتمتة المنشورات والتعليقات
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          اربط صفحة فيسبوك أو حساب إنستغرام أولاً من «الربط والتكامل».
        </p>
        {onGoToIntegrations && (
          <button
            type="button"
            onClick={onGoToIntegrations}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-700 text-white text-sm font-medium"
          >
            <Link2 size={16} />
            الذهاب إلى الربط والتكامل
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">أتمتة المنشورات والتعليقات</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          فعّل الردود على منشورات محددة، واربط الستوري أو المنشور بمنتج ليبدأ البوت منه عندما يراسل العميل.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
        <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">الرد على الرسائل</h3>
        {!hasSalesBot ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40">
            باقتك الحالية مخصّصة للرد على التعليقات فقط. بوت المبيعات (Messenger ورسائل إنستغرام المباشرة) غير متاح —
            يمكنك ترقية الباقة لتفعيله.
          </p>
        ) : (
          <>
            {facebookConnected && (
              <label className="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-700 rounded-xl">
                <div className="flex items-center gap-2">
                  <MessageCircle size={16} className="text-brand" />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">الرد على Messenger</span>
                </div>
                <input
                  type="checkbox"
                  checked={!!settings.autoReplyMessenger}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, autoReplyMessenger: e.target.checked })
                  }
                  className="w-4 h-4"
                />
              </label>
            )}
            {instagramConnected && (
              <label className="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-700 rounded-xl">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-pink-600" />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    الرد على رسائل إنستغرام المباشرة
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={igAutoReplyDM}
                  onChange={async (e) => {
                    const v = e.target.checked;
                    const prev = igAutoReplyDM;
                    setIgAutoReplyDM(v);
                    try {
                      await apiService.updateInstagramSettings({ autoReplyDM: v });
                    } catch (err: unknown) {
                      setIgAutoReplyDM(prev);
                      const msg =
                        err instanceof Error && err.message.includes('SALES_BOT')
                          ? 'باقتك لا تشمل بوت المبيعات'
                          : 'فشل حفظ إعداد إنستغرام';
                      notifyRef.current?.(msg, 'error');
                    }
                  }}
                  className="w-4 h-4"
                />
              </label>
            )}
          </>
        )}
      </div>

      <SocialStoriesPanel
        facebookConnected={facebookConnected}
        instagramConnected={instagramConnected}
        showNotification={showNotification}
      />

      <SocialAutomationPanel
        facebookConnected={facebookConnected}
        instagramConnected={instagramConnected}
        facebookPageId={facebookPageId}
        instagramUserId={instagramUserId}
        showNotification={showNotification}
      />
    </div>
  );
};

export default SocialAutomationPage;
