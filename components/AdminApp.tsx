import React from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AdminView } from '../types';
import { adminPath, adminViewFromSlug, isKnownAdminSlug } from '../routes/paths';
import AdminLayout from './AdminLayout';
import AdminOverview from './admin/AdminOverview';
import AdminUsers from './admin/AdminUsers';
import AdminAnalytics from './admin/AdminAnalytics';
import AdminSystem from './admin/AdminSystem';
import AdminNotifications from './admin/AdminNotifications';
import AdminEmailBroadcast from './admin/AdminEmailBroadcast';
import AdminUserNotifications from './admin/AdminUserNotifications';
import AdminAlerts from './admin/AdminAlerts';
import AdminPages from './admin/AdminPages';
import AdminSupportTickets from './admin/AdminSupportTickets';
import AdminPaymentRequests from './admin/AdminPaymentRequests';
import NotificationContainer from './Notification';
import { AdminNotificationProvider, useAdminNotifications } from './admin/AdminNotificationContext';
import apiService from '../services/api';
import { Lock, Loader2 } from 'lucide-react';
import SeoHead from './SeoHead';

interface AdminAppProps {
  onLogout: () => void;
}

const AdminGateUnlock: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [checking, setChecking] = React.useState(true);
  const [unlocked, setUnlocked] = React.useState(false);
  const [secret, setSecret] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await apiService.getAdminGateStatus();
        if (!cancelled) setUnlocked(Boolean(status.unlocked));
      } catch {
        if (!cancelled) setUnlocked(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiService.unlockAdminGate(secret.trim());
      setUnlocked(true);
      setSecret('');
    } catch {
      setError('تعذر فتح البوابة. تحقق من السر وحاول مجدداً.');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-300 gap-2">
        <Loader2 className="animate-spin" size={20} />
        جاري التحقق...
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <form
          onSubmit={handleUnlock}
          className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2 text-white font-bold text-lg">
            <Lock size={18} className="text-indigo-400" />
            فتح لوحة الإدارة
          </div>
          <p className="text-sm text-slate-400">
            أدخل سر بوابة الأدمن مرة واحدة لهذه الجلسة. لا يُخزَّن في الواجهة بعد الإرسال.
          </p>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoFocus
            required
            className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 text-white"
            placeholder="سر بوابة الإدارة"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !secret.trim()}
            className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-3"
          >
            {submitting ? 'جاري الفتح...' : 'فتح البوابة'}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
};

const AdminAppContent: React.FC<AdminAppProps & { currentView: AdminView }> = ({
  currentView,
  onLogout,
}) => {
  const navigate = useNavigate();
  const { notifications, removeNotification } = useAdminNotifications();

  React.useEffect(() => {
    const handleNavigate = (event: CustomEvent) => {
      const view = event.detail?.view;
      if (view && Object.values(AdminView).includes(view as AdminView)) {
        navigate(adminPath(view as AdminView));
      }
    };

    window.addEventListener('admin-navigate' as any, handleNavigate as EventListener);
    return () => {
      window.removeEventListener('admin-navigate' as any, handleNavigate as EventListener);
    };
  }, [navigate]);

  const renderContent = () => {
    switch (currentView) {
      case AdminView.OVERVIEW:
        return <AdminOverview />;
      case AdminView.USERS:
        return <AdminUsers />;
      case AdminView.TRIALS:
        return <AdminUsers filterByTrial={true} />;
      case AdminView.SUBSCRIPTIONS:
      case AdminView.USAGE:
      case AdminView.AFFILIATE_PROGRAM:
        return <AdminAnalytics view={currentView} />;
      case AdminView.SETTINGS:
      case AdminView.LOGS:
        return <AdminSystem view={currentView} />;
      case AdminView.NOTIFICATIONS:
        return <AdminNotifications />;
      case AdminView.EMAIL_BROADCAST:
        return <AdminEmailBroadcast />;
      case AdminView.USER_NOTIFICATIONS:
        return <AdminUserNotifications />;
      case AdminView.ALERTS:
        return <AdminAlerts />;
      case AdminView.PAGES:
        return <AdminPages />;
      case AdminView.SUPPORT_TICKETS:
        return <AdminSupportTickets />;
      case AdminView.PAYMENT_REQUESTS:
        return <AdminPaymentRequests />;
      default:
        return <AdminOverview />;
    }
  };

  return (
    <>
      <SeoHead title="لوحة الإدارة" noindex />
      <AdminLayout currentView={currentView} onLogout={onLogout}>
        {renderContent()}
      </AdminLayout>
      <NotificationContainer notifications={notifications} onClose={removeNotification} />
    </>
  );
};

const AdminApp: React.FC<AdminAppProps> = ({ onLogout }) => {
  const { viewSlug } = useParams<{ viewSlug: string }>();

  if (viewSlug && !isKnownAdminSlug(viewSlug)) {
    return <Navigate to={adminPath(AdminView.OVERVIEW)} replace />;
  }

  const currentView = adminViewFromSlug(viewSlug);

  return (
    <AdminGateUnlock>
      <AdminNotificationProvider>
        <AdminAppContent currentView={currentView} onLogout={onLogout} />
      </AdminNotificationProvider>
    </AdminGateUnlock>
  );
};

export default AdminApp;
