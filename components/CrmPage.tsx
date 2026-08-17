import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  UserCircle, 
  Search, 
  Plus, 
  Edit, 
  Trash2, 
  Filter, 
  X, 
  Mail, 
  Phone, 
  MapPin,
  ShoppingCart,
  MessageSquare,
  TrendingUp,
  Users,
  Banknote,
  Calendar,
  Tag,
  Star,
  Loader2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import apiService from '../services/api';
import { Customer, CustomerStats } from '../types';
import { logger } from '../utils/logger';
import { formatCurrency as formatCurrencyAmount } from '../utils/locale';

type CrmPageProps = {
  storeCurrency?: string;
};

const CrmPage: React.FC<CrmPageProps> = ({ storeCurrency = 'USD' }) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stats, setStats] = useState<CustomerStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    country: '',
    customerType: 'regular' as 'regular' | 'vip' | 'wholesale' | 'new',
    status: 'active' as 'active' | 'inactive' | 'blocked',
    notes: '',
    tags: [] as string[]
  });

  // Fetch stats
  const fetchStats = async () => {
    try {
      setIsLoadingStats(true);
      const response = await apiService.getCrmStats();
      setStats(response);
    } catch (err: any) {
      logger.error('Failed to fetch CRM stats:', err);
    } finally {
      setIsLoadingStats(false);
    }
  };

  // Fetch customers
  const fetchCustomers = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const params: any = {
        page: currentPage,
        limit
      };

      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      if (selectedType !== 'all') {
        params.customerType = selectedType;
      }
      if (selectedStatus !== 'all') {
        params.status = selectedStatus;
      }

      const response = await apiService.getCustomers(params);
      setCustomers(response.customers);
      setTotalPages(response.pagination.totalPages);
      setTotal(response.pagination.total);
    } catch (err: any) {
      logger.error('Failed to fetch customers:', err);
      setError('فشل تحميل بيانات العملاء');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [currentPage, searchQuery, selectedType, selectedStatus]);

  const handleAddCustomer = async () => {
    try {
      await apiService.createCustomer(formData);
      setShowAddModal(false);
      resetForm();
      fetchCustomers();
      fetchStats();
    } catch (err: any) {
      logger.error('Failed to create customer:', err);
      alert('فشل إضافة العميل: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const handleUpdateCustomer = async () => {
    if (!selectedCustomer) return;
    
    try {
      await apiService.updateCustomer(selectedCustomer.id, formData);
      setShowEditModal(false);
      resetForm();
      setSelectedCustomer(null);
      fetchCustomers();
      fetchStats();
    } catch (err: any) {
      logger.error('Failed to update customer:', err);
      alert('فشل تحديث العميل: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const handleDeleteCustomer = async () => {
    if (!customerToDelete) return;
    
    try {
      await apiService.deleteCustomer(customerToDelete);
      setShowDeleteConfirm(false);
      setCustomerToDelete(null);
      fetchCustomers();
      fetchStats();
    } catch (err: any) {
      logger.error('Failed to delete customer:', err);
      alert('فشل حذف العميل: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      phone: '',
      address: '',
      city: '',
      country: '',
      customerType: 'regular',
      status: 'active',
      notes: '',
      tags: []
    });
  };

  const openEditModal = (customer: Customer) => {
    setSelectedCustomer(customer);
    setFormData({
      name: customer.name,
      email: customer.email || '',
      phone: customer.phone || '',
      address: customer.address || '',
      city: customer.city || '',
      country: customer.country || '',
      customerType: customer.customerType,
      status: customer.status,
      notes: customer.notes || '',
      tags: customer.tags || []
    });
    setShowEditModal(true);
  };

  const openDeleteConfirm = (customerId: string) => {
    setCustomerToDelete(customerId);
    setShowDeleteConfirm(true);
  };

  const getCustomerTypeColor = (type: string) => {
    switch (type) {
      case 'vip': return 'bg-brand-100 dark:bg-brand/20 text-brand-700 dark:text-brand border-brand-300 dark:border-brand/50';
      case 'wholesale': return 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-500/50';
      case 'new': return 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-500/50';
      default: return 'bg-gray-100 dark:bg-gray-500/20 text-gray-700 dark:text-gray-400 border-gray-300 dark:border-gray-500/50';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400';
      case 'inactive': return 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400';
      case 'blocked': return 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400';
      default: return 'bg-gray-100 dark:bg-gray-500/20 text-gray-700 dark:text-gray-400';
    }
  };

  const currencyCode = (storeCurrency || 'USD').trim().toUpperCase() || 'USD';
  const formatCurrency = (amount: number) => formatCurrencyAmount(amount, currencyCode);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <UserCircle size={28} className="text-brand dark:text-brand" />
            إدارة العملاء (CRM)
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">إدارة قاعدة بيانات العملاء والتفاعلات</p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowAddModal(true);
          }}
          className="px-4 py-2 bg-brand hover:bg-brand-700 text-white rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-brand/25 hover:shadow-brand/40"
        >
          <Plus size={20} />
          إضافة عميل جديد
        </button>
      </div>

      {/* Stats Cards */}
      {isLoadingStats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-2"></div>
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-32"></div>
            </div>
          ))}
        </div>
      ) : stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-600 dark:text-gray-400 text-sm">إجمالي العملاء</p>
              <Users size={20} className="text-brand dark:text-brand" />
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalCustomers}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-600 dark:text-gray-400 text-sm">عملاء نشطون</p>
              <TrendingUp size={20} className="text-green-600 dark:text-green-400" />
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.activeCustomers}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-600 dark:text-gray-400 text-sm">عملاء VIP</p>
              <Star size={20} className="text-brand dark:text-brand" />
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.vipCustomers}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-600 dark:text-gray-400 text-sm">إجمالي الإيرادات</p>
              <Banknote size={20} className="text-green-600 dark:text-green-400" />
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(stats.totalRevenue)}</p>
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 shadow-lg">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={20} />
            <input
              type="text"
              placeholder="ابحث بالاسم، البريد الإلكتروني، أو رقم الهاتف..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 pr-10 pl-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            <Filter size={20} />
            فلترة
          </button>
        </div>

        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-2">نوع العميل</label>
              <select
                value={selectedType}
                onChange={(e) => {
                  setSelectedType(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
              >
                <option value="all">الكل</option>
                <option value="regular">عادي</option>
                <option value="vip">VIP</option>
                <option value="wholesale">جملة</option>
                <option value="new">جديد</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-2">الحالة</label>
              <select
                value={selectedStatus}
                onChange={(e) => {
                  setSelectedStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
              >
                <option value="all">الكل</option>
                <option value="active">نشط</option>
                <option value="inactive">غير نشط</option>
                <option value="blocked">محظور</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Customers Table */}
      {isLoading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="animate-spin text-brand" size={40} />
        </div>
      ) : error ? (
        <div className="bg-red-50 dark:bg-red-500/20 border border-red-200 dark:border-red-500/50 rounded-xl p-6 text-center">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      ) : customers.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-12 text-center shadow-lg">
          <UserCircle size={48} className="mx-auto text-gray-400 dark:text-gray-500 mb-4" />
          <p className="text-gray-600 dark:text-gray-400 text-lg">لا توجد عملاء</p>
          <p className="text-gray-500 dark:text-gray-500 text-sm mt-2">ابدأ بإضافة عميل جديد</p>
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900/50">
                  <tr>
                    <th className="px-6 py-4 text-right text-sm font-medium text-gray-700 dark:text-gray-300">العميل</th>
                    <th className="px-6 py-4 text-right text-sm font-medium text-gray-700 dark:text-gray-300">معلومات الاتصال</th>
                    <th className="px-6 py-4 text-right text-sm font-medium text-gray-700 dark:text-gray-300">النوع</th>
                    <th className="px-6 py-4 text-right text-sm font-medium text-gray-700 dark:text-gray-300">الحالة</th>
                    <th className="px-6 py-4 text-right text-sm font-medium text-gray-700 dark:text-gray-300">الطلبات</th>
                    <th className="px-6 py-4 text-right text-sm font-medium text-gray-700 dark:text-gray-300">إجمالي الإنفاق</th>
                    <th className="px-6 py-4 text-right text-sm font-medium text-gray-700 dark:text-gray-300">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {customers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{customer.name}</p>
                          {customer.tags && customer.tags.length > 0 && (
                            <div className="flex gap-1 mt-1">
                              {customer.tags.slice(0, 2).map((tag, idx) => (
                                <span key={idx} className="text-xs px-2 py-0.5 bg-brand-100 dark:bg-brand/20 text-brand dark:text-brand rounded">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          {customer.email && (
                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                              <Mail size={14} />
                              {customer.email}
                            </div>
                          )}
                          {customer.phone && (
                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                              <Phone size={14} />
                              {customer.phone}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getCustomerTypeColor(customer.customerType)}`}>
                          {customer.customerType === 'vip' ? 'VIP' : 
                           customer.customerType === 'wholesale' ? 'جملة' :
                           customer.customerType === 'new' ? 'جديد' : 'عادي'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(customer.status)}`}>
                          {customer.status === 'active' ? 'نشط' :
                           customer.status === 'inactive' ? 'غير نشط' : 'محظور'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-900 dark:text-white">{customer.totalOrders}</td>
                      <td className="px-6 py-4 text-gray-900 dark:text-white font-medium">{formatCurrency(customer.totalSpent)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditModal(customer)}
                            className="p-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/20 rounded-lg transition-colors"
                            title="تعديل"
                          >
                            <Edit size={18} />
                          </button>
                          <button
                            onClick={() => openDeleteConfirm(customer.id)}
                            className="p-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-lg transition-colors"
                            title="حذف"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-between items-center flex-wrap gap-4">
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                عرض {((currentPage - 1) * limit) + 1} - {Math.min(currentPage * limit, total)} من {total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={20} />
                </button>
                <span className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={20} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Add Customer Modal */}
      {showAddModal && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" 
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div 
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
            style={{ zIndex: 100000 }}
          >
            <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-800">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">إضافة عميل جديد</h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  resetForm();
                }}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">الاسم *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">البريد الإلكتروني</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">رقم الهاتف</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">نوع العميل</label>
                  <select
                    value={formData.customerType}
                    onChange={(e) => setFormData({ ...formData, customerType: e.target.value as any })}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                  >
                    <option value="regular">عادي</option>
                    <option value="vip">VIP</option>
                    <option value="wholesale">جملة</option>
                    <option value="new">جديد</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">المدينة</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">الدولة</label>
                  <input
                    type="text"
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">العنوان</label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  rows={2}
                  className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">ملاحظات</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                />
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  resetForm();
                }}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={handleAddCustomer}
                disabled={!formData.name.trim()}
                className="px-6 py-2 bg-brand hover:bg-brand-700 text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                إضافة
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Customer Modal */}
      {showEditModal && selectedCustomer && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" 
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div 
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
            style={{ zIndex: 100000 }}
          >
            <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-800">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">تعديل العميل</h3>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  resetForm();
                  setSelectedCustomer(null);
                }}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">الاسم *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">البريد الإلكتروني</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">رقم الهاتف</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">نوع العميل</label>
                  <select
                    value={formData.customerType}
                    onChange={(e) => setFormData({ ...formData, customerType: e.target.value as any })}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                  >
                    <option value="regular">عادي</option>
                    <option value="vip">VIP</option>
                    <option value="wholesale">جملة</option>
                    <option value="new">جديد</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">الحالة</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                  >
                    <option value="active">نشط</option>
                    <option value="inactive">غير نشط</option>
                    <option value="blocked">محظور</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">المدينة</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">الدولة</label>
                  <input
                    type="text"
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">العنوان</label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  rows={2}
                  className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">ملاحظات</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
                />
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowEditModal(false);
                  resetForm();
                  setSelectedCustomer(null);
                }}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={handleUpdateCustomer}
                disabled={!formData.name.trim()}
                className="px-6 py-2 bg-brand hover:bg-brand-700 text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                حفظ التغييرات
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" 
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div 
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl w-full max-w-md shadow-2xl"
            style={{ zIndex: 100000 }}
          >
            <div className="p-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">تأكيد الحذف</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">هل أنت متأكد من حذف هذا العميل؟ لا يمكن التراجع عن هذا الإجراء.</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setCustomerToDelete(null);
                  }}
                  className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleDeleteCustomer}
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors"
                >
                  حذف
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default CrmPage;

