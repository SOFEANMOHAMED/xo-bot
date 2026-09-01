import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { AppView, DEFAULT_PLAN_CAPABILITIES, type PlanCapabilities } from '../types';
import { appPath, adminPath } from '../routes/paths';
import { AppView, AdminView } from '../types';
import { 
  LayoutDashboard, 
  Package, 
  MessageSquare, 
  Settings, 
  LogOut, 
  Store,
  Link2,
  Moon,
  Sun,
  ShoppingCart,
  Palette,
  Users,
  Briefcase,
  Bell,
  UserCircle,
  BarChart3,
  Menu,
  X,
  Share2,
  Megaphone,
  HelpCircle,
  Bot,
  Inbox,
  ExternalLink
} from 'lucide-react';
import TrialBanner from './TrialBanner';
import ImpersonationBanner from './ImpersonationBanner';
import SubscriptionRenewalBanner from './SubscriptionRenewalBanner';
import SubscriptionModal from './SubscriptionModal';
import TrialExpiredBlock from './TrialExpiredBlock';
import SupportTicketModal from './SupportTicketModal';
import DashboardAssistant from './DashboardAssistant';
import ConfirmDialog from './admin/ConfirmDialog';
import InstallAppButton from './InstallAppButton';
import BrandLogo from './BrandLogo';
import { useAuth } from '../contexts/AuthContext';
import { useSubscriptionCheck } from '../hooks/useSubscriptionCheck';
import apiService from '../services/api';
import { logger } from '../utils/logger';

interface LayoutProps {
  currentView: AppView;
  onChangeView?: (view: AppView) => void;
  children: React.ReactNode;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  onLogout: () => void;
  newOrdersCount?: number;
  planCapabilities?: PlanCapabilities;
}

const Layout: React.FC<LayoutProps> = ({
  currentView,
  onChangeView,
  children,
  isDarkMode,
  toggleDarkMode,
  onLogout,
  newOrdersCount = 0,
  planCapabilities = DEFAULT_PLAN_CAPABILITIES
}) => {
  const navigate = useNavigate();
  const goToView = (view: AppView) => {
    if (onChangeView) onChangeView(view);
    else navigate(appPath(view));
  };
  const { user, exitImpersonation } = useAuth();
  const { isRenewalWarning, subscriptionEndsAt } = useSubscriptionCheck();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
  };

  const handleConfirmLogout = () => {
    setShowLogoutConfirm(false);
    onLogout();
  };

  // Fetch unread notifications count
  useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const notifications = await apiService.getUserNotifications(true);
        setUnreadNotificationsCount(Array.isArray(notifications) ? notifications.length : 0);
      } catch (err: any) {
        logger.error('Failed to fetch unread notifications count:', err);
      }
    };

    if (user) {
      fetchUnreadCount();
      // Refresh every 30 seconds
      const interval = setInterval(fetchUnreadCount, 30000);
      return () => clearInterval(interval);
    }
  }, [user, currentView]); // Refresh when view changes (e.g., when user views notifications)

  const navItems: Array<{
    id: AppView;
    label: string;
    icon: typeof LayoutDashboard;
    badge?: string;
    /** ثابت في القائمة — لا يفتح الصفحة حتى يتوفر الميزة */
    comingSoon?: boolean;
  }> = [
    { id: AppView.DASHBOARD, label: 'لوحة التحكم', icon: LayoutDashboard },
    { id: AppView.INBOX, label: 'صندوق الوارد', icon: Inbox },
    { id: AppView.PRODUCTS, label: 'إدارة المنتجات', icon: Package },
    { id: AppView.ORDERS, label: 'الطلبات', icon: ShoppingCart, badge: newOrdersCount > 0 ? newOrdersCount.toString() : undefined },
    { id: AppView.IMAGE_STUDIO, label: 'ستوديو التصميم', icon: Palette, badge: 'HOT' },
    { id: AppView.ANALYTICS, label: 'التحليلات والتقارير', icon: BarChart3 },
    { id: AppView.INTEGRATIONS, label: 'الربط والتكامل', icon: Link2 },
    { id: AppView.SOCIAL_AUTOMATION, label: 'إدارة التعليقات والمنشورات', icon: Share2 },
    { id: AppView.CONTENT_PUBLISHING, label: 'نشر المحتوى', icon: Megaphone },
    { id: AppView.CRM, label: 'إدارة العملاء', icon: UserCircle },
    { id: AppView.CHAT_TEST, label: 'تجربة البوت', icon: MessageSquare },
    { id: AppView.AFFILIATE, label: 'التسويق بالعمولة', icon: Users, badge: '$' },
    { id: AppView.SERVICES, label: 'الخدمات', icon: Briefcase, comingSoon: true },
    { id: AppView.SERVICE_BOT, label: 'بوت الخدمات', icon: MessageSquare, comingSoon: true },
    { id: AppView.SUPPORT_TICKETS, label: 'رسائل الدعم', icon: HelpCircle },
    { id: AppView.PROFILE, label: 'الملف الشخصي', icon: UserCircle },
    { id: AppView.SETTINGS, label: 'الإعدادات', icon: Settings },
  ].filter((item) =>
    item.id !== AppView.ANALYTICS || planCapabilities.hasAdvancedAnalytics
  );

  const handleSupportSuccess = () => {
    // Show success notification
    logger.info('Support ticket created successfully');
  };

  const handleUpgrade = () => {
    setShowUpgradeModal(true);
  };

  const handleExitImpersonation = async () => {
    await exitImpersonation();
    navigate(adminPath(AdminView.USERS));
  };

  // Close sidebar when clicking outside on mobile
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sidebarOpen && window.innerWidth < 768) {
        const target = event.target as HTMLElement;
        if (!target.closest('aside') && !target.closest('button[aria-label="فتح القائمة"]')) {
          setSidebarOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sidebarOpen]);

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (sidebarOpen && window.innerWidth < 768) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  return (
    <div className="flex h-screen bg-[#FFFBF7] dark:bg-gray-900 text-gray-800 dark:text-gray-100 overflow-hidden transition-colors duration-300">
      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`fixed md:static top-0 right-0 h-full w-80 max-w-[85vw] bg-white dark:bg-gray-800 border-l border-brand-100 dark:border-gray-700 flex flex-col shadow-xl md:shadow-sm z-50 md:z-10 transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'
        } md:flex transition-colors duration-300`}
        aria-label="القائمة الجانبية"
      >
        <div className="p-6 flex items-center justify-between gap-3 border-b border-brand-100 dark:border-gray-700">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-xl bg-white px-2 py-1.5 border border-brand-100/80 shadow-sm dark:border-gray-600">
              <BrandLogo className="h-9 w-auto max-w-[150px] object-contain select-none" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 shrink-0 hidden sm:block">إدارة المتجر</p>
          </div>
          {/* Close button for mobile */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="إغلاق القائمة"
          >
            <X size={24} />
          </button>
        </div>

        <nav className="flex-1 py-6 px-4 space-y-2 overflow-y-auto custom-scrollbar" aria-label="القائمة الرئيسية">
          {navItems.map((item) =>
            item.comingSoon ? (
              <div
                key={item.id}
                draggable={false}
                aria-disabled="true"
                aria-label={`${item.label} — قريباً`}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-gray-500 dark:text-gray-500 bg-gray-50/80 dark:bg-gray-800/50 border border-dashed border-gray-200 dark:border-gray-600 cursor-not-allowed select-none"
              >
                <div className="flex items-center gap-3 pointer-events-none">
                  <item.icon size={20} className="opacity-70" />
                  <span>{item.label}</span>
                </div>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-red-600 text-white shadow-sm animate-blink shrink-0">
                  قريباً
                </span>
              </div>
            ) : (
              <NavLink
                key={item.id}
                to={appPath(item.id)}
                onClick={() => setSidebarOpen(false)}
                aria-label={item.label}
                className={({ isActive }) =>
                  `w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group focus:outline-none focus:ring-2 focus:ring-brand ${
                    isActive
                      ? 'bg-brand-50 dark:bg-brand-900/30 text-brand dark:text-brand-300 font-semibold shadow-sm border border-brand-100 dark:border-transparent'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                  }`
                }
              >
                <div className="flex items-center gap-3">
                  <item.icon size={20} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse shadow-sm ${
                      item.badge === '$'
                        ? 'bg-green-500 text-white'
                        : item.badge === 'جديد'
                          ? 'bg-blue-500 text-white'
                          : /^\d+$/.test(item.badge)
                            ? 'bg-red-500 text-white'
                            : 'bg-gradient-to-r from-red-500 to-pink-500 text-white'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </NavLink>
            )
          )}
        </nav>

        <div className="p-4 border-t border-gray-100 dark:border-gray-700 space-y-2">
          <a
            href="https://app.storify.it.com/login?ref=Z8DVTTF5"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-[#f6f9ef] dark:bg-[#a2c037]/10 text-[#718520] dark:text-[#a2c037] hover:bg-[#ebf2da] dark:hover:bg-[#a2c037]/20 rounded-xl transition-colors border border-[#d4e3aa] dark:border-[#a2c037]/30 font-bold shadow-sm focus:outline-none focus:ring-2 focus:ring-[#a2c037]"
          >
            <div className="flex items-center gap-3">
              <Store size={20} aria-hidden="true" />
              <span>أحصل على متجر ألكتروني</span>
            </div>
            <ExternalLink size={16} className="opacity-70" aria-hidden="true" />
          </a>

          <button 
            onClick={toggleDarkMode}
            aria-label={isDarkMode ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الليلي'}
            className="w-full flex items-center gap-3 px-4 py-3 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {isDarkMode ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
            <span>{isDarkMode ? 'الوضع النهاري' : 'الوضع الليلي'}</span>
          </button>

          <InstallAppButton variant="sidebar" />
          
          <button 
            onClick={handleLogoutClick}
            aria-label="تسجيل الخروج"
            className="w-full flex items-center gap-3 px-4 py-3 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <LogOut size={20} aria-hidden="true" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 w-full bg-white dark:bg-gray-800 border-b dark:border-gray-700 z-30 flex justify-between items-center p-4 transition-colors duration-300 shadow-sm">
         <div className="flex items-center gap-3">
           <button
             onClick={() => setSidebarOpen(true)}
             className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
             aria-label="فتح القائمة"
           >
             <Menu size={24} />
           </button>
           <div className="rounded-lg bg-white px-1.5 py-1 border border-brand-100/80 dark:border-gray-600">
             <BrandLogo className="h-7 w-auto max-w-[120px] object-contain select-none" />
           </div>
         </div>
         <div className="flex items-center gap-1">
            <InstallAppButton variant="header-icon" />
            <button
              onClick={() => goToView(AppView.NOTIFICATIONS)}
              className={`relative p-2 rounded-lg transition-colors ${
                currentView === AppView.NOTIFICATIONS
                  ? 'bg-brand-50 dark:bg-brand-900/30 text-brand'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              aria-label="الإشعارات"
            >
              <Bell size={20} />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold rounded-full bg-red-500 text-white">
                  {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowSupportModal(true)}
              className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="المساعدة"
            >
              <HelpCircle size={20} />
            </button>
            <button
              onClick={() => setShowAssistant(true)}
              className={`p-2 rounded-lg transition-colors ${
                showAssistant
                  ? 'bg-brand-50 dark:bg-brand-900/30 text-brand'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              aria-label="المساعد الذكي"
            >
              <Bot size={20} />
            </button>
            <button 
              onClick={toggleDarkMode} 
              className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label={isDarkMode ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الليلي'}
            >
                {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
         </div>
      </div>

      {/* Main Content */}
      <main 
        id="main-content" 
        className={`flex-1 overflow-auto w-full flex flex-col ${
          user && (user.subscriptionPlan === 'trial' || user.trialEndsAt) 
            ? 'pt-32 md:pt-0' 
            : 'pt-16 md:pt-0'
        }`} 
        role="main"
      >
        {/* Desktop top bar: notifications + help + assistant (top-left) */}
        <div className="hidden md:flex sticky top-0 z-20 items-center justify-end gap-2 px-8 py-3 bg-[#FFFBF7]/90 dark:bg-gray-900/90 backdrop-blur-sm border-b border-brand-100/60 dark:border-gray-700/60">
          <InstallAppButton variant="header" />
          <button
            onClick={() => goToView(AppView.NOTIFICATIONS)}
            className={`relative inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand ${
              currentView === AppView.NOTIFICATIONS
                ? 'bg-brand-50 dark:bg-brand-900/30 text-brand dark:text-brand-300'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            aria-label="الإشعارات"
          >
            <Bell size={18} />
            <span>الإشعارات</span>
            {unreadNotificationsCount > 0 && (
              <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center text-[10px] font-bold rounded-full bg-red-500 text-white">
                {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowSupportModal(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-brand"
            aria-label="المساعدة"
          >
            <HelpCircle size={18} />
            <span>المساعدة</span>
          </button>
          <button
            onClick={() => setShowAssistant(true)}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand ${
              showAssistant
                ? 'bg-brand-50 dark:bg-brand-900/30 text-brand dark:text-brand-300'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            aria-label="المساعد الذكي"
          >
            <Bot size={18} />
            <span>المساعد الذكي</span>
          </button>
        </div>

        {/* Support impersonation banner */}
        {user?.impersonation?.active && (
          <div className="fixed md:sticky top-16 md:top-0 right-0 left-0 w-full z-20">
            <ImpersonationBanner
              merchantName={user.name || user.email}
              merchantEmail={user.email}
              adminLabel={user.impersonation.adminName || user.impersonation.adminEmail}
              onExit={handleExitImpersonation}
            />
          </div>
        )}

        {/* Trial Banner Sticky Below Header - Only show if user is on trial plan */}
        {user && (user.subscriptionPlan === 'trial' || user.trialEndsAt) && user.subscriptionPlan === 'trial' && (() => {
          // Calculate trial end date: use trialEndsAt from DB, or calculate from createdAt + 7 days
          let trialEndDate: Date | string | null = null;
          if (user.trialEndsAt) {
            trialEndDate = user.trialEndsAt;
          } else if (user.createdAt) {
            const createdAt = new Date(user.createdAt);
            trialEndDate = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
          }
          
          if (!trialEndDate) {
            return null;
          }
          
          return (
            <div className="fixed md:sticky top-16 md:top-0 right-0 left-0 w-full z-10">
              <TrialBanner 
                trialEndsAt={trialEndDate} 
                onUpgrade={handleUpgrade}
              />
            </div>
          );
        })()}

        {/* Paid subscription renewal warning (last 5 days) */}
        {user &&
          user.subscriptionPlan !== 'trial' &&
          isRenewalWarning &&
          subscriptionEndsAt && (
            <div className="fixed md:sticky top-16 md:top-0 right-0 left-0 w-full z-10">
              <SubscriptionRenewalBanner
                subscriptionEndsAt={subscriptionEndsAt}
                onRenew={handleUpgrade}
              />
            </div>
          )}

        <div className="md:p-8 p-4 pt-4 flex-1">
           <div className="max-w-6xl mx-auto">
               <TrialExpiredBlock onUpgrade={handleUpgrade}>
                 {children}
               </TrialExpiredBlock>
           </div>
        </div>
      </main>
      
      {/* Dashboard Support Assistant */}
      <DashboardAssistant isOpen={showAssistant} onOpenChange={setShowAssistant} />

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <SubscriptionModal onClose={() => setShowUpgradeModal(false)} />
      )}

      {/* Support Ticket Modal */}
      <SupportTicketModal
        isOpen={showSupportModal}
        onClose={() => setShowSupportModal(false)}
        onSuccess={handleSupportSuccess}
      />

      {/* Logout Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="تأكيد تسجيل الخروج"
        message="هل أنت متأكد من رغبتك في تسجيل الخروج؟"
        confirmText="تسجيل الخروج"
        cancelText="إلغاء"
        onConfirm={handleConfirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
        type="warning"
      />
    </div>
  );
};

export default Layout;