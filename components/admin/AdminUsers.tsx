
import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AdminUser } from '../../types';
import apiService from '../../services/api';
import { Search, MoreHorizontal, CheckCircle, XCircle, Clock, Plus, X, Save, Info, Edit, Trash2, UserX, UserCheck, CreditCard, Eye, EyeOff, Filter, X as XIcon, Download, FileSpreadsheet } from 'lucide-react';
import { useAdminNotifications } from './AdminNotificationContext';
import ConfirmDialog from './ConfirmDialog';
import { logger } from '../../utils/logger';
import { useDebounce } from '../../hooks/useDebounce';
import Pagination from '../Pagination';
import { validateEmail, validatePassword, validateRequired } from '../../utils/validation';
import { handleApiError } from '../../utils/errorHandler';
import { downloadRowsAsCsv, downloadRowsAsXlsx } from '../../utils/spreadsheetExport';

interface AdminUsersProps {
  filterByTrial?: boolean;
}

const AdminUsers: React.FC<AdminUsersProps> = ({ filterByTrial = false }) => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const { showError, showSuccess, showWarning, showInfo } = useAdminNotifications();
  
  // Advanced filters
  const [filterPlan, setFilterPlan] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterDateRange, setFilterDateRange] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  
  // State for Add Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUser, setNewUser] = useState<Partial<AdminUser>>({
      name: '',
      email: '',
      plan: 'Starter',
      status: 'active',
      isTrial: false,
      registrationDate: new Date()
  });
  const [newUserPassword, setNewUserPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // State for Confirm Dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'warning'
  });

  // State for User Details Modal
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);

  // State for Edit User Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editFormData, setEditFormData] = useState<{ name: string; email: string; status: 'active' | 'suspended' | 'expired' }>({
    name: '',
    email: '',
    status: 'active'
  });

  // State for Change Plan Modal
  const [showChangePlanModal, setShowChangePlanModal] = useState(false);
  const [changingPlanUser, setChangingPlanUser] = useState<AdminUser | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string>('starter');

  // State for Actions Dropdown
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);

  // Explicitly not using isLoading for render blocking to keep UI smooth, but state is here
  // const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await apiService.getAdminUsers();
        // Convert date strings to Date objects
        const users = (Array.isArray(response) ? response : []).map((user: any) => ({
          ...user,
          registrationDate: new Date(user.registrationDate),
          trialEndsAt: user.trialEndsAt ? new Date(user.trialEndsAt) : undefined
        }));
        setUsers(users);
      } catch (err: any) {
        logger.error('Failed to fetch admin users:', err);
        showError('فشل تحميل المستخدمين: ' + (err.message || 'خطأ غير معروف'));
      }
    };
    
    fetchUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      // Search filter
      const matchesSearch = user.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) || 
                            user.email.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                            (user.phone?.includes(debouncedSearchTerm) ?? false);
      
      if (!matchesSearch) return false;
      
      // Trial filter (if filterByTrial is true)
      if (filterByTrial && !user.isTrial) return false;
      
      // Plan filter
      if (filterPlan !== 'all') {
        const userPlan = user.plan?.toLowerCase() || 'trial';
        if (filterPlan === 'trial' && !user.isTrial) return false;
        if (filterPlan !== 'trial' && userPlan !== filterPlan) return false;
      }
      
      // Status filter
      if (filterStatus !== 'all' && user.status !== filterStatus) return false;
      
      // Date range filter
      if (filterDateRange !== 'all') {
        const now = new Date();
        const userDate = user.registrationDate;
        const daysDiff = Math.floor((now.getTime() - userDate.getTime()) / (1000 * 60 * 60 * 24));
        
        switch (filterDateRange) {
          case 'today':
            if (daysDiff !== 0) return false;
            break;
          case 'week':
            if (daysDiff > 7) return false;
            break;
          case 'month':
            if (daysDiff > 30) return false;
            break;
          case 'year':
            if (daysDiff > 365) return false;
            break;
        }
      }
      
      return true;
    });
  }, [users, debouncedSearchTerm, filterByTrial, filterPlan, filterStatus, filterDateRange]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const paginatedUsers = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredUsers.slice(startIndex, endIndex);
  }, [filteredUsers, currentPage, itemsPerPage]);

  // Reset to page 1 when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchTerm, filterByTrial, filterPlan, filterStatus, filterDateRange]);

  const getStatusBadge = (status: string) => {
    switch(status) {
        case 'active': return <span className="px-2 py-1 bg-green-900/30 text-green-400 rounded-full text-xs font-bold flex items-center gap-1 w-fit"><CheckCircle size={12} /> نشط</span>;
        case 'suspended': return <span className="px-2 py-1 bg-red-900/30 text-red-400 rounded-full text-xs font-bold flex items-center gap-1 w-fit"><XCircle size={12} /> معلق</span>;
        case 'expired': return <span className="px-2 py-1 bg-gray-700 text-gray-400 rounded-full text-xs font-bold flex items-center gap-1 w-fit"><Clock size={12} /> منتهي</span>;
        default: return status;
    }
  };

  const getTrialStatus = (user: AdminUser) => {
      if (!user.isTrial || !user.trialEndsAt) return null;
      const now = new Date();
      const diff = Math.ceil((user.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diff < 0) return <span className="text-red-400 text-xs font-bold">منتهية منذ {Math.abs(diff)} يوم</span>;
      if (diff === 0) return <span className="text-orange-400 text-xs font-bold">تنتهي اليوم!</span>;
      return <span className="text-green-400 text-xs font-bold">متبقي {diff} يوم</span>;
  };

  const handleShowDetails = (user: AdminUser) => {
      setSelectedUser(user);
      setShowDetailsModal(true);
  };

  const handleExtendTrial = (user: AdminUser) => {
      setConfirmDialog({
        isOpen: true,
        title: 'تمديد الفترة التجريبية',
        message: `هل أنت متأكد من رغبتك في تمديد الفترة التجريبية للمستخدم "${user.name}" لمدة 7 أيام إضافية؟`,
        type: 'warning',
        onConfirm: () => {
          // In a real app, update state here
          showSuccess(`تم تمديد الفترة التجريبية للمستخدم ${user.name} بنجاح.`);
          setConfirmDialog({ ...confirmDialog, isOpen: false });
        }
      });
  };

  const handleMoreActions = (user: AdminUser, event: React.MouseEvent) => {
      event.stopPropagation();
      const button = event.currentTarget as HTMLElement;
      const rect = button.getBoundingClientRect();
      
      if (openDropdownId === user.id) {
          setOpenDropdownId(null);
          setDropdownPosition(null);
      } else {
          setOpenDropdownId(user.id);
          // Calculate position for fixed dropdown
          // Button is in the leftmost column (Actions), dropdown should appear to its right
          // Use left positioning to align dropdown with button's right edge
          setDropdownPosition({
              top: rect.bottom + 4,
              left: rect.right, // Start dropdown at button's right edge
              right: undefined
          });
      }
  };

  const handleEditUser = (user: AdminUser) => {
      setOpenDropdownId(null);
      setEditingUser(user);
      setEditFormData({
        name: user.name,
        email: user.email,
        status: user.status
      });
      setShowEditModal(true);
  };

  const handleSaveEditUser = async () => {
      if (!editingUser) return;
      
      if (!editFormData.name.trim() || !editFormData.email.trim()) {
          showError('الاسم والبريد الإلكتروني مطلوبان');
          return;
      }

      try {
          await apiService.updateAdminUser(editingUser.id, {
              name: editFormData.name,
              email: editFormData.email,
              subscription_status: editFormData.status
          });
          
          showSuccess(`تم تحديث المستخدم ${editFormData.name} بنجاح`);
          setShowEditModal(false);
          setEditingUser(null);
          
          // Refresh users list
          const response = await apiService.getAdminUsers();
          const users = (Array.isArray(response) ? response : []).map((u: any) => ({
            ...u,
            registrationDate: new Date(u.registrationDate),
            trialEndsAt: u.trialEndsAt ? new Date(u.trialEndsAt) : undefined
          }));
          setUsers(users);
      } catch (err: any) {
          showError('فشل تحديث المستخدم: ' + (err.message || 'خطأ غير معروف'));
      }
  };

  const handleSuspendUser = (user: AdminUser) => {
      setOpenDropdownId(null);
      setDropdownPosition(null);
      setConfirmDialog({
        isOpen: true,
        title: user.status === 'suspended' ? 'تفعيل الحساب' : 'تعليق الحساب',
        message: user.status === 'suspended' 
          ? `هل أنت متأكد من رغبتك في تفعيل حساب المستخدم "${user.name}"؟`
          : `هل أنت متأكد من رغبتك في تعليق حساب المستخدم "${user.name}"؟`,
        type: 'warning',
        onConfirm: async () => {
          try {
            await apiService.updateAdminUser(user.id, {
              subscription_status: user.status === 'suspended' ? 'active' : 'suspended'
            });
            showSuccess(user.status === 'suspended' 
              ? `تم تفعيل حساب ${user.name} بنجاح`
              : `تم تعليق حساب ${user.name} بنجاح`
            );
            // Refresh users list
            const response = await apiService.getAdminUsers();
            const users = (Array.isArray(response) ? response : []).map((u: any) => ({
              ...u,
              registrationDate: new Date(u.registrationDate),
              trialEndsAt: u.trialEndsAt ? new Date(u.trialEndsAt) : undefined
            }));
            setUsers(users);
            setConfirmDialog({ ...confirmDialog, isOpen: false });
          } catch (err: any) {
            showError('فشل تحديث حالة المستخدم: ' + (err.message || 'خطأ غير معروف'));
            setConfirmDialog({ ...confirmDialog, isOpen: false });
          }
        }
      });
  };

  const handleDeleteUser = (user: AdminUser) => {
      setOpenDropdownId(null);
      setDropdownPosition(null);
      setConfirmDialog({
        isOpen: true,
        title: 'حذف المستخدم',
        message: `هل أنت متأكد من رغبتك في حذف المستخدم "${user.name}"؟ هذا الإجراء لا يمكن التراجع عنه.`,
        type: 'danger',
        confirmText: 'حذف',
        onConfirm: async () => {
          try {
            await apiService.deleteAdminUser(user.id);
            showSuccess(`تم حذف المستخدم ${user.name} بنجاح`);
            // Refresh users list
            const response = await apiService.getAdminUsers();
            const users = (Array.isArray(response) ? response : []).map((u: any) => ({
              ...u,
              registrationDate: new Date(u.registrationDate),
              trialEndsAt: u.trialEndsAt ? new Date(u.trialEndsAt) : undefined
            }));
            setUsers(users);
            setConfirmDialog({ ...confirmDialog, isOpen: false });
          } catch (err: any) {
            showError('فشل حذف المستخدم: ' + (err.message || 'خطأ غير معروف'));
            setConfirmDialog({ ...confirmDialog, isOpen: false });
          }
        }
      });
  };

  const handleChangePlan = (user: AdminUser) => {
      setOpenDropdownId(null);
      setChangingPlanUser(user);
      // Map current plan to backend format
      const planMap: Record<string, string> = {
        'Trial': 'trial',
        'التعليقات': 'comments',
        'القناة الواحدة': 'single',
        'السوشيال': 'social',
        'السنوية': 'yearly',
        'Starter': 'starter',
        'Pro': 'pro',
        'Business': 'business',
        'Comments': 'comments',
        'Single': 'single',
        'Social': 'social',
        'Yearly': 'yearly'
      };
      setSelectedPlan(planMap[user.plan] || 'starter');
      setShowChangePlanModal(true);
  };

  const handleSaveChangePlan = async () => {
      if (!changingPlanUser) return;

      try {
          await apiService.updateAdminUser(changingPlanUser.id, {
              subscription_plan: selectedPlan,
              // If changing to trial, set trial_ends_at
              trial_ends_at: selectedPlan === 'trial' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null
          });
          
          const planNames: Record<string, string> = {
            'trial': 'Trial',
            'comments': 'التعليقات',
            'single': 'القناة الواحدة',
            'social': 'السوشيال',
            'yearly': 'السنوية',
            'starter': 'Starter',
            'pro': 'Pro',
            'business': 'Business'
          };
          
          showSuccess(`تم تغيير خطة المستخدم ${changingPlanUser.name} إلى ${planNames[selectedPlan]} بنجاح`);
          setShowChangePlanModal(false);
          setChangingPlanUser(null);
          
          // Refresh users list
          const response = await apiService.getAdminUsers();
          const users = (Array.isArray(response) ? response : []).map((u: any) => ({
            ...u,
            registrationDate: new Date(u.registrationDate),
            trialEndsAt: u.trialEndsAt ? new Date(u.trialEndsAt) : undefined
          }));
          setUsers(users);
      } catch (err: any) {
          showError('فشل تغيير الخطة: ' + (err.message || 'خطأ غير معروف'));
      }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
      const handleClickOutside = () => {
          setOpenDropdownId(null);
          setDropdownPosition(null);
      };
      if (openDropdownId) {
          document.addEventListener('click', handleClickOutside);
          return () => document.removeEventListener('click', handleClickOutside);
      }
  }, [openDropdownId]);

  const handleAddUserSubmit = async () => {
      // Validate inputs
      const nameValidation = validateRequired(newUser.name, 'الاسم');
      const emailValidation = validateEmail(newUser.email || '');
      const passwordValidation = validatePassword(newUserPassword);

      const allErrors: string[] = [];
      if (!nameValidation.isValid) allErrors.push(...nameValidation.errors);
      if (!emailValidation.isValid) allErrors.push(...emailValidation.errors);
      if (!passwordValidation.isValid) allErrors.push(...passwordValidation.errors);

      if (allErrors.length > 0) {
          showWarning(allErrors.join('، '));
          return;
      }

      try {
          const response = await apiService.createAdminUser({
              name: newUser.name!,
              email: newUser.email!,
              password: newUserPassword,
              subscription_plan: newUser.plan?.toLowerCase() || 'starter',
              subscription_status: newUser.status || 'active',
              isTrial: newUser.isTrial || false,
              trial_ends_at: newUser.isTrial ? (newUser.trialEndsAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) : undefined
          });

          // Refresh users list
          const usersResponse = await apiService.getAdminUsers();
          const users = (Array.isArray(usersResponse) ? usersResponse : []).map((user: any) => ({
              ...user,
              registrationDate: new Date(user.registrationDate),
              trialEndsAt: user.trialEndsAt ? new Date(user.trialEndsAt) : undefined
          }));
          setUsers(users);

          setShowAddModal(false);
          // Reset form
          setNewUser({
              name: '',
              email: '',
              plan: 'Starter',
              status: 'active',
              isTrial: false,
              registrationDate: new Date()
          });
          setNewUserPassword('');
          showSuccess("تم إضافة المشترك الجديد بنجاح!");
      } catch (err: any) {
          logger.error('Failed to create user:', err);
          const errorMessage = handleApiError(err);
          showError('فشل إضافة المستخدم: ' + errorMessage);
      }
  };

  // Export users to Excel/CSV
  const handleExportUsers = async (format: 'excel' | 'csv' = 'excel') => {
    try {
      const exportData = filteredUsers.map(user => ({
        'المعرف': user.id,
        'الاسم': user.name,
        'البريد الإلكتروني': user.email,
        'رقم الهاتف': user.phone || '-',
        'الباقة': user.plan || 'غير محدد',
        'الحالة': user.status === 'active' ? 'نشط' : user.status === 'suspended' ? 'معلق' : 'منتهي',
        'تجربة مجانية': user.isTrial ? 'نعم' : 'لا',
        'تاريخ انتهاء التجربة': user.trialEndsAt ? user.trialEndsAt.toLocaleDateString('ar-SA-u-nu-latn') : '-',
        'تاريخ التسجيل': user.registrationDate.toLocaleDateString('ar-SA-u-nu-latn'),
      }));

      const fileName = `users_export_${new Date().toISOString().split('T')[0]}.${format === 'excel' ? 'xlsx' : 'csv'}`;

      if (format === 'csv') {
        downloadRowsAsCsv(exportData, fileName);
      } else {
        await downloadRowsAsXlsx(exportData, 'المستخدمين', fileName);
      }

      showSuccess(`تم تصدير ${filteredUsers.length} مستخدم بنجاح`);
    } catch (error: any) {
      logger.error('Failed to export users:', error);
      showError('فشل تصدير البيانات: ' + (error.message || 'خطأ غير معروف'));
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
       <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
            <h2 className="text-xl font-bold text-white mb-1">
                {filterByTrial ? 'إدارة التجارب المجانية' : 'إدارة المستخدمين'}
            </h2>
            <p className="text-sm text-slate-400">
                {filterByTrial 
                 ? 'متابعة المستخدمين في الفترة التجريبية وتمديد الصلاحيات' 
                 : 'عرض والتحكم في حسابات جميع المستخدمين المسجلين'
                }
            </p>
          </div>
          
          <div className="flex items-center gap-3 w-full md:w-auto">
             <div className="relative flex-1 md:w-64">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input 
                  type="text" 
                  placeholder="بحث بالاسم أو البريد..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pr-10 pl-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none placeholder-slate-500"
                />
             </div>
             
             <button
               onClick={() => setShowFilters(!showFilters)}
               className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-colors whitespace-nowrap ${
                 showFilters || filterPlan !== 'all' || filterStatus !== 'all' || filterDateRange !== 'all'
                   ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                   : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
               }`}
             >
               <Filter size={18} />
               <span>فلاتر</span>
               {(filterPlan !== 'all' || filterStatus !== 'all' || filterDateRange !== 'all') && (
                 <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                   {[filterPlan !== 'all' ? 1 : 0, filterStatus !== 'all' ? 1 : 0, filterDateRange !== 'all' ? 1 : 0].reduce((a, b) => a + b, 0)}
                 </span>
               )}
             </button>

             {/* Export Button */}
             <div className="relative group">
               <button
                 onClick={() => handleExportUsers('excel')}
                 className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold transition-colors shadow-lg shadow-green-900/20 whitespace-nowrap"
                 title="تصدير البيانات"
               >
                 <Download size={18} />
                 <span>تصدير</span>
               </button>
               {/* Dropdown menu for export format */}
               <div className="absolute left-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 min-w-[150px]">
                 <button
                   onClick={() => handleExportUsers('excel')}
                   className="w-full text-right px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2"
                 >
                   <FileSpreadsheet size={16} />
                   <span>تصدير Excel</span>
                 </button>
                 <button
                   onClick={() => handleExportUsers('csv')}
                   className="w-full text-right px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2"
                 >
                   <FileSpreadsheet size={16} />
                   <span>تصدير CSV</span>
                 </button>
               </div>
             </div>
             
             {!filterByTrial && (
                <button 
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold transition-colors shadow-lg shadow-indigo-900/20 whitespace-nowrap"
                >
                    <Plus size={18} />
                    <span>أضف مشترك</span>
                </button>
             )}
          </div>
       </div>

       {/* Advanced Filters Panel */}
       {showFilters && (
         <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 lg:p-6 space-y-4">
           <div className="flex items-center justify-between mb-4">
             <h3 className="text-lg font-bold text-white flex items-center gap-2">
               <Filter size={20} />
               فلاتر متقدمة
             </h3>
             <button
               onClick={() => {
                 setFilterPlan('all');
                 setFilterStatus('all');
                 setFilterDateRange('all');
               }}
               className="text-sm text-slate-400 hover:text-white transition-colors"
             >
               إعادة تعيين
             </button>
           </div>
           
           <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
             {/* Plan Filter */}
             <div>
               <label className="block text-sm font-medium text-slate-300 mb-2">الباقة</label>
               <select
                 value={filterPlan}
                 onChange={(e) => setFilterPlan(e.target.value)}
                 className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
               >
                 <option value="all">جميع الباقات</option>
                 <option value="trial">تجربة مجانية</option>
                 <option value="comments">التعليقات ($5)</option>
                 <option value="single">القناة الواحدة ($21)</option>
                 <option value="social">السوشيال ($35)</option>
                 <option value="yearly">السنوية ($200)</option>
                 <option value="starter">البداية (قديم)</option>
                 <option value="pro">المحترف</option>
                 <option value="business">الأعمال</option>
               </select>
             </div>
             
             {/* Status Filter */}
             <div>
               <label className="block text-sm font-medium text-slate-300 mb-2">الحالة</label>
               <select
                 value={filterStatus}
                 onChange={(e) => setFilterStatus(e.target.value)}
                 className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
               >
                 <option value="all">جميع الحالات</option>
                 <option value="active">نشط</option>
                 <option value="suspended">معلق</option>
                 <option value="expired">منتهي</option>
               </select>
             </div>
             
             {/* Date Range Filter */}
             <div>
               <label className="block text-sm font-medium text-slate-300 mb-2">تاريخ التسجيل</label>
               <select
                 value={filterDateRange}
                 onChange={(e) => setFilterDateRange(e.target.value)}
                 className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
               >
                 <option value="all">جميع التواريخ</option>
                 <option value="today">اليوم</option>
                 <option value="week">آخر 7 أيام</option>
                 <option value="month">آخر 30 يوم</option>
                 <option value="year">آخر سنة</option>
               </select>
             </div>
           </div>
           
           {/* Active Filters Display */}
           {(filterPlan !== 'all' || filterStatus !== 'all' || filterDateRange !== 'all') && (
             <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-700">
               <span className="text-sm text-slate-400">فلاتر نشطة:</span>
               {filterPlan !== 'all' && (
                 <span className="flex items-center gap-1 bg-indigo-900/30 text-indigo-400 px-3 py-1 rounded-full text-xs">
                   الباقة: {filterPlan === 'trial' ? 'تجربة'
                     : filterPlan === 'comments' ? 'التعليقات'
                     : filterPlan === 'single' ? 'القناة الواحدة'
                     : filterPlan === 'social' ? 'السوشيال'
                     : filterPlan === 'yearly' ? 'السنوية'
                     : filterPlan === 'starter' ? 'البداية (قديم)'
                     : filterPlan === 'pro' ? 'المحترف (قديم)'
                     : filterPlan === 'business' ? 'الأعمال (قديم)'
                     : filterPlan}
                   <button onClick={() => setFilterPlan('all')} className="hover:text-white">
                     <XIcon size={14} />
                   </button>
                 </span>
               )}
               {filterStatus !== 'all' && (
                 <span className="flex items-center gap-1 bg-indigo-900/30 text-indigo-400 px-3 py-1 rounded-full text-xs">
                   الحالة: {filterStatus === 'active' ? 'نشط' : filterStatus === 'suspended' ? 'معلق' : 'منتهي'}
                   <button onClick={() => setFilterStatus('all')} className="hover:text-white">
                     <XIcon size={14} />
                   </button>
                 </span>
               )}
               {filterDateRange !== 'all' && (
                 <span className="flex items-center gap-1 bg-indigo-900/30 text-indigo-400 px-3 py-1 rounded-full text-xs">
                   التاريخ: {filterDateRange === 'today' ? 'اليوم' : filterDateRange === 'week' ? 'آخر 7 أيام' : filterDateRange === 'month' ? 'آخر 30 يوم' : 'آخر سنة'}
                   <button onClick={() => setFilterDateRange('all')} className="hover:text-white">
                     <XIcon size={14} />
                   </button>
                 </span>
               )}
             </div>
           )}
         </div>
       )}

       {/* Results Count */}
       <div className="text-sm text-slate-400">
         عرض {paginatedUsers.length} من {filteredUsers.length} مستخدم
       </div>

       <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-visible shadow-sm">
          <div className="overflow-x-auto overflow-y-visible">
             <table className="w-full text-right">
                <thead className="bg-slate-900/50 text-slate-400 text-xs font-bold uppercase">
                   <tr>
                      <th className="px-6 py-4">المستخدم</th>
                      <th className="px-6 py-4">رقم الهاتف</th>
                      <th className="px-6 py-4">الباقة الحالية</th>
                      <th className="px-6 py-4">تاريخ التسجيل</th>
                      <th className="px-6 py-4">الحالة</th>
                      {filterByTrial && <th className="px-6 py-4">حالة التجربة</th>}
                      <th className="px-6 py-4">إجراءات</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                   {paginatedUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-slate-700/30 transition-colors">
                         <td className="px-6 py-4">
                            <div>
                               <p className="font-bold text-white">{user.name}</p>
                               <p className="text-xs text-slate-400">{user.email}</p>
                            </div>
                         </td>
                         <td className="px-6 py-4 text-sm text-slate-300" dir="ltr">
                            {user.phone || <span className="text-slate-500">—</span>}
                         </td>
                         <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                                user.plan === 'Business' ? 'bg-purple-900/20 border-purple-800 text-purple-300' :
                                user.plan === 'Pro' ? 'bg-indigo-900/20 border-indigo-800 text-indigo-300' :
                                'bg-slate-700 border-slate-600 text-slate-300'
                            }`}>
                                {user.plan}
                            </span>
                         </td>
                         <td className="px-6 py-4 text-sm text-slate-300" dir="ltr">
                            {user.registrationDate.toLocaleDateString('ar-u-nu-latn')}
                         </td>
                         <td className="px-6 py-4">
                            {getStatusBadge(user.status)}
                         </td>
                         {filterByTrial && (
                            <td className="px-6 py-4">
                                {getTrialStatus(user)}
                            </td>
                         )}
                         <td className="px-6 py-4">
                            <div className="flex items-center gap-2 relative">
                               <button 
                                 onClick={() => handleShowDetails(user)}
                                 className="text-indigo-400 hover:text-indigo-300 text-xs font-bold"
                               >
                                 التفاصيل
                               </button>
                               {filterByTrial && (
                                   <button 
                                     onClick={() => handleExtendTrial(user)}
                                     className="text-green-400 hover:text-green-300 text-xs font-bold border border-green-800 rounded px-2 py-1 hover:bg-green-900/20 transition-colors"
                                   >
                                     تمديد
                                   </button>
                               )}
                               <div className="relative">
                                  <button 
                                    onClick={(e) => handleMoreActions(user, e)}
                                    className="text-slate-500 hover:text-white p-1 hover:bg-slate-700 rounded transition-colors"
                                  >
                                     <MoreHorizontal size={16} />
                                  </button>
                                  {openDropdownId === user.id && dropdownPosition && (
                                    <div 
                                      className="fixed w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl z-[99999] overflow-hidden"
                                      dir="rtl"
                                      style={{
                                        top: `${dropdownPosition.top}px`,
                                        left: `${dropdownPosition.left}px`
                                      }}
                                    >
                                      <button
                                        onClick={() => handleEditUser(user)}
                                        className="w-full text-right px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
                                      >
                                        <Edit size={16} />
                                        <span>تعديل المستخدم</span>
                                      </button>
                                      <button
                                        onClick={() => handleChangePlan(user)}
                                        className="w-full text-right px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
                                      >
                                        <CreditCard size={16} />
                                        <span>تغيير الخطة</span>
                                      </button>
                                      <button
                                        onClick={() => handleSuspendUser(user)}
                                        className="w-full text-right px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
                                      >
                                        {user.status === 'suspended' ? (
                                          <>
                                            <UserCheck size={16} />
                                            <span>تفعيل الحساب</span>
                                          </>
                                        ) : (
                                          <>
                                            <UserX size={16} />
                                            <span>تعليق الحساب</span>
                                          </>
                                        )}
                                      </button>
                                      <div className="border-t border-slate-700"></div>
                                      <button
                                        onClick={() => handleDeleteUser(user)}
                                        className="w-full text-right px-4 py-2 text-sm text-red-400 hover:bg-red-900/20 hover:text-red-300 flex items-center gap-2 transition-colors"
                                      >
                                        <Trash2 size={16} />
                                        <span>حذف المستخدم</span>
                                      </button>
                                    </div>
                                  )}
                               </div>
                            </div>
                         </td>
                      </tr>
                   ))}
                   {paginatedUsers.length === 0 && (
                      <tr>
                         <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                             لا توجد نتائج مطابقة
                         </td>
                      </tr>
                   )}
                </tbody>
             </table>
             {totalPages > 1 && (
               <Pagination
                 currentPage={currentPage}
                 totalPages={totalPages}
                 onPageChange={setCurrentPage}
                 itemsPerPage={itemsPerPage}
                 totalItems={filteredUsers.length}
               />
             )}
          </div>
       </div>

       {/* Add User Modal */}
       {showAddModal && createPortal(
           <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10000] p-4" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000 }}>
               <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl animate-fade-in" style={{ position: 'relative', zIndex: 10001 }}>
                   <div className="flex justify-between items-center p-6 border-b border-slate-800">
                       <h3 className="text-xl font-bold text-white">إضافة مشترك جديد</h3>
                       <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white transition-colors">
                           <X size={24} />
                       </button>
                   </div>
                   
                   <div className="p-6 space-y-4">
                       <div>
                           <label className="block text-sm font-medium text-slate-400 mb-1">الاسم الكامل <span className="text-red-500">*</span></label>
                           <input 
                               type="text" 
                               required
                               maxLength={100}
                               value={newUser.name || ''}
                               onChange={e => {
                                 const value = e.target.value;
                                 if (value.length <= 100) {
                                   setNewUser({...newUser, name: value});
                                 }
                               }}
                               className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                               placeholder="مثال: محمد أحمد"
                               aria-required="true"
                           />
                       </div>
                       
                       <div>
                           <label className="block text-sm font-medium text-slate-400 mb-1">البريد الإلكتروني <span className="text-red-500">*</span></label>
                           <input 
                               type="email" 
                               required
                               maxLength={255}
                               value={newUser.email || ''}
                               onChange={e => {
                                 const value = e.target.value;
                                 if (value.length <= 255) {
                                   setNewUser({...newUser, email: value});
                                 }
                               }}
                               className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                               placeholder="email@example.com"
                               aria-required="true"
                           />
                       </div>

                       <div>
                           <label className="block text-sm font-medium text-slate-400 mb-1">كلمة المرور <span className="text-red-500">*</span></label>
                           <div className="relative">
                               <input 
                                   type={showPassword ? "text" : "password"}
                                   required
                                   maxLength={128}
                                   value={newUserPassword}
                                   onChange={e => {
                                     const value = e.target.value;
                                     if (value.length <= 128) {
                                       setNewUserPassword(value);
                                     }
                                   }}
                                   className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 pr-10 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                   placeholder="6 أحرف على الأقل"
                                   minLength={6}
                                   aria-required="true"
                               />
                               <button
                                   type="button"
                                   onClick={() => setShowPassword(!showPassword)}
                                   className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                                   aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                               >
                                   {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                               </button>
                           </div>
                           <p className="text-xs text-slate-500 mt-1">يجب أن تكون 6 أحرف على الأقل (الحد الأقصى 128 حرف)</p>
                       </div>

                       <div className="grid grid-cols-2 gap-4">
                           <div>
                               <label className="block text-sm font-medium text-slate-400 mb-1">الخطة</label>
                               <select 
                                   value={newUser.plan}
                                   onChange={e => setNewUser({...newUser, plan: e.target.value as any})}
                                   className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                               >
                                   <option value="Starter">البداية (Starter)</option>
                                   <option value="Pro">المحترف (Pro)</option>
                                   <option value="Business">الأعمال (Business)</option>
                                   <option value="Trial">تجربة (Trial)</option>
                               </select>
                           </div>
                           
                           <div>
                               <label className="block text-sm font-medium text-slate-400 mb-1">الحالة</label>
                               <select 
                                   value={newUser.status}
                                   onChange={e => setNewUser({...newUser, status: e.target.value as any})}
                                   className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                               >
                                   <option value="active">نشط (Active)</option>
                                   <option value="suspended">معلق (Suspended)</option>
                                   <option value="expired">منتهي (Expired)</option>
                               </select>
                           </div>
                       </div>

                       <div className="flex items-center gap-3 p-4 bg-slate-800 rounded-lg border border-slate-700">
                           <input 
                               type="checkbox"
                               checked={newUser.isTrial}
                               onChange={e => setNewUser({...newUser, isTrial: e.target.checked})}
                               id="isTrial"
                               className="w-5 h-5 rounded border-gray-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500"
                           />
                           <label htmlFor="isTrial" className="text-white text-sm font-medium select-none cursor-pointer">
                               هل هذه فترة تجريبية؟
                           </label>
                       </div>

                       {newUser.isTrial && (
                           <div className="animate-fade-in">
                               <label className="block text-sm font-medium text-slate-400 mb-1">تاريخ انتهاء التجربة</label>
                               <input 
                                   type="date" 
                                   onChange={e => setNewUser({...newUser, trialEndsAt: new Date(e.target.value)})}
                                   className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                               />
                           </div>
                       )}
                   </div>

                   <div className="p-6 border-t border-slate-800 flex justify-end gap-3">
                       <button 
                           onClick={() => setShowAddModal(false)}
                           className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                       >
                           إلغاء
                       </button>
                       <button 
                           onClick={handleAddUserSubmit}
                           className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-lg shadow-indigo-900/20 flex items-center gap-2"
                       >
                           <Save size={18} />
                           <span>حفظ المشترك</span>
                       </button>
                   </div>
               </div>
           </div>,
           document.body
       )}

       {/* User Details Modal */}
       {/* Edit User Modal */}
       {showEditModal && editingUser && createPortal(
           <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10000] p-4" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000 }}>
               <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl animate-fade-in" style={{ position: 'relative', zIndex: 10001 }}>
                   <div className="flex justify-between items-center p-6 border-b border-slate-800">
                       <h3 className="text-xl font-bold text-white">تعديل المستخدم</h3>
                       <button 
                           onClick={() => {
                               setShowEditModal(false);
                               setEditingUser(null);
                           }}
                           className="text-slate-400 hover:text-white transition-colors"
                       >
                           <X size={24} />
                       </button>
                   </div>
                   
                   <div className="p-6 space-y-4">
                       <div>
                           <label className="block text-sm font-medium text-slate-400 mb-1">الاسم</label>
                           <input 
                               type="text"
                               value={editFormData.name}
                               onChange={e => setEditFormData({...editFormData, name: e.target.value})}
                               className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                               placeholder="اسم المستخدم"
                           />
                       </div>

                       <div>
                           <label className="block text-sm font-medium text-slate-400 mb-1">البريد الإلكتروني</label>
                           <input 
                               type="email"
                               value={editFormData.email}
                               onChange={e => setEditFormData({...editFormData, email: e.target.value})}
                               className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                               placeholder="email@example.com"
                           />
                           <p className="text-xs text-slate-500 mt-1">ملاحظة: تحديث البريد الإلكتروني يتطلب إعادة التحقق</p>
                       </div>

                       <div>
                           <label className="block text-sm font-medium text-slate-400 mb-1">الحالة</label>
                           <select 
                               value={editFormData.status}
                               onChange={e => setEditFormData({...editFormData, status: e.target.value as any})}
                               className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                           >
                               <option value="active">نشط (Active)</option>
                               <option value="suspended">معلق (Suspended)</option>
                               <option value="expired">منتهي (Expired)</option>
                           </select>
                       </div>

                       <div className="flex gap-3 pt-4">
                           <button
                               onClick={handleSaveEditUser}
                               className="flex-1 bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 flex items-center justify-center gap-2 transition-colors"
                           >
                               <Save size={18} /> حفظ التغييرات
                           </button>
                           <button
                               onClick={() => {
                                   setShowEditModal(false);
                                   setEditingUser(null);
                               }}
                               className="px-6 py-3 bg-slate-800 text-slate-300 rounded-xl font-bold hover:bg-slate-700 transition-colors"
                           >
                               إلغاء
                           </button>
                       </div>
                   </div>
               </div>
           </div>,
           document.body
       )}

       {/* Change Plan Modal */}
       {showChangePlanModal && changingPlanUser && createPortal(
           <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10000] p-4" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000 }}>
               <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl animate-fade-in" style={{ position: 'relative', zIndex: 10001 }}>
                   <div className="flex justify-between items-center p-6 border-b border-slate-800">
                       <h3 className="text-xl font-bold text-white flex items-center gap-2">
                           <CreditCard size={20} />
                           تغيير خطة المستخدم
                       </h3>
                       <button 
                           onClick={() => {
                               setShowChangePlanModal(false);
                               setChangingPlanUser(null);
                           }}
                           className="text-slate-400 hover:text-white transition-colors"
                       >
                           <X size={24} />
                       </button>
                   </div>
                   
                   <div className="p-6 space-y-4">
                       <div className="p-4 bg-slate-800 rounded-lg border border-slate-700">
                           <p className="text-sm text-slate-400 mb-1">المستخدم</p>
                           <p className="text-white font-medium">{changingPlanUser.name}</p>
                           <p className="text-xs text-slate-500 mt-1">{changingPlanUser.email}</p>
                       </div>

                       <div>
                           <label className="block text-sm font-medium text-slate-400 mb-2">الخطة الحالية</label>
                           <div className="p-3 bg-slate-800 rounded-lg border border-slate-700 text-white">
                               {changingPlanUser.plan}
                           </div>
                       </div>

                       <div>
                           <label className="block text-sm font-medium text-slate-400 mb-2">اختر الخطة الجديدة</label>
                           <select 
                               value={selectedPlan}
                               onChange={e => setSelectedPlan(e.target.value)}
                               className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                           >
                               <option value="trial">تجربة (Trial) - مجاني</option>
                               <option value="comments">التعليقات - $5/شهر</option>
                               <option value="single">القناة الواحدة - $21/شهر</option>
                               <option value="social">السوشيال - $35/شهر</option>
                               <option value="yearly">السنوية - $200/سنة</option>
                               <option value="starter">البداية (قديم)</option>
                               <option value="pro">المحترف (Pro) - $79/شهر</option>
                               <option value="business">الأعمال (Business) - $199/شهر</option>
                           </select>
                       </div>

                       <div className="p-4 bg-yellow-900/20 border border-yellow-700/30 rounded-lg">
                           <p className="text-xs text-yellow-400">
                               ⚠️ سيتم تطبيق التغييرات فوراً. إذا اخترت خطة تجريبية، سيتم تعيين تاريخ انتهاء تلقائياً.
                           </p>
                       </div>

                       <div className="flex gap-3 pt-4">
                           <button
                               onClick={handleSaveChangePlan}
                               className="flex-1 bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 flex items-center justify-center gap-2 transition-colors"
                           >
                               <Save size={18} /> حفظ التغييرات
                           </button>
                           <button
                               onClick={() => {
                                   setShowChangePlanModal(false);
                                   setChangingPlanUser(null);
                               }}
                               className="px-6 py-3 bg-slate-800 text-slate-300 rounded-xl font-bold hover:bg-slate-700 transition-colors"
                           >
                               إلغاء
                           </button>
                       </div>
                   </div>
               </div>
           </div>,
           document.body
       )}

       {showDetailsModal && selectedUser && createPortal(
           <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10000] p-4" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000 }}>
               <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl animate-fade-in" style={{ position: 'relative', zIndex: 10001 }}>
                   <div className="flex justify-between items-center p-6 border-b border-slate-800">
                       <h3 className="text-xl font-bold text-white flex items-center gap-2">
                           <Info size={20} />
                           بيانات المستخدم
                       </h3>
                       <button onClick={() => setShowDetailsModal(false)} className="text-slate-400 hover:text-white transition-colors">
                           <X size={24} />
                       </button>
                   </div>
                   <div className="p-6 space-y-4">
                       <div>
                           <label className="text-sm text-slate-400">الاسم</label>
                           <p className="text-white font-medium">{selectedUser.name}</p>
                       </div>
                       <div>
                           <label className="text-sm text-slate-400">البريد الإلكتروني</label>
                           <p className="text-white font-medium">{selectedUser.email}</p>
                       </div>
                       <div>
                           <label className="text-sm text-slate-400">رقم الهاتف</label>
                           <p className="text-white font-medium" dir="ltr">{selectedUser.phone || '—'}</p>
                       </div>
                       <div>
                           <label className="text-sm text-slate-400">تاريخ التسجيل</label>
                           <p className="text-white font-medium">{selectedUser.registrationDate.toLocaleDateString('ar-u-nu-latn')}</p>
                       </div>
                       <div>
                           <label className="text-sm text-slate-400">الباقة</label>
                           <p className="text-white font-medium">{selectedUser.plan}</p>
                       </div>
                       <div>
                           <label className="text-sm text-slate-400">الحالة</label>
                           <div className="mt-1">{getStatusBadge(selectedUser.status)}</div>
                       </div>
                   </div>
                   <div className="p-6 border-t border-slate-800 flex justify-end">
                       <button 
                           onClick={() => setShowDetailsModal(false)}
                           className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors"
                       >
                           إغلاق
                       </button>
                   </div>
               </div>
           </div>,
           document.body
       )}

       {/* Confirm Dialog */}
       <ConfirmDialog
           isOpen={confirmDialog.isOpen}
           title={confirmDialog.title}
           message={confirmDialog.message}
           type={confirmDialog.type}
           onConfirm={confirmDialog.onConfirm}
           onCancel={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
       />
    </div>
  );
};

export default AdminUsers;
