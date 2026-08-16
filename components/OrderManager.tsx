import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Order, OrderStatus } from '../types';
import { Package, Calendar, User, DollarSign, ShoppingCart, CheckCircle, XCircle, Clock, Trash2, Filter, X, Eye } from 'lucide-react';
import { useDebounce } from '../hooks/useDebounce';
import Pagination from './Pagination';
import { getOrderSourceBadgeClass, getOrderSourceLabel } from '../utils/orderSource';

interface OrderManagerProps {
  orders: Order[];
  storeCurrency: string;
  onSync?: () => void;
  isSyncing?: boolean;
  onUpdateOrderStatus?: (orderId: string, newStatus: OrderStatus) => void;
  onDeleteOrder: (orderId: string) => void; // Required prop for delete functionality
  onOrderViewed?: (orderId: string) => void; // Callback when order details are viewed
}

const OrderManager: React.FC<OrderManagerProps> = ({ orders, storeCurrency, onUpdateOrderStatus, onDeleteOrder, onOrderViewed }) => {
  const [filterStatus, setFilterStatus] = useState<OrderStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Delete functionality is always available when onDeleteOrder is provided
  const canDelete = true; // Since onDeleteOrder is now required

  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      const matchesStatus = filterStatus === 'all' || order.status === filterStatus;
      const matchesSearch = debouncedSearchQuery === '' || 
        order.customerName.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
        order.externalId?.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
        order.customerEmail.toLowerCase().includes(debouncedSearchQuery.toLowerCase());
      
      // Advanced filters
      const matchesDateFrom = !dateFrom || new Date(order.createdAt) >= new Date(dateFrom);
      const matchesDateTo = !dateTo || new Date(order.createdAt) <= new Date(dateTo + 'T23:59:59');
      const matchesMinAmount = !minAmount || order.total >= parseFloat(minAmount);
      const matchesMaxAmount = !maxAmount || order.total <= parseFloat(maxAmount);
      
      return matchesStatus && matchesSearch && matchesDateFrom && matchesDateTo && matchesMinAmount && matchesMaxAmount;
    });
  }, [orders, filterStatus, debouncedSearchQuery, dateFrom, dateTo, minAmount, maxAmount]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const paginatedOrders = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredOrders.slice(startIndex, endIndex);
  }, [filteredOrders, currentPage, itemsPerPage]);

  // Reset to page 1 when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, debouncedSearchQuery]);

  const statusLabels: Record<OrderStatus, string> = {
    pending: 'قيد الانتظار',
    paid: 'مدفوع',
    fulfilled: 'مكتمل',
    cancelled: 'ملغي'
  };

  const statusIcons: Record<OrderStatus, React.ReactNode> = {
    pending: <Clock size={16} className="text-yellow-500" />,
    paid: <CheckCircle size={16} className="text-blue-500" />,
    fulfilled: <CheckCircle size={16} className="text-green-500" />,
    cancelled: <XCircle size={16} className="text-red-500" />
  };

  const statusColors: Record<OrderStatus, string> = {
    pending: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    paid: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    fulfilled: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    cancelled: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
  };

  const totalRevenue = orders
    .filter(o => o.status === 'fulfilled' || o.status === 'paid')
    .reduce((sum, order) => sum + order.total, 0);

  const orderStats = {
    total: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    paid: orders.filter(o => o.status === 'paid').length,
    fulfilled: orders.filter(o => o.status === 'fulfilled').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('ar-EG-u-nu-latn', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG-u-nu-latn', {
      style: 'currency',
      currency: storeCurrency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Math.round(amount));
  };

  // Generate short unique order number
  const getShortOrderNumber = (order: Order): string => {
    // If externalId exists and is short, use it
    if (order.externalId && order.externalId.length <= 12) {
      return order.externalId;
    }
    
    // Generate short number from UUID (first 8 chars without dashes)
    const uuidWithoutDashes = order.id.replace(/-/g, '');
    const shortId = uuidWithoutDashes.substring(0, 8).toUpperCase();
    
    // Add prefix "ORD-" for clarity
    return `ORD-${shortId}`;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">إدارة الطلبات</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">عرض وإدارة جميع طلبات المتجر</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-sm">إجمالي الطلبات</p>
              <h3 className="text-2xl font-bold text-gray-800 dark:text-white mt-1">{orderStats.total}</h3>
            </div>
            <div className="p-3 bg-brand-50 dark:bg-brand-900/30 text-brand dark:text-brand rounded-full">
              <ShoppingCart size={20} />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-sm">قيد الانتظار</p>
              <h3 className="text-2xl font-bold text-gray-800 dark:text-white mt-1">{orderStats.pending}</h3>
            </div>
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 rounded-full">
              <Clock size={20} />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-sm">مدفوع</p>
              <h3 className="text-2xl font-bold text-gray-800 dark:text-white mt-1">{orderStats.paid}</h3>
            </div>
            <div className="p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full">
              <CheckCircle size={20} />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-sm">مكتمل</p>
              <h3 className="text-2xl font-bold text-gray-800 dark:text-white mt-1">{orderStats.fulfilled}</h3>
            </div>
            <div className="p-3 bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full">
              <CheckCircle size={20} />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-sm">إجمالي الإيرادات</p>
              <h3 className="text-xl font-bold text-gray-800 dark:text-white mt-1">{formatCurrency(totalRevenue)}</h3>
            </div>
            <div className="p-3 bg-brand-50 dark:bg-brand-900/30 text-brand dark:text-brand rounded-full">
              <DollarSign size={20} />
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="ابحث عن طلب (اسم العميل، رقم الطلب، البريد الإلكتروني)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                filterStatus === 'all'
                  ? 'bg-brand text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              الكل
            </button>
            {(['pending', 'paid', 'fulfilled', 'cancelled'] as OrderStatus[]).map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                  filterStatus === status
                    ? statusColors[status]
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {statusIcons[status]}
                {statusLabels[status]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Orders List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {filteredOrders.length === 0 ? (
          <div className="p-16 text-center">
            <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-full w-fit mx-auto mb-4">
              <Package size={48} className="text-gray-400 dark:text-gray-500" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              {orders.length === 0 ? 'لا توجد طلبات' : 'لا توجد طلبات مطابقة'}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {orders.length === 0
                ? 'قم بمزامنة الطلبات من Shopify أو أنشئ طلباً جديداً'
                : 'جرب تغيير الفلاتر أو البحث بكلمات مختلفة'}
            </p>
            {(dateFrom || dateTo || minAmount || maxAmount || searchQuery) && (
              <button
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                  setMinAmount('');
                  setMaxAmount('');
                  setSearchQuery('');
                  setFilterStatus('all');
                }}
                className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                مسح جميع الفلاتر
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    رقم الطلب
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    العميل
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    المنتجات
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    الكمية
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    المبلغ
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    الحالة
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    التاريخ
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    المصدر
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    الإجراءات
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {paginatedOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white font-mono">
                        {getShortOrderNumber(order)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <User size={16} className="text-gray-400" />
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {order.customerName}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {order.customerEmail}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {order.items.length} {order.items.length === 1 ? 'منتج' : 'منتجات'}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {order.items.slice(0, 2).map(item => item.productName).join('، ')}
                        {order.items.length > 2 && '...'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {order.items.reduce((sum, item) => sum + (item.quantity || 1), 0)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {order.items.map((item, idx) => (
                          <span key={idx}>
                            {item.productName}: {item.quantity || 1}
                            {idx < order.items.length - 1 && '، '}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {formatCurrency(order.total)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {onUpdateOrderStatus ? (
                        <select
                          value={order.status}
                          onChange={(e) => onUpdateOrderStatus(order.id, e.target.value as OrderStatus)}
                          className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand ${statusColors[order.status]}`}
                        >
                          {Object.entries(statusLabels).map(([value, label]) => (
                            <option key={value} value={value} className="bg-white dark:bg-gray-800">
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${statusColors[order.status]}`}>
                          {statusIcons[order.status]}
                          {statusLabels[order.status]}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                        <Calendar size={14} />
                        {formatDate(order.date)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`text-xs px-2 py-1 rounded ${getOrderSourceBadgeClass(order.source, order.notes)}`}>
                        {getOrderSourceLabel(order.source, order.notes)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => {
                            setSelectedOrder(order);
                            // ✅ Mark order as viewed when opening details
                            if (onOrderViewed) {
                              onOrderViewed(order.id);
                            }
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-brand dark:text-brand bg-brand-50 dark:bg-brand-900/30 hover:bg-brand-100 dark:hover:bg-brand-900/50 rounded-lg transition-colors"
                          title="عرض تفاصيل الطلب"
                        >
                          <Eye size={16} />
                          <span>تفاصيل</span>
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => setDeleteTarget(order)}
                            className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            title="حذف الطلب"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                itemsPerPage={itemsPerPage}
                totalItems={filteredOrders.length}
              />
            )}
          </div>
        )}
      </div>

      {/* Order Details Modal */}
      {selectedOrder && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10000] p-4 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 border border-gray-100 dark:border-gray-700 animate-fade-in relative z-[10001] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">تفاصيل الطلب</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  رقم الطلب: <span className="font-mono font-semibold">{getShortOrderNumber(selectedOrder)}</span>
                </p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6">
              {/* Customer Information */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <User size={16} />
                  معلومات العميل
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">الاسم:</span>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedOrder.customerName}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">البريد الإلكتروني:</span>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedOrder.customerEmail || 'غير متوفر'}</p>
                  </div>
                  {selectedOrder.customerPhone && (
                    <div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">الهاتف:</span>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedOrder.customerPhone}</p>
                    </div>
                  )}
                  {selectedOrder.customerAddress && (
                    <div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">العنوان:</span>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedOrder.customerAddress}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Order Items */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <ShoppingCart size={16} />
                  المنتجات ({selectedOrder.items.length})
                </h4>
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-900/50">
                      <tr>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                          المنتج
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                          الكمية
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                          السعر
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                          الإجمالي
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {selectedOrder.items.map((item, index) => (
                        <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{item.productName}</p>
                            {item.productId && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-1">ID: {item.productId.substring(0, 8)}...</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-gray-900 dark:text-white font-semibold">
                              {item.quantity}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-gray-900 dark:text-white">
                              {formatCurrency(item.price)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">
                              {formatCurrency(item.price * item.quantity)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 dark:bg-gray-900/50">
                      <tr>
                        <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-gray-700 dark:text-gray-300">
                          الإجمالي:
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-lg font-bold text-gray-900 dark:text-white">
                            {formatCurrency(selectedOrder.total)}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Order Status, Date, and Source */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">الحالة:</span>
                  <div className="mt-1">
                    {onUpdateOrderStatus ? (
                      <select
                        value={selectedOrder.status}
                        onChange={(e) => {
                          onUpdateOrderStatus(selectedOrder.id, e.target.value as OrderStatus);
                          setSelectedOrder({ ...selectedOrder, status: e.target.value as OrderStatus });
                        }}
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand ${statusColors[selectedOrder.status]}`}
                      >
                        {Object.entries(statusLabels).map(([value, label]) => (
                          <option key={value} value={value} className="bg-white dark:bg-gray-800">
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${statusColors[selectedOrder.status]}`}>
                        {statusIcons[selectedOrder.status]}
                        {statusLabels[selectedOrder.status]}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">التاريخ:</span>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                    {formatDate(selectedOrder.date)}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">المصدر:</span>
                  <div className="mt-1">
                    <span className={`text-xs px-2 py-1 rounded ${getOrderSourceBadgeClass(selectedOrder.source, selectedOrder.notes)}`}>
                      {getOrderSourceLabel(selectedOrder.source, selectedOrder.notes)}
                    </span>
                  </div>
                </div>
              </div>

              {selectedOrder.notes && (
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">ملاحظات:</span>
                  <p className="text-sm text-gray-900 dark:text-white mt-1 bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg">
                    {selectedOrder.notes}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedOrder(null)}
                className="px-4 py-2 rounded-lg bg-brand text-white hover:bg-brand-700 transition-colors"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && canDelete && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10000] p-4 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl p-6 border border-gray-100 dark:border-gray-700 animate-fade-in relative z-[10001]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl">
                <Trash2 size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">تأكيد حذف الطلب</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">سيتم حذف الطلب نهائياً ولا يمكن التراجع.</p>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">رقم الطلب:</span>
                <span className="text-sm font-bold text-gray-900 dark:text-white font-mono">
                  {getShortOrderNumber(deleteTarget)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">العميل:</span>
                <span className="text-sm font-bold text-gray-900 dark:text-white">
                  {deleteTarget.customerName}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">المبلغ:</span>
                <span className="text-sm font-bold text-gray-900 dark:text-white">
                  {formatCurrency(deleteTarget.total)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">الحالة:</span>
                <span className={`text-xs px-2 py-1 rounded-full ${statusColors[deleteTarget.status]}`}>
                  {statusLabels[deleteTarget.status]}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => {
                  onDeleteOrder(deleteTarget.id);
                  setDeleteTarget(null);
                }}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                حذف الطلب
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default OrderManager;
