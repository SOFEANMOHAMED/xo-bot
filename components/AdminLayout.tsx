import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { AdminView } from '../types';
import { adminPath } from '../routes/paths';
import { 
  LayoutDashboard, 
  Users, 
  CreditCard, 
  Activity, 
  Share2, 
  Clock, 
  Settings, 
  FileText,
  LogOut,
  ShieldCheck,
  Menu,
  X,
  Bell,
  Mail,
  AlertTriangle,
  FileText as FileTextIcon,
  Headphones,
  Wallet,
  MessageSquareText,
  Megaphone,
  Inbox
} from 'lucide-react';
import ConfirmDialog from './admin/ConfirmDialog';
import apiService from '../services/api';

interface AdminLayoutProps {
  currentView: AdminView;
  onChangeView?: (view: AdminView) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ currentView, onLogout, children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [inboxUnread, setInboxUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await apiService.getOfficialInboxUnreadCount();
        if (!cancelled) setInboxUnread(data.unreadConversations || 0);
      } catch {
        if (!cancelled) setInboxUnread(0);
      }
    };
    void load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentView]);

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
  };

  const handleConfirmLogout = () => {
    setShowLogoutConfirm(false);
    onLogout();
  };
  
  const navItems = [
    { id: AdminView.OVERVIEW, label: 'نظرة عامة', icon: LayoutDashboard },
    { id: AdminView.USERS, label: 'المستخدمون', icon: Users },
    { id: AdminView.SUBSCRIPTIONS, label: 'الاشتراكات والخطط', icon: CreditCard },
    { id: AdminView.PAYMENT_REQUESTS, label: 'طلبات الدفع', icon: Wallet },
    { id: AdminView.USAGE, label: 'استخدام النظام', icon: Activity },
    { id: AdminView.AFFILIATE_PROGRAM, label: 'التسويق بالعمولة', icon: Share2 },
    { id: AdminView.ACQUISITION, label: 'اكتساب الحملات', icon: Megaphone },
    { id: AdminView.TRIALS, label: 'التجارب المجانية', icon: Clock },
    { id: AdminView.ALERTS, label: 'التنبيهات', icon: AlertTriangle },
    { id: AdminView.PAGES, label: 'إدارة الصفحات', icon: FileTextIcon },
    { id: AdminView.OFFICIAL_PAGE_INBOX, label: 'وارد صفحة XO Bot', icon: Inbox },
    { id: AdminView.OFFICIAL_PAGE_COMMENTS, label: 'تعليقات صفحة XO Bot', icon: MessageSquareText },
    { id: AdminView.SUPPORT_TICKETS, label: 'رسائل الدعم', icon: Headphones },
    { id: AdminView.NOTIFICATIONS, label: 'الإشعارات', icon: Bell },
    { id: AdminView.EMAIL_BROADCAST, label: 'إرسال بريد إلكتروني', icon: Mail },
    { id: AdminView.USER_NOTIFICATIONS, label: 'إرسال إشعارات للمستخدمين', icon: Bell },
    { id: AdminView.SETTINGS, label: 'إعدادات عامة', icon: Settings },
    { id: AdminView.LOGS, label: 'السجلات والأخطاء', icon: FileText },
  ];

  return (
    <div className="flex h-screen bg-slate-900 text-white overflow-hidden dir-rtl font-sans">
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`
        fixed lg:static inset-y-0 right-0
        w-72 bg-slate-950 border-l border-slate-800 
        flex flex-col shadow-2xl z-50
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-4 lg:p-6 flex items-center justify-between lg:justify-start gap-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-600 rounded-lg text-white shadow-lg shadow-red-500/20">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h1 className="font-bold text-lg text-white">لوحة الإدارة العليا</h1>
              <p className="text-xs text-slate-400">Super Admin</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white p-2"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 py-6 px-4 space-y-2 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => (
            <NavLink
              key={item.id}
              to={adminPath(item.id)}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-900/50'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <item.icon size={20} />
              <span className="flex-1">{item.label}</span>
              {item.id === AdminView.OFFICIAL_PAGE_INBOX && inboxUnread > 0 && (
                <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {inboxUnread > 99 ? '99+' : inboxUnread}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button 
            onClick={handleLogoutClick}
            className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-900/20 hover:text-red-300 rounded-xl transition-colors"
            aria-label="خروج من الإدارة"
          >
            <LogOut size={20} aria-hidden="true" />
            <span>خروج من الإدارة</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-slate-900 w-full">
         <header className="bg-slate-950/50 border-b border-slate-800 p-4 lg:p-6 backdrop-blur-sm sticky top-0 z-20">
            <div className="flex items-center justify-between">
              <h2 className="text-xl lg:text-2xl font-bold text-white">
                  {navItems.find(i => i.id === currentView)?.label}
              </h2>
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden text-slate-400 hover:text-white p-2"
              >
                <Menu size={24} />
              </button>
            </div>
         </header>
         <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
            {children}
         </div>
      </main>

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="تأكيد تسجيل الخروج"
        message="هل أنت متأكد من رغبتك في الخروج من لوحة الإدارة؟"
        confirmText="تسجيل الخروج"
        cancelText="إلغاء"
        onConfirm={handleConfirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
        type="warning"
      />
    </div>
  );
};

export default AdminLayout;
