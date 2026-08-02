import React, { useState } from 'react';
import { Order, OrderStatus } from '../types';
import { Bell, X, ShoppingCart, CheckCircle, Clock, AlertCircle } from 'lucide-react';

interface OrderNotificationProps {
  newOrders: Order[];
  onViewOrders: () => void;
  onUpdateOrderStatus: (orderId: string, newStatus: OrderStatus) => void;
  onDismiss: () => void;
  onOrderViewed?: (orderId: string) => void;
}

const OrderNotification: React.FC<OrderNotificationProps> = ({ 
  newOrders, 
  onViewOrders, 
  onUpdateOrderStatus,
  onDismiss,
  onOrderViewed
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (newOrders.length === 0) return null;

  const statusLabels: Record<OrderStatus, string> = {
    pending: 'قيد الانتظار',
    paid: 'مدفوع',
    fulfilled: 'مكتمل',
    cancelled: 'ملغي'
  };

  const statusColors: Record<OrderStatus, string> = {
    pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    paid: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    fulfilled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
  };

  const handleStatusChange = (orderId: string, e: React.ChangeEvent<HTMLSelectElement>) => {
    onUpdateOrderStatus(orderId, e.target.value as OrderStatus);
  };

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-md">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="bg-brand text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Bell size={20} />
            </div>
            <div>
              <h3 className="font-bold text-lg">طلبات جديدة</h3>
              <p className="text-sm text-brand-100">
                {newOrders.length} {newOrders.length === 1 ? 'طلب جديد' : 'طلبات جديدة'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title={isExpanded ? 'إخفاء' : 'عرض التفاصيل'}
            >
              <ShoppingCart size={18} />
            </button>
            <button
              onClick={onDismiss}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="إغلاق"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="p-4 max-h-96 overflow-y-auto custom-scrollbar">
            <div className="space-y-3">
              {newOrders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => {
                    // Mark order as viewed when clicking on it
                    if (onOrderViewed) {
                      onOrderViewed(order.id);
                    }
                  }}
                  className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 border border-gray-200 dark:border-gray-600 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900 dark:text-white text-sm">
                        {order.externalId || order.id}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {order.customerName}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {order.items.length} {order.items.length === 1 ? 'منتج' : 'منتجات'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-brand dark:text-brand text-sm">
                        {order.total} {order.currency}
                      </p>
                    </div>
                  </div>

                  {/* Status Selector */}
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      حالة الطلب:
                    </label>
                    <select
                      value={order.status}
                      onChange={(e) => handleStatusChange(order.id, e)}
                      className={`w-full px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        statusColors[order.status]
                      } border-transparent focus:outline-none focus:ring-2 focus:ring-brand cursor-pointer`}
                    >
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            {/* View All Button */}
            <button
              onClick={onViewOrders}
              className="w-full mt-4 py-2.5 bg-brand hover:bg-brand-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <ShoppingCart size={18} />
              عرض جميع الطلبات
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderNotification;

