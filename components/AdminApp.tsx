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

interface AdminAppProps {
  onLogout: () => void;
}

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
    <AdminNotificationProvider>
      <AdminAppContent currentView={currentView} onLogout={onLogout} />
    </AdminNotificationProvider>
  );
};

export default AdminApp;
