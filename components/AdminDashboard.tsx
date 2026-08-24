
import React from 'react';
import { AdminView } from '../types';
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
import AdminContentPublishing from './admin/AdminContentPublishing';
import NotificationContainer from './Notification';
import { AdminNotificationProvider, useAdminNotifications } from './admin/AdminNotificationContext';

interface AdminDashboardProps {
  currentView: AdminView;
  onChangeView: (view: AdminView) => void;
  onLogout: () => void;
}

const AdminDashboardContent: React.FC<AdminDashboardProps> = ({ currentView, onChangeView, onLogout }) => {
  const { notifications, removeNotification } = useAdminNotifications();

  // Listen for navigation events from child components
  React.useEffect(() => {
    const handleNavigate = (event: CustomEvent) => {
      const view = event.detail?.view;
      if (view && Object.values(AdminView).includes(view as AdminView)) {
        onChangeView(view as AdminView);
      }
    };

    window.addEventListener('admin-navigate' as any, handleNavigate as EventListener);
    return () => {
      window.removeEventListener('admin-navigate' as any, handleNavigate as EventListener);
    };
  }, [onChangeView]);

  const renderContent = () => {
    switch (currentView) {
      case AdminView.OVERVIEW:
        return <AdminOverview />;
      case AdminView.USERS:
        return <AdminUsers />;
      case AdminView.TRIALS:
        return <AdminUsers filterByTrial={true} />; // Reusing Users component with filter
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
      case AdminView.CONTENT_PUBLISHING:
        return <AdminContentPublishing />;
      default:
        return <AdminOverview />;
    }
  };

  return (
    <>
      <AdminLayout 
        currentView={currentView} 
        onChangeView={onChangeView}
        onLogout={onLogout}
      >
        {renderContent()}
      </AdminLayout>
      <NotificationContainer 
        notifications={notifications}
        onClose={removeNotification}
      />
    </>
  );
};

const AdminDashboard: React.FC<AdminDashboardProps> = (props) => {
  return (
    <AdminNotificationProvider>
      <AdminDashboardContent {...props} />
    </AdminNotificationProvider>
  );
};

export default AdminDashboard;
