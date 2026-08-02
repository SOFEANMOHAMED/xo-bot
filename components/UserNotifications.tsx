
import React, { useEffect, useState } from 'react';
import { Bell, X, CheckCircle, AlertCircle, Info, XCircle, CheckCheck, Calendar } from 'lucide-react';
import apiService from '../services/api';
import { logger } from '../utils/logger';

interface UserNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  data: any;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
}

const UserNotifications: React.FC = () => {
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const fetchNotifications = async () => {
    setIsLoading(true);
    try {
      const data = await apiService.getUserNotifications(showUnreadOnly);
      setNotifications(data.map((n: any) => ({
        ...n,
        createdAt: new Date(n.createdAt),
        readAt: n.readAt ? new Date(n.readAt) : null
      })));
    } catch (err: any) {
      logger.error('Failed to fetch notifications:', err);
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
      await apiService.markUserNotificationAsRead(id);
      setNotifications(prev => prev.map(n => 
        n.id === id ? { ...n, isRead: true, readAt: new Date() } : n
      ));
    } catch (err: any) {
      logger.error('Failed to mark notification as read:', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await apiService.markAllUserNotificationsAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true, readAt: new Date() })));
    } catch (err: any) {
      logger.error('Failed to mark all notifications as read:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiService.deleteUserNotification(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch (err: any) {
      logger.error('Failed to delete notification:', err);
    }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const typeIcons = {
    info: Info,
    success: CheckCircle,
    warning: AlertCircle,
    error: XCircle
  };

  const typeColors = {
    info: {
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      border: 'border-blue-200 dark:border-blue-800',
      text: 'text-blue-800 dark:text-blue-200',
      icon: 'text-blue-600 dark:text-blue-400'
    },
    success: {
      bg: 'bg-green-50 dark:bg-green-900/20',
      border: 'border-green-200 dark:border-green-800',
      text: 'text-green-800 dark:text-green-200',
      icon: 'text-green-600 dark:text-green-400'
    },
    warning: {
      bg: 'bg-yellow-50 dark:bg-yellow-900/20',
      border: 'border-yellow-200 dark:border-yellow-800',
      text: 'text-yellow-800 dark:text-yellow-200',
      icon: 'text-yellow-600 dark:text-yellow-400'
    },
    error: {
      bg: 'bg-red-50 dark:bg-red-900/20',
      border: 'border-red-200 dark:border-red-800',
      text: 'text-red-800 dark:text-red-200',
      icon: 'text-red-600 dark:text-red-400'
    }
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'الآن';
    if (minutes < 60) return `منذ ${minutes} دقيقة`;
    if (hours < 24) return `منذ ${hours} ساعة`;
    if (days < 7) return `منذ ${days} يوم`;
    return date.toLocaleDateString('ar-SA-u-nu-latn');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="bg-brand rounded-3xl p-6 text-white relative overflow-hidden shadow-xl">
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden opacity-20">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand rounded-full blur-[100px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-brand rounded-full blur-[100px]"></div>
        </div>
        
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
              <Bell size={28} />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-1">الإشعارات</h2>
              <p className="text-brand-100">
                {unreadCount > 0 ? `${unreadCount} إشعار غير مقروء` : 'لا توجد إشعارات غير مقروءة'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowUnreadOnly(!showUnreadOnly)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                showUnreadOnly
                  ? 'bg-white text-brand'
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
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand"></div>
        </div>
      ) : notifications.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-12 text-center border border-gray-200 dark:border-gray-700">
          <Bell size={48} className="mx-auto text-gray-400 dark:text-gray-500 mb-4" />
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            {showUnreadOnly ? 'لا توجد إشعارات غير مقروءة' : 'لا توجد إشعارات'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {notifications.map((notification) => {
            const Icon = typeIcons[notification.type];
            const colors = typeColors[notification.type];
            return (
              <div
                key={notification.id}
                className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border transition-colors ${
                  notification.isRead
                    ? 'border-gray-200 dark:border-gray-700'
                    : `${colors.border} ${colors.bg}`
                }`}
              >
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-start gap-4 flex-1">
                      <div className={`p-3 ${colors.bg} rounded-xl border ${colors.border}`}>
                        <Icon size={24} className={colors.icon} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className={`font-bold text-lg ${colors.text}`}>
                            {notification.title}
                          </h3>
                          {!notification.isRead && (
                            <span className="px-2 py-0.5 bg-brand text-white text-xs font-bold rounded-full">
                              جديد
                            </span>
                          )}
                        </div>
                        <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-3">
                          {notification.message}
                        </p>
                        <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                          <span className="flex items-center gap-1">
                            <Calendar size={14} />
                            {formatDate(notification.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      {!notification.isRead && (
                        <button
                          onClick={() => handleMarkAsRead(notification.id)}
                          className="p-2 text-gray-400 hover:text-brand dark:hover:text-brand transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                          title="تحديد كمقروء"
                        >
                          <CheckCircle size={20} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(notification.id)}
                        className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                        title="حذف"
                      >
                        <X size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default UserNotifications;

