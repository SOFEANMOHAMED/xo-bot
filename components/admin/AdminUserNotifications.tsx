
import React, { useState, useEffect } from 'react';
import { Bell, Send, Users, Loader2, CheckCircle, XCircle, AlertCircle, Info } from 'lucide-react';
import apiService from '../../services/api';
import { useAdminNotifications } from './AdminNotificationContext';
import { validateRequired } from '../../utils/validation';
import { handleApiError } from '../../utils/errorHandler';

interface NotificationRequest {
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  recipientType: 'all' | 'active' | 'trial' | 'paid' | 'custom';
  customUserIds?: string[];
  data?: any;
}

const AdminUserNotifications: React.FC = () => {
  const [formData, setFormData] = useState<NotificationRequest>({
    title: '',
    message: '',
    type: 'info',
    recipientType: 'all',
    customUserIds: [],
    data: {}
  });
  const [customUserIdInput, setCustomUserIdInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [sendResult, setSendResult] = useState<{
    success: boolean;
    sent: number;
    failed: number;
    errors?: string[];
  } | null>(null);
  const { showSuccess, showError, showInfo } = useAdminNotifications();

  const [errors, setErrors] = useState<{
    title?: string;
    message?: string;
    customUserIds?: string;
  }>({});

  // Fetch recipient count when recipient type changes
  useEffect(() => {
    const fetchRecipientCount = async () => {
      // Custom recipients are counted locally — backend has no DB query for them
      if (formData.recipientType === 'custom') {
        setRecipientCount(formData.customUserIds?.length ?? 0);
        return;
      }

      try {
        const count = await apiService.getNotificationRecipientCount(formData.recipientType);
        setRecipientCount(count);
      } catch (error) {
        console.error('Error fetching recipient count:', error);
        setRecipientCount(null);
      }
    };

    fetchRecipientCount();
  }, [formData.recipientType, formData.customUserIds]);

  const validateForm = (): boolean => {
    const newErrors: typeof errors = {};

    if (!validateRequired(formData.title)) {
      newErrors.title = 'العنوان مطلوب';
    }

    if (!validateRequired(formData.message)) {
      newErrors.message = 'الرسالة مطلوبة';
    }

    if (formData.recipientType === 'custom') {
      if (!formData.customUserIds || formData.customUserIds.length === 0) {
        newErrors.customUserIds = 'يجب إضافة معرف مستخدم واحد على الأقل';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAddCustomUserId = () => {
    if (!customUserIdInput.trim()) return;

    const userId = customUserIdInput.trim();
    if (formData.customUserIds?.includes(userId)) {
      showInfo('هذا المستخدم موجود بالفعل');
      return;
    }

    setFormData(prev => ({
      ...prev,
      customUserIds: [...(prev.customUserIds || []), userId]
    }));
    setCustomUserIdInput('');
  };

  const handleRemoveCustomUserId = (userId: string) => {
    setFormData(prev => ({
      ...prev,
      customUserIds: prev.customUserIds?.filter(id => id !== userId) || []
    }));
  };

  const handleSend = async () => {
    if (!validateForm()) {
      showError('يرجى تصحيح الأخطاء في النموذج');
      return;
    }

    setIsSending(true);
    setSendResult(null);

    try {
      const result = await apiService.sendUserNotification(formData);
      setSendResult(result);
      
      if (result.success && result.sent > 0) {
        showSuccess(`تم إرسال ${result.sent} إشعار بنجاح`);
        // Reset form
        setFormData({
          title: '',
          message: '',
          type: 'info',
          recipientType: 'all',
          customUserIds: [],
          data: {}
        });
        setCustomUserIdInput('');
        setRecipientCount(null);
      } else if (result.failed > 0) {
        showError(`فشل إرسال ${result.failed} إشعار`);
      }
    } catch (error) {
      const errorMessage = handleApiError(error);
      showError(errorMessage || 'حدث خطأ أثناء إرسال الإشعار');
      setSendResult({
        success: false,
        sent: 0,
        failed: recipientCount || 0,
        errors: [errorMessage || 'خطأ غير معروف']
      });
    } finally {
      setIsSending(false);
    }
  };

  const typeIcons = {
    info: Info,
    success: CheckCircle,
    warning: AlertCircle,
    error: XCircle
  };

  const typeColors = {
    info: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    success: 'text-green-400 bg-green-500/10 border-green-500/20',
    warning: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    error: 'text-red-400 bg-red-500/10 border-red-500/20'
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-3 bg-indigo-500/10 rounded-lg">
            <Bell className="text-indigo-400" size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">إرسال إشعارات للمستخدمين</h2>
            <p className="text-slate-400 text-sm">أرسل إشعارات تظهر في لوحة تحكم المستخدمين</p>
          </div>
        </div>
      </div>

      {/* Send Result */}
      {sendResult && (
        <div className={`rounded-xl p-4 border ${
          sendResult.success 
            ? 'bg-green-500/10 border-green-500/20' 
            : 'bg-red-500/10 border-red-500/20'
        }`}>
          <div className="flex items-start gap-3">
            {sendResult.success ? (
              <CheckCircle className="text-green-400 flex-shrink-0 mt-0.5" size={20} />
            ) : (
              <XCircle className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
            )}
            <div className="flex-1">
              <p className={`font-semibold mb-1 ${
                sendResult.success ? 'text-green-400' : 'text-red-400'
              }`}>
                {sendResult.success ? 'تم الإرسال بنجاح' : 'فشل الإرسال'}
              </p>
              <div className="text-sm text-slate-300 space-y-1">
                <p>تم الإرسال: {sendResult.sent}</p>
                <p>فشل: {sendResult.failed}</p>
                {sendResult.errors && sendResult.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="text-red-400 font-medium">الأخطاء:</p>
                    <ul className="list-disc list-inside space-y-1">
                      {sendResult.errors.map((error, idx) => (
                        <li key={idx} className="text-red-300">{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Form */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 space-y-6">
        {/* Recipient Type */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-3">
            نوع المستلمين
          </label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { value: 'all', label: 'جميع المشتركين', icon: Users },
              { value: 'active', label: 'المشتركين النشطين', icon: CheckCircle },
              { value: 'trial', label: 'المستخدمين في التجربة', icon: AlertCircle },
              { value: 'paid', label: 'المشتركين المدفوعين', icon: CheckCircle },
              { value: 'custom', label: 'مستخدمين محددين', icon: Users }
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, recipientType: value as any }))}
                className={`p-4 rounded-lg border-2 transition-all ${
                  formData.recipientType === value
                    ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400'
                    : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600'
                }`}
              >
                <Icon size={20} className="mb-2 mx-auto" />
                <p className="text-sm font-medium">{label}</p>
              </button>
            ))}
          </div>
          {recipientCount !== null && (
            <p className="text-sm text-slate-400 mt-3">
              عدد المستلمين: <span className="text-indigo-400 font-semibold">{recipientCount}</span>
            </p>
          )}
        </div>

        {/* Custom User IDs */}
        {formData.recipientType === 'custom' && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              معرفات المستخدمين (User IDs)
            </label>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={customUserIdInput}
                onChange={(e) => setCustomUserIdInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddCustomUserId()}
                placeholder="أدخل معرف المستخدم (UUID)"
                className="flex-1 px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleAddCustomUserId}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
              >
                إضافة
              </button>
            </div>
            {errors.customUserIds && (
              <p className="text-red-400 text-sm mb-2">{errors.customUserIds}</p>
            )}
            {formData.customUserIds && formData.customUserIds.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.customUserIds.map((userId) => (
                  <div
                    key={userId}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg"
                  >
                    <span className="text-sm text-slate-300 font-mono">{userId.substring(0, 8)}...</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomUserId(userId)}
                      className="text-red-400 hover:text-red-300"
                    >
                      <XCircle size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Notification Type */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-3">
            نوع الإشعار
          </label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(['info', 'success', 'warning', 'error'] as const).map((type) => {
              const Icon = typeIcons[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, type }))}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    formData.type === type
                      ? `${typeColors[type]} border-current`
                      : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <Icon size={20} className="mb-2 mx-auto" />
                  <p className="text-sm font-medium capitalize">
                    {type === 'info' ? 'معلومات' : 
                     type === 'success' ? 'نجاح' :
                     type === 'warning' ? 'تحذير' : 'خطأ'}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            عنوان الإشعار <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
            placeholder="مثال: تحديث جديد على المنصة"
            className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            maxLength={200}
          />
          {errors.title && (
            <p className="text-red-400 text-sm mt-1">{errors.title}</p>
          )}
        </div>

        {/* Message */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            محتوى الإشعار <span className="text-red-400">*</span>
          </label>
          <textarea
            value={formData.message}
            onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
            placeholder="اكتب محتوى الإشعار هنا..."
            rows={6}
            className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-y"
          />
          {errors.message && (
            <p className="text-red-400 text-sm mt-1">{errors.message}</p>
          )}
        </div>

        {/* Send Button */}
        <div className="flex items-center justify-end gap-4 pt-4 border-t border-slate-700">
          <button
            onClick={handleSend}
            disabled={isSending}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-semibold hover:shadow-lg hover:shadow-indigo-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                <span>جاري الإرسال...</span>
              </>
            ) : (
              <>
                <Send size={20} />
                <span>إرسال الإشعار</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminUserNotifications;

