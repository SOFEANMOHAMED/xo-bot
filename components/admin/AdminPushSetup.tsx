/**
 * Enable Web Push on Super Admin devices (PWA / mobile browser).
 */

import React, { useEffect, useState } from 'react';
import { BellRing, Smartphone, CheckCircle, AlertCircle, Loader2, Send } from 'lucide-react';
import apiService from '../../services/api';
import {
  isPushSupported,
  isStandalonePwa,
  registerServiceWorker,
  subscribeToPush,
  unsubscribeFromPush,
  subscriptionToJSON,
  getExistingPushSubscription,
} from '../../utils/webPush';
import { logger } from '../../utils/logger';

type Status = 'idle' | 'loading' | 'subscribed' | 'unsupported' | 'denied' | 'error';

const AdminPushSetup: React.FC = () => {
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
      const server = await apiService.getAdminPushStatus();
      setConfigured(server.configured !== false);

      const localSub = await getExistingPushSubscription();
      if (server.subscribed || localSub) {
        setStatus('subscribed');
      } else {
        setStatus('idle');
      }
    } catch (err: any) {
      logger.error('Failed to load admin push status', err);
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
      const { publicKey } = await apiService.getAdminPushVapidPublicKey();
      const subscription = await subscribeToPush(publicKey);
      await apiService.subscribeAdminPush(subscriptionToJSON(subscription));
      setStatus('subscribed');
      setMessage('تم تفعيل إشعارات الجوال على هذا الجهاز.');
    } catch (err: any) {
      logger.error('Enable admin push failed', err);
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
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
        await apiService.unsubscribeAdminPush(endpoint);
      }
      setStatus('idle');
      setMessage('تم إيقاف إشعارات هذا الجهاز.');
    } catch (err: any) {
      logger.error('Disable admin push failed', err);
      setMessage(err?.message || 'فشل إيقاف الإشعارات');
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await apiService.sendAdminTestPush();
      setMessage('تم إرسال إشعار تجريبي. تحقق من شريط إشعارات الجهاز.');
    } catch (err: any) {
      logger.error('Admin test push failed', err);
      setMessage(err?.message || 'فشل الإشعار التجريبي');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 flex items-center gap-3">
        <Loader2 className="animate-spin text-indigo-400" size={20} />
        <span className="text-sm text-slate-300">جاري التحقق من إشعارات الجوال...</span>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-300">
          <BellRing size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-white text-sm">إشعارات الجوال للسوبر أدمن</h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            فعّل الإشعارات على هذا الجهاز لاستلام رسائل صفحة XO Bot فوراً (حتى واللوحة مغلقة).
            {standalone ? ' · التطبيق مثبت' : ' · يُفضّل تثبيته كـ PWA على الجوال'}
          </p>
        </div>
        {status === 'subscribed' ? (
          <CheckCircle className="text-emerald-400 shrink-0" size={20} />
        ) : status === 'unsupported' || status === 'denied' || status === 'error' ? (
          <AlertCircle className="text-amber-400 shrink-0" size={20} />
        ) : (
          <Smartphone className="text-slate-500 shrink-0" size={20} />
        )}
      </div>

      {!configured && (
        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
          مفاتيح Web Push غير مضبوطة على الخادم (VAPID).
        </p>
      )}

      {status === 'unsupported' && (
        <p className="text-xs text-slate-400">
          هذا المتصفح لا يدعم إشعارات الدفع. استخدم Chrome أو Safari على الجوال بعد تثبيت التطبيق.
        </p>
      )}

      {status === 'denied' && (
        <p className="text-xs text-amber-300">
          تم رفض إذن الإشعارات. افتح إعدادات المتصفح/التطبيق واسمح بالإشعارات لـ xo-bot.com.
        </p>
      )}

      {message && (
        <p className="text-xs text-slate-300 bg-slate-900/60 rounded-xl px-3 py-2">{message}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {status === 'subscribed' ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleTest()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              إشعار تجريبي
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDisable()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50"
            >
              إيقاف على هذا الجهاز
            </button>
          </>
        ) : status !== 'unsupported' && status !== 'denied' ? (
          <button
            type="button"
            disabled={busy || !configured}
            onClick={() => void handleEnable()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />}
            تفعيل إشعارات الجوال
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default AdminPushSetup;
