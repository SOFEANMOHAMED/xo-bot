import React, { useEffect, useState } from 'react';
import { BellRing, Smartphone, CheckCircle, AlertCircle, Loader2, Send } from 'lucide-react';
import apiService from '../services/api';
import {
  isPushSupported,
  isStandalonePwa,
  registerServiceWorker,
  subscribeToPush,
  unsubscribeFromPush,
  subscriptionToJSON,
  getExistingPushSubscription,
} from '../utils/webPush';
import InstallAppButton from './InstallAppButton';
import { logger } from '../utils/logger';

type Status = 'idle' | 'loading' | 'subscribed' | 'unsupported' | 'denied' | 'error';

const PushNotificationSetup: React.FC = () => {
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(true);
  const standalone = isStandalonePwa();

  const refreshStatus = async () => {
    try {
      if (!isPushSupported()) {
        setStatus('unsupported');
        return;
      }

      if (Notification.permission === 'denied') {
        setStatus('denied');
        return;
      }

      await registerServiceWorker();
      const server = await apiService.getPushStatus();
      setConfigured(server.configured !== false);

      const localSub = await getExistingPushSubscription();
      if (server.subscribed || localSub) {
        setStatus('subscribed');
      } else {
        setStatus('idle');
      }
    } catch (err: any) {
      logger.error('Failed to load push status', err);
      setStatus('error');
      setMessage(err?.message || 'تعذر التحقق من حالة الإشعارات');
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  const handleEnable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { publicKey } = await apiService.getPushVapidPublicKey();
      const subscription = await subscribeToPush(publicKey);
      await apiService.subscribePush(subscriptionToJSON(subscription));
      setStatus('subscribed');
      setMessage('تم تفعيل إشعارات الجوال على هذا الجهاز.');
    } catch (err: any) {
      logger.error('Enable push failed', err);
      if (Notification.permission === 'denied') {
        setStatus('denied');
      } else {
        setStatus('error');
      }
      setMessage(err?.message || 'فشل تفعيل الإشعارات');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) {
        await apiService.unsubscribePush(endpoint);
      }
      setStatus('idle');
      setMessage('تم إيقاف إشعارات هذا الجهاز.');
    } catch (err: any) {
      logger.error('Disable push failed', err);
      setMessage(err?.message || 'فشل إيقاف الإشعارات');
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await apiService.sendTestPush();
      setMessage('تم إرسال إشعار تجريبي. تحقق من شريط الإشعارات.');
    } catch (err: any) {
      logger.error('Test push failed', err);
      setMessage(err?.message || 'فشل الإشعار التجريبي');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 flex items-center gap-3">
        <Loader2 className="animate-spin text-brand" size={20} />
        <span className="text-sm text-gray-600 dark:text-gray-300">جاري التحقق من إشعارات الجوال...</span>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-200 dark:border-amber-800 p-5 text-sm text-amber-800 dark:text-amber-200">
        إشعارات الجوال غير مفعّلة على الخادم حالياً. تواصل مع الدعم.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 md:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-brand/10 border border-brand/20 shrink-0">
          <Smartphone className="text-brand" size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-gray-900 dark:text-white text-lg">إشعارات الجوال (PWA)</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">
            استقبل تنبيهات فورية عند طلب جديد أو تصعيد بشري حتى لو كان التطبيق في الخلفية.
          </p>
        </div>
      </div>

      {status === 'unsupported' && (
        <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 border border-amber-200 dark:border-amber-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>
            هذا المتصفح لا يدعم Web Push. على آيفون استخدم Safari ثم «إضافة إلى الشاشة الرئيسية»، ثم افتح التطبيق من الأيقونة وفعّل الإشعارات.
          </span>
        </div>
      )}

      {status === 'denied' && (
        <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-xl p-3 border border-red-200 dark:border-red-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>تم حظر الإشعارات لهذا الموقع. افتح إعدادات المتصفح/الجهاز واسمح بالإشعارات لـ xo-bot.com.</span>
        </div>
      )}

      {!standalone && status !== 'unsupported' && (
        <div className="flex flex-wrap items-center gap-3">
          <InstallAppButton variant="card" />
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            ثبّت التطبيق ثم فعّل الإشعارات لاستقبال التنبيهات في الخلفية.
          </p>
        </div>
      )}

      {standalone && (
        <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-300">
          <CheckCircle size={14} />
          التطبيق يعمل بوضع الشاشة الرئيسية
        </div>
      )}

      {message && (
        <p className="text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-900/40 rounded-xl px-3 py-2">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {status === 'subscribed' ? (
          <>
            <button
              type="button"
              onClick={handleTest}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white text-sm font-bold hover:bg-brand-600 disabled:opacity-50 transition-colors"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              إرسال إشعار تجريبي
            </button>
            <button
              type="button"
              onClick={handleDisable}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-bold hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              إيقاف على هذا الجهاز
            </button>
          </>
        ) : status !== 'unsupported' && status !== 'denied' ? (
          <button
            type="button"
            onClick={handleEnable}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white text-sm font-bold hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <BellRing size={16} />}
            تفعيل إشعارات الجوال
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default PushNotificationSetup;
