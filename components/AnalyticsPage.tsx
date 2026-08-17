import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  DollarSign, 
  ShoppingCart, 
  Users, 
  MessageSquare,
  Package,
  Calendar,
  Download,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';
import apiService from '../services/api';
import { logger } from '../utils/logger';
import { AR_SA_LATN, formatCurrency as formatCurrencyAmount } from '../utils/locale';

type Period = '7days' | '30days' | '90days' | 'year';
type Tab = 'overview' | 'sales' | 'conversations' | 'products';

const AnalyticsPage: React.FC<{ storeCurrency?: string }> = ({ storeCurrency = 'USD' }) => {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [period, setPeriod] = useState<Period>('30days');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Overview data
  const [overviewData, setOverviewData] = useState<any>(null);
  
  // Sales data
  const [salesData, setSalesData] = useState<any>(null);
  
  // Conversation data
  const [conversationData, setConversationData] = useState<any>(null);
  
  // Product data
  const [productData, setProductData] = useState<any>(null);

  // Enhanced color palette for charts
  const COLORS = [
    '#6366f1', // Indigo
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#f59e0b', // Amber
    '#10b981', // Emerald
    '#3b82f6', // Blue
    '#06b6d4', // Cyan
    '#f97316'  // Orange
  ];
  
  // Gradient colors for cards
  const CARD_GRADIENTS = {
    revenue: 'from-emerald-500/20 via-emerald-500/10 to-transparent',
    avgOrder: 'from-blue-500/20 via-blue-500/10 to-transparent',
    conversations: 'from-brand/20 via-brand/10 to-transparent',
    growth: 'from-brand/20 via-brand/10 to-transparent'
  };

  // Fetch overview data
  const fetchOverviewData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await apiService.getAnalyticsDashboard(period);
      setOverviewData(data);
    } catch (err: any) {
      logger.error('Failed to fetch overview analytics:', err);
      // Check if error is about plan limits
      if (err?.message?.includes('التحليلات المتقدمة غير متاحة')) {
        setError('التحليلات المتقدمة غير متاحة في خطتك الحالية. يرجى ترقية خطتك للوصول إلى هذه الميزة.');
      } else {
        setError('فشل تحميل بيانات التحليلات');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch sales data
  const fetchSalesData = async () => {
    try {
      const data = await apiService.getSalesAnalytics(period, 'day');
      setSalesData(data);
    } catch (err: any) {
      logger.error('Failed to fetch sales analytics:', err);
    }
  };

  // Fetch conversation data
  const fetchConversationData = async () => {
    try {
      const data = await apiService.getConversationAnalytics(period);
      setConversationData(data);
    } catch (err: any) {
      logger.error('Failed to fetch conversation analytics:', err);
    }
  };

  // Fetch product data
  const fetchProductData = async () => {
    try {
      const data = await apiService.getProductAnalytics(period);
      setProductData(data);
    } catch (err: any) {
      logger.error('Failed to fetch product analytics:', err);
    }
  };

  useEffect(() => {
    if (activeTab === 'overview') {
      fetchOverviewData();
    } else if (activeTab === 'sales') {
      fetchSalesData();
    } else if (activeTab === 'conversations') {
      fetchConversationData();
    } else if (activeTab === 'products') {
      fetchProductData();
    }
  }, [activeTab, period]);

  const formatCurrency = (amount: number) =>
    formatCurrencyAmount(
      amount,
      storeCurrency || 'USD',
      { minimumFractionDigits: 2 },
      AR_SA_LATN
    );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ar-SA-u-nu-latn', { 
      month: 'short', 
      day: 'numeric' 
    });
  };

  if (isLoading && !overviewData && !salesData && !conversationData && !productData) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="animate-spin text-brand" size={40} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto text-red-600 dark:text-red-400 mb-4" size={48} />
          <p className="text-red-600 dark:text-red-400 text-lg">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BarChart3 size={28} className="text-brand dark:text-brand" />
            التحليلات والتقارير
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">تحليلات شاملة لأداء متجرك</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg py-2 px-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-colors"
          >
            <option value="7days">آخر 7 أيام</option>
            <option value="30days">آخر 30 يوم</option>
            <option value="90days">آخر 90 يوم</option>
            <option value="year">آخر سنة</option>
          </select>
          <button className="px-4 py-2 bg-brand hover:bg-brand-600 text-white rounded-lg flex items-center gap-2 transition-all shadow-lg shadow-brand/25 hover:shadow-brand/40">
            <Download size={18} />
            تصدير تقرير
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {[
          { id: 'overview', label: 'نظرة عامة', icon: BarChart3 },
          { id: 'sales', label: 'المبيعات', icon: DollarSign },
          { id: 'conversations', label: 'المحادثات', icon: MessageSquare },
          { id: 'products', label: 'المنتجات', icon: Package }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as Tab)}
            className={`px-6 py-3 font-medium transition-all border-b-2 whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-brand text-brand dark:text-brand bg-brand-50 dark:bg-brand/10'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800/50'
            }`}
          >
            <div className="flex items-center gap-2">
              <tab.icon size={18} />
              {tab.label}
            </div>
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && overviewData && (
        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-emerald-200 dark:border-emerald-500/30 shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 transition-all">
              <div className="flex items-center justify-between mb-2">
                <p className="text-gray-600 dark:text-gray-300 text-sm font-medium">إجمالي الإيرادات</p>
                <div className="p-2 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg">
                  <DollarSign size={20} className="text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{formatCurrency(overviewData.sales.totalRevenue)}</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium">{overviewData.sales.totalOrders} طلب</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-blue-200 dark:border-blue-500/30 shadow-lg shadow-blue-500/10 hover:shadow-blue-500/20 transition-all">
              <div className="flex items-center justify-between mb-2">
                <p className="text-gray-600 dark:text-gray-300 text-sm font-medium">متوسط قيمة الطلب</p>
                <div className="p-2 bg-blue-100 dark:bg-blue-500/20 rounded-lg">
                  <ShoppingCart size={20} className="text-blue-600 dark:text-blue-400" />
                </div>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{formatCurrency(overviewData.sales.avgOrderValue)}</p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-medium">{overviewData.sales.uniqueCustomers} عميل</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-brand-200 dark:border-brand/30 shadow-lg shadow-brand/10 hover:shadow-brand/20 transition-all">
              <div className="flex items-center justify-between mb-2">
                <p className="text-gray-600 dark:text-gray-300 text-sm font-medium">المحادثات</p>
                <div className="p-2 bg-brand-100 dark:bg-brand/20 rounded-lg">
                  <MessageSquare size={20} className="text-brand dark:text-brand" />
                </div>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{overviewData.conversations.totalConversations}</p>
              <p className="text-xs text-brand dark:text-brand mt-1 font-medium">{overviewData.conversations.conversionRate}% معدل التحويل</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-brand-200 dark:border-brand/30 shadow-lg shadow-brand/10 hover:shadow-brand/20 transition-all">
              <div className="flex items-center justify-between mb-2">
                <p className="text-gray-600 dark:text-gray-300 text-sm font-medium">نمو العملاء</p>
                <div className="p-2 bg-brand-100 dark:bg-brand/20 rounded-lg">
                  <Users size={20} className="text-brand dark:text-brand" />
                </div>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                {overviewData.customerGrowth.reduce((sum: number, item: any) => sum + item.count, 0)}
              </p>
              <p className="text-xs text-brand dark:text-brand mt-1 font-medium">عميل جديد</p>
            </div>
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue Over Time */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <TrendingUp size={20} className="text-emerald-600 dark:text-emerald-400" />
                الإيرادات عبر الزمن
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={overviewData.ordersOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" opacity={0.3} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#94a3b8"
                    tickFormatter={formatDate}
                    style={{ fontSize: '12px' }}
                  />
                  <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#0f172a', 
                      border: '1px solid #475569', 
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
                    }}
                    formatter={(value: any) => formatCurrency(value)}
                    labelStyle={{ color: '#cbd5e1' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="url(#revenueGradient)" 
                    strokeWidth={3}
                    dot={{ fill: '#10b981', r: 5, strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 7, fill: '#10b981' }}
                  />
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.3} />
                    </linearGradient>
                  </defs>
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Platform Distribution */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <BarChart3 size={20} className="text-brand dark:text-brand" />
                توزيع المنصات
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={overviewData.platformDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={(entry: any) => `${entry.platform}: ${entry.count}`}
                    outerRadius={110}
                    innerRadius={40}
                    fill="#8884d8"
                    dataKey="count"
                    paddingAngle={2}
                  >
                    {overviewData.platformDistribution.map((entry: any, index: number) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={COLORS[index % COLORS.length]}
                        stroke="#0f172a"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#0f172a', 
                      border: '1px solid #475569', 
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
                    }}
                    labelStyle={{ color: '#cbd5e1' }}
                  />
                  <Legend 
                    wrapperStyle={{ color: '#cbd5e1', fontSize: '12px' }}
                    iconType="circle"
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Products */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Package size={20} className="text-brand dark:text-brand" />
                أفضل المنتجات مبيعاً
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={overviewData.topProducts.slice(0, 5)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" opacity={0.3} />
                  <XAxis 
                    dataKey="name" 
                    stroke="#94a3b8"
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    style={{ fontSize: '11px' }}
                  />
                  <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#0f172a', 
                      border: '1px solid #475569', 
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
                    }}
                    formatter={(value: any) => formatCurrency(value)}
                    labelStyle={{ color: '#cbd5e1' }}
                  />
                  <Bar 
                    dataKey="revenue" 
                    fill="url(#barGradient)"
                    radius={[8, 8, 0, 0]}
                  />
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={1} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.8} />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Customer Growth */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Users size={20} className="text-cyan-600 dark:text-cyan-400" />
                نمو العملاء
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={overviewData.customerGrowth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" opacity={0.3} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#94a3b8"
                    tickFormatter={formatDate}
                    style={{ fontSize: '12px' }}
                  />
                  <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#0f172a', 
                      border: '1px solid #475569', 
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
                    }}
                    labelStyle={{ color: '#cbd5e1' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="count" 
                    stroke="url(#growthGradient)" 
                    strokeWidth={3}
                    dot={{ fill: '#06b6d4', r: 5, strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 7, fill: '#06b6d4' }}
                  />
                  <defs>
                    <linearGradient id="growthGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity={1} />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.3} />
                    </linearGradient>
                  </defs>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Common Questions */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <MessageSquare size={20} className="text-amber-600 dark:text-amber-400" />
              الأسئلة الأكثر شيوعاً
            </h3>
            <div className="space-y-3">
              {overviewData.commonQuestions.slice(0, 5).map((item: any, index: number) => (
                <div key={index} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700/50 hover:border-amber-500/30 transition-all hover:shadow-md">
                  <p className="text-gray-700 dark:text-gray-200 flex-1 font-medium">{item.question}</p>
                  <span className="px-4 py-1.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-600 dark:text-amber-400 rounded-full text-sm font-semibold border border-amber-500/30">
                    {item.frequency} مرة
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sales Tab */}
      {activeTab === 'sales' && salesData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <TrendingUp size={20} className="text-emerald-600 dark:text-emerald-400" />
                المبيعات عبر الزمن
              </h3>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={salesData.salesOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" opacity={0.3} />
                  <XAxis 
                    dataKey="period" 
                    stroke="#94a3b8"
                    tickFormatter={formatDate}
                    style={{ fontSize: '12px' }}
                  />
                  <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#0f172a', 
                      border: '1px solid #475569', 
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
                    }}
                    formatter={(value: any) => formatCurrency(value)}
                    labelStyle={{ color: '#cbd5e1' }}
                  />
                  <Bar 
                    dataKey="revenue" 
                    fill="url(#salesBarGradient)"
                    radius={[8, 8, 0, 0]}
                  />
                  <defs>
                    <linearGradient id="salesBarGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                      <stop offset="100%" stopColor="#059669" stopOpacity={0.8} />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <BarChart3 size={20} className="text-pink-600 dark:text-pink-400" />
                حالة الطلبات
              </h3>
              <ResponsiveContainer width="100%" height={400}>
                <PieChart>
                  <Pie
                    data={salesData.statusBreakdown}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={(entry: any) => `${entry.status}: ${entry.count}`}
                    outerRadius={120}
                    innerRadius={50}
                    fill="#8884d8"
                    dataKey="count"
                    paddingAngle={3}
                  >
                    {salesData.statusBreakdown.map((entry: any, index: number) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={COLORS[index % COLORS.length]}
                        stroke="#0f172a"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#0f172a', 
                      border: '1px solid #475569', 
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
                    }}
                    labelStyle={{ color: '#cbd5e1' }}
                  />
                  <Legend 
                    wrapperStyle={{ color: '#cbd5e1', fontSize: '12px' }}
                    iconType="circle"
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Package size={20} className="text-brand dark:text-brand" />
              الإيرادات حسب الفئة
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={salesData.categoryRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" opacity={0.3} />
                <XAxis dataKey="category" stroke="#94a3b8" style={{ fontSize: '12px' }} />
                <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#0f172a', 
                    border: '1px solid #475569', 
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
                  }}
                  formatter={(value: any) => formatCurrency(value)}
                  labelStyle={{ color: '#cbd5e1' }}
                />
                <Bar 
                  dataKey="revenue" 
                  fill="url(#categoryBarGradient)"
                  radius={[8, 8, 0, 0]}
                />
                <defs>
                  <linearGradient id="categoryBarGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.8} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Conversations Tab */}
      {activeTab === 'conversations' && conversationData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-cyan-200 dark:border-cyan-500/30 shadow-lg shadow-cyan-500/10">
              <div className="flex items-center justify-between mb-2">
                <p className="text-gray-600 dark:text-gray-300 text-sm font-medium">متوسط وقت الرد</p>
                <div className="p-2 bg-cyan-100 dark:bg-cyan-500/20 rounded-lg">
                  <MessageSquare size={18} className="text-cyan-600 dark:text-cyan-400" />
                </div>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                {Math.round(conversationData.avgResponseTime)} ثانية
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-pink-200 dark:border-pink-500/30 shadow-lg shadow-pink-500/10">
              <div className="flex items-center justify-between mb-2">
                <p className="text-gray-600 dark:text-gray-300 text-sm font-medium">إجمالي المحادثات</p>
                <div className="p-2 bg-pink-100 dark:bg-pink-500/20 rounded-lg">
                  <MessageSquare size={18} className="text-pink-600 dark:text-pink-400" />
                </div>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                {conversationData.conversationsOverTime.reduce((sum: number, item: any) => sum + item.count, 0)}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-amber-200 dark:border-amber-500/30 shadow-lg shadow-amber-500/10">
              <div className="flex items-center justify-between mb-2">
                <p className="text-gray-600 dark:text-gray-300 text-sm font-medium">ساعات الذروة</p>
                <div className="p-2 bg-amber-100 dark:bg-amber-500/20 rounded-lg">
                  <Calendar size={18} className="text-amber-600 dark:text-amber-400" />
                </div>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                {conversationData.peakHours[0]?.hour || 'N/A'}:00
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <TrendingUp size={20} className="text-pink-600 dark:text-pink-400" />
                المحادثات عبر الزمن
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={conversationData.conversationsOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" opacity={0.3} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#94a3b8"
                    tickFormatter={formatDate}
                    style={{ fontSize: '12px' }}
                  />
                  <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#0f172a', 
                      border: '1px solid #475569', 
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
                    }}
                    labelStyle={{ color: '#cbd5e1' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="count" 
                    stroke="url(#conversationGradient)" 
                    strokeWidth={3}
                    dot={{ fill: '#ec4899', r: 5, strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 7, fill: '#ec4899' }}
                  />
                  <defs>
                    <linearGradient id="conversationGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ec4899" stopOpacity={1} />
                      <stop offset="100%" stopColor="#ec4899" stopOpacity={0.3} />
                    </linearGradient>
                  </defs>
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Calendar size={20} className="text-amber-600 dark:text-amber-400" />
                ساعات الذروة
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={conversationData.peakHours}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" opacity={0.3} />
                  <XAxis dataKey="hour" stroke="#94a3b8" style={{ fontSize: '12px' }} />
                  <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#0f172a', 
                      border: '1px solid #475569', 
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
                    }}
                    labelStyle={{ color: '#cbd5e1' }}
                  />
                  <Bar 
                    dataKey="count" 
                    fill="url(#peakHoursGradient)"
                    radius={[8, 8, 0, 0]}
                  />
                  <defs>
                    <linearGradient id="peakHoursGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
                      <stop offset="100%" stopColor="#f97316" stopOpacity={0.8} />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Products Tab */}
      {activeTab === 'products' && productData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <TrendingUp size={20} className="text-brand dark:text-brand" />
                أفضل المنتجات أداءً
              </h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {productData.topProducts.map((product: any, index: number) => (
                  <div key={product.id} className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700/50 hover:border-brand/30 transition-all hover:shadow-md">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">{product.name}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{product.category}</p>
                      </div>
                      <span className="px-3 py-1 bg-gradient-to-r from-brand/20 to-brand/20 text-brand dark:text-brand rounded-full text-xs font-semibold border border-brand/30">
                        #{index + 1}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
                      <div className="p-2 bg-white dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                        <p className="text-gray-600 dark:text-gray-400 text-xs mb-1">الطلبات</p>
                        <p className="text-gray-900 dark:text-white font-bold">{product.orderCount}</p>
                      </div>
                      <div className="p-2 bg-white dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                        <p className="text-gray-600 dark:text-gray-400 text-xs mb-1">الكمية المباعة</p>
                        <p className="text-gray-900 dark:text-white font-bold">{product.totalQuantitySold}</p>
                      </div>
                      <div className="p-2 bg-white dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                        <p className="text-gray-600 dark:text-gray-400 text-xs mb-1">الإيرادات</p>
                        <p className="text-emerald-600 dark:text-emerald-400 font-bold">{formatCurrency(product.revenue)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <AlertCircle size={20} className="text-red-600 dark:text-red-400" />
                منتجات قليلة المخزون
              </h3>
              <div className="space-y-3">
                {productData.lowStockProducts.length > 0 ? (
                  productData.lowStockProducts.map((product: any) => (
                    <div key={product.id} className="p-4 bg-gradient-to-r from-red-50 dark:from-red-500/10 via-red-50/50 dark:via-red-500/5 to-transparent border border-red-200 dark:border-red-500/30 rounded-lg hover:border-red-500/50 transition-all">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-white">{product.name}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{product.category}</p>
                        </div>
                        <span className="px-3 py-1.5 bg-gradient-to-r from-red-500/20 to-orange-500/20 text-red-600 dark:text-red-400 rounded-full text-sm font-semibold border border-red-500/30">
                          {product.stock} متبقي
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-600 dark:text-gray-400">
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-lg">
                      <p className="text-emerald-600 dark:text-emerald-400 font-medium">لا توجد منتجات قليلة المخزون</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsPage;

