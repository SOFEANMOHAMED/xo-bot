import React, { useEffect, useState } from 'react';
import { AlertCircle, Clock, TrendingDown, Users, DollarSign, X, CheckCircle } from 'lucide-react';
import apiService from '../../services/api';
import { logger } from '../../utils/logger';
import { useAdminNotifications } from './AdminNotificationContext';
import { AdminStats } from '../../types';

interface Alert {
  id: string;
  type: 'warning' | 'error' | 'info' | 'success';
  title: string;
  message: string;
  priority: 'high' | 'medium' | 'low';
  timestamp: Date;
  actionUrl?: string;
  actionLabel?: string;
}

const AdminAlerts: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { showError } = useAdminNotifications();

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        setIsLoading(true);
        const stats = await apiService.getAdminStats();
        const newAlerts: Alert[] = [];

        // Check for trials ending soon
        if (stats.trialsEndingSoon > 0) {
          newAlerts.push({
            id: 'trials-ending',
            type: 'warning',
            title: 'تجارب تنتهي قريباً',
            message: `يوجد ${stats.trialsEndingSoon} تجربة مجانية ستنتهي خلال 7 أيام`,
            priority: 'high',
            timestamp: new Date(),
            actionUrl: '#trials',
            actionLabel: 'عرض التفاصيل'
          });
        }

        // Check for high churn rate
        if (stats.churnRate > 10) {
          newAlerts.push({
            id: 'high-churn',
            type: 'error',
            title: 'معدل إلغاء مرتفع',
            message: `معدل الإلغاء ${stats.churnRate.toFixed(1)}% - أعلى من المتوسط`,
            priority: 'high',
            timestamp: new Date(),
            actionUrl: '#subscriptions',
            actionLabel: 'مراجعة الباقات'
          });
        }

        // Check for low conversion rate
        if (stats.conversionRate < 5 && stats.totalUsers > 10) {
          newAlerts.push({
            id: 'low-conversion',
            type: 'warning',
            title: 'معدل تحويل منخفض',
            message: `معدل التحويل ${stats.conversionRate.toFixed(1)}% - يحتاج تحسين`,
            priority: 'medium',
            timestamp: new Date(),
            actionUrl: '#subscriptions',
            actionLabel: 'تحسين الباقات'
          });
        }

        // Check for low ARPU
        if (stats.arpu < 20 && stats.paidSubscriptions > 0) {
          newAlerts.push({
            id: 'low-arpu',
            type: 'info',
            title: 'متوسط إيراد منخفض',
            message: `ARPU: ${stats.arpu.toFixed(2)}$ - يمكن تحسينه`,
            priority: 'medium',
            timestamp: new Date(),
            actionUrl: '#subscriptions',
            actionLabel: 'مراجعة الأسعار'
          });
        }

        // Success alerts
        if (stats.newUsersToday > 5) {
          newAlerts.push({
            id: 'new-users-today',
            type: 'success',
            title: 'نمو جيد اليوم',
            message: `${stats.newUsersToday} مستخدم جديد اليوم`,
            priority: 'low',
            timestamp: new Date()
          });
        }

        setAlerts(newAlerts.sort((a, b) => {
          const priorityOrder = { high: 3, medium: 2, low: 1 };
          return priorityOrder[b.priority] - priorityOrder[a.priority];
        }));
      } catch (err: any) {
        logger.error('Failed to fetch alerts:', err);
        showError('فشل تحميل التنبيهات');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAlerts();
    // Refresh alerts every 5 minutes
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const getAlertIcon = (type: Alert['type']) => {
    switch (type) {
      case 'warning':
        return <AlertCircle className="text-orange-400" size={20} />;
      case 'error':
        return <AlertCircle className="text-red-400" size={20} />;
      case 'info':
        return <AlertCircle className="text-blue-400" size={20} />;
      case 'success':
        return <CheckCircle className="text-green-400" size={20} />;
    }
  };

  const getAlertBgColor = (type: Alert['type']) => {
    switch (type) {
      case 'warning':
        return 'bg-orange-900/20 border-orange-500/50';
      case 'error':
        return 'bg-red-900/20 border-red-500/50';
      case 'info':
        return 'bg-blue-900/20 border-blue-500/50';
      case 'success':
        return 'bg-green-900/20 border-green-500/50';
    }
  };

  const getPriorityBadge = (priority: Alert['priority']) => {
    const colors = {
      high: 'bg-red-500 text-white',
      medium: 'bg-orange-500 text-white',
      low: 'bg-blue-500 text-white'
    };
    const labels = {
      high: 'عالي',
      medium: 'متوسط',
      low: 'منخفض'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-bold ${colors[priority]}`}>
        {labels[priority]}
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">لوحة التنبيهات</h2>
          <p className="text-sm text-slate-400">متابعة الأحداث المهمة والتنبيهات</p>
        </div>
        <div className="text-sm text-slate-400">
          {alerts.length} تنبيه
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="bg-slate-800 rounded-2xl p-12 border border-slate-700 text-center">
          <CheckCircle className="text-green-400 mx-auto mb-4" size={48} />
          <h3 className="text-lg font-bold text-white mb-2">لا توجد تنبيهات</h3>
          <p className="text-slate-400">كل شيء يعمل بشكل طبيعي</p>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`bg-slate-800 rounded-2xl p-4 lg:p-6 border ${getAlertBgColor(alert.type)} transition-all hover:shadow-lg`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 flex-1">
                  <div className="p-2 bg-slate-900/50 rounded-lg flex-shrink-0">
                    {getAlertIcon(alert.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-bold text-white">{alert.title}</h3>
                      {getPriorityBadge(alert.priority)}
                    </div>
                    <p className="text-slate-300 mb-3">{alert.message}</p>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <div className="flex items-center gap-1">
                        <Clock size={14} />
                        <span>{alert.timestamp.toLocaleString('ar-SA-u-nu-latn')}</span>
                      </div>
                    </div>
                    {alert.actionUrl && alert.actionLabel && (
                      <button
                        onClick={() => {
                          const event = new CustomEvent('admin-navigate', { detail: { view: alert.actionUrl?.replace('#', '').toUpperCase() } });
                          window.dispatchEvent(event);
                        }}
                        className="mt-3 text-sm text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1"
                      >
                        {alert.actionLabel}
                        <span>→</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminAlerts;

