import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Link2, Unlink, Loader2, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react';
import apiService from '../../services/api';
import { useAdminNotifications } from './AdminNotificationContext';
import { useAdminOtpPairing } from '../../hooks/useAdminOtpPairing';
import { logger } from '../../utils/logger';

const ToggleItem: React.FC<{
  label: string;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}> = ({ label, enabled, onToggle, disabled }) => (
  <button
    type="button"
    onClick={onToggle}
    disabled={disabled}
    className="flex items-center gap-2 text-sm disabled:opacity-50"
  >
    <span className="text-slate-300">{label}</span>
    {enabled ? (
      <ToggleRight className="text-emerald-400" size={28} />
    ) : (
      <ToggleLeft className="text-slate-500" size={28} />
    )}
  </button>
);

const AdminOtpSetup: React.FC = () => {
  const { showSuccess, showError } = useAdminNotifications();
  const [status, setStatus] = useState<{
    connected: boolean;
    status: string;
    phoneNumber: string | null;
    signupOtpEnabled: boolean;
  } | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await apiService.getAdminOtpStatus();
      setStatus(data);
    } catch (err) {
      logger.error('Failed to fetch OTP status', err);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useAdminOtpPairing({
    enabled: showQrModal && !status?.connected,
    onEvent: (event) => {
      if (event.type === 'qr') {
        setQrDataUrl(event.qrDataUrl);
        setIsPairing(false);
        setPairingError(null);
      } else if (event.type === 'status') {
        if (event.status === 'connected') {
          setShowQrModal(false);
          setQrDataUrl(null);
          setIsPairing(false);
          refreshStatus();
          showSuccess('تم ربط واتساب OTP بنجاح');
        }
      } else if (event.type === 'error') {
        setPairingError(event.message);
        setIsPairing(false);
      }
    },
  });

  const handleStartPairing = async () => {
    setPairingError(null);
    setQrDataUrl(null);
    setIsPairing(true);
    setShowQrModal(true);
    try {
      await apiService.startAdminOtpWhatsAppPairing();
    } catch (err: any) {
      setPairingError(err?.message || 'فشل بدء الربط');
      setIsPairing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('قطع ربط واتساب OTP؟ لن يُرسل رموز التحقق حتى تربط الرقم مجدداً.')) return;
    setIsDisconnecting(true);
    try {
      await apiService.disconnectAdminOtpWhatsApp();
      await apiService.updateAdminOtpSettings(false);
      await refreshStatus();
      showSuccess('تم قطع ربط واتساب OTP');
    } catch (err: any) {
      showError(err?.message || 'فشل قطع الربط');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleToggleOtp = async () => {
    if (!status) return;
    const next = !status.signupOtpEnabled;
    if (next && !status.connected) {
      showError('يجب ربط واتساب أولاً قبل تفعيل OTP');
      return;
    }
    setIsToggling(true);
    try {
      const result = await apiService.updateAdminOtpSettings(next);
      setStatus((prev) =>
        prev ? { ...prev, signupOtpEnabled: result.signupOtpEnabled } : prev
      );
      showSuccess(next ? 'تم تفعيل OTP عند التسجيل' : 'تم إيقاف OTP عند التسجيل');
    } catch (err: any) {
      showError(err?.message || 'فشل تحديث الإعداد');
    } finally {
      setIsToggling(false);
    }
  };

  const connected = status?.connected ?? false;

  return (
    <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-700 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <MessageSquare size={20} className="text-green-400" />
            OTP عند التسجيل (واتساب)
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            اربط رقمك الشخصي عبر QR لإرسال رمز التحقق عند إنشاء حساب جديد (بريد أو Google).
            لا يؤثر على واتساب التجار.
          </p>
        </div>
        <ToggleItem
          label="تفعيل OTP"
          enabled={status?.signupOtpEnabled ?? false}
          onToggle={handleToggleOtp}
          disabled={isToggling}
        />
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-300">
            الحالة:{' '}
            <span className={connected ? 'text-green-400 font-semibold' : 'text-slate-400'}>
              {connected ? 'متصل' : 'غير متصل'}
            </span>
          </p>
          {status?.phoneNumber && (
            <p className="text-xs text-slate-500 mt-1" dir="ltr">
              {status.phoneNumber}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-800/60 text-red-300 hover:bg-red-950/40 text-sm disabled:opacity-60"
            >
              {isDisconnecting ? <Loader2 size={16} className="animate-spin" /> : <Unlink size={16} />}
              قطع الربط
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartPairing}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium"
            >
              <Link2 size={16} />
              ربط عبر QR
            </button>
          )}
          <button
            type="button"
            onClick={() => refreshStatus()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-700/50"
          >
            <RefreshCw size={16} />
            تحديث
          </button>
        </div>
      </div>

      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full text-center space-y-4">
            <h4 className="text-white font-bold">امسح رمز QR من واتساب</h4>
            <p className="text-xs text-slate-400">
              من تطبيق واتساب على هاتفك: الإعدادات → الأجهزة المرتبطة → ربط جهاز
            </p>
            {isPairing && !qrDataUrl && (
              <div className="flex justify-center py-8">
                <Loader2 className="animate-spin text-green-400" size={32} />
              </div>
            )}
            {qrDataUrl && (
              <img src={qrDataUrl} alt="WhatsApp QR" className="mx-auto rounded-lg bg-white p-2" />
            )}
            {pairingError && (
              <p className="text-sm text-red-400">{pairingError}</p>
            )}
            <button
              type="button"
              onClick={() => {
                setShowQrModal(false);
                setQrDataUrl(null);
                setPairingError(null);
                setIsPairing(false);
              }}
              className="w-full py-2 rounded-lg border border-slate-600 text-slate-300 text-sm"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminOtpSetup;
