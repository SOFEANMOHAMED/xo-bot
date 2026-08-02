
import React, { useEffect, useState } from 'react';
import { Bell, X, CheckCircle, DollarSign, User, Calendar, CheckCheck } from 'lucide-react';
import apiService from '../../services/api';
import { useAdminNotifications } from './AdminNotificationContext';
import { logger } from '../../utils/logger';

interface AdminNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  data: any;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
}

const AdminNotifications: React.FC = () => {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const { showSuccess, showError } = useAdminNotifications();

  const fetchNotifications = async () => {
    setIsLoading(true);
    try {
      const data = await apiService.getAdminNotifications(showUnreadOnly);
      setNotifications(data.map((n: any) => ({
        ...n,
        createdAt: new Date(n.createdAt),
        readAt: n.readAt ? new Date(n.readAt) : null
      })));
    } catch (err: any) {
      logger.error('Failed to fetch notifications:', err);
      showError('فشل تحميل الإشعارات: ' + (err.message || 'خطأ غير معروف'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
    // Refresh every 30 seconds
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [showUnreadOnly]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await apiService.markNotificationAsRead(id);
      setNotifications(prev => prev.map(n => 
        n.id === id ? { ...n, isRead: true, readAt: new Date() } : n
      ));
      showSuccess('تم تحديد الإشعار كمقروء');
    } catch (err: any) {
      showError('فشل تحديث الإشعار: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await apiService.markAllNotificationsAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true, readAt: new Date() })));
      showSuccess('تم تحديد جميع الإشعارات كمقروءة');
    } catch (err: any) {
      showError('فشل تحديث الإشعارات: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-900 to-purple-900 rounded-3xl p-6 text-white relative overflow-hidden shadow-xl">
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden opacity-20">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500 rounded-full blur-[100px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500 rounded-full blur-[100px]"></div>
        </div>
        
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
              <Bell size={28} />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-1">الإشعارات</h2>
              <p className="text-indigo-200">
                {unreadCount > 0 ? `${unreadCount} إشعار غير مقروء` : 'لا توجد إشعارات غير مقروءة'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowUnreadOnly(!showUnreadOnly)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                showUnreadOnly
                  ? 'bg-white text-indigo-900'
                  : 'bg-white/10 backdrop-blur-md border border-white/20 text-white hover:bg-white/20'
              }`}
            >
              {showUnreadOnly ? 'عرض الكل' : 'غير المقروءة فقط'}
            </button>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                className="px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-xl text-sm font-bold hover:bg-white/20 transition-colors flex items-center gap-2"
              >
                <CheckCheck size={16} />
                تحديد الكل كمقروء
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Notifications List */}
      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : notifications.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-12 text-center">
          <Bell size={48} className="mx-auto text-gray-400 dark:text-gray-500 mb-4" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">لا توجد إشعارات</h3>
          <p className="text-gray-500 dark:text-gray-400">
            {showUnreadOnly ? 'لا توجد إشعارات غير مقروءة' : 'لم يتم إرسال أي إشعارات بعد'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border transition-colors ${
                notification.isRead
                  ? 'border-gray-100 dark:border-gray-700'
                  : 'border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/10'
              }`}
            >
              <div className="p-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-start gap-4 flex-1">
                    {notification.type === 'withdrawal_request' && (
                      <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-xl">
                        <DollarSign size={24} className="text-green-600 dark:text-green-400" />
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                          {notification.title}
                        </h3>
                        {!notification.isRead && (
                          <span className="px-2 py-0.5 bg-indigo-600 text-white text-xs font-bold rounded-full">
                            جديد
                          </span>
                        )}
                      </div>
                      <p className="text-gray-600 dark:text-gray-300 mb-3">
                        {notification.message}
                      </p>
                      {notification.type === 'withdrawal_request' && notification.data && (
                        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 space-y-2">
                          <div className="flex items-center gap-2 text-sm">
                            <User size={16} className="text-gray-500 dark:text-gray-400" />
                            <span className="text-gray-700 dark:text-gray-300">
                              <strong>المسوق:</strong> {notification.data.merchantName || notification.data.merchantEmail}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <DollarSign size={16} className="text-gray-500 dark:text-gray-400" />
                            <span className="text-gray-700 dark:text-gray-300">
                              <strong>المبلغ:</strong> {notification.data.amount}$
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar size={16} className="text-gray-500 dark:text-gray-400" />
                            <span className="text-gray-700 dark:text-gray-300">
                              <strong>التاريخ:</strong> {new Date(notification.data.createdAt).toLocaleString('ar-SA-u-nu-latn')}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {!notification.isRead && (
                    <button
                      onClick={() => handleMarkAsRead(notification.id)}
                      className="p-2 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      title="تحديد كمقروء"
                    >
                      <CheckCircle size={20} />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-700">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {notification.createdAt.toLocaleString('ar-SA-u-nu-latn')}
                  </span>
                  {notification.isRead && notification.readAt && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      مقروء في {notification.readAt.toLocaleString('ar-SA-u-nu-latn')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminNotifications;

