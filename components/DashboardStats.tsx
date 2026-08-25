
import React, { useState, useEffect } from 'react';
import { Product } from '../types';
import { TrendingUp, Users, ShoppingBag, MessageCircle, MessageSquare, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';

interface DashboardStatsProps {
  products: Product[];
}

type TimeRange = '7days' | 'month' | 'year';

const DashboardStats: React.FC<DashboardStatsProps> = ({ products }) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('7days');
  const [totalQueries, setTotalQueries] = useState(0);
  const [repliedComments, setRepliedComments] = useState(0);
  const [chartData, setChartData] = useState<Array<{ name: string; queries: number }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const totalStock = products.reduce((acc, curr) => acc + curr.stock, 0);
  const lowStockProducts = products.filter(p => p.stock < 15).length;

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setIsLoading(true);
        const response = await apiService.getUserDashboardStats();
        logger.log('Dashboard stats response:', response);
        
        if (response && typeof response === 'object') {
          setTotalQueries(response.totalQueries || 0);
          setRepliedComments(response.repliedComments || 0);
          
          // Set chart data based on current time range
          if (response.chartData && response.chartData[timeRange]) {
            setChartData(response.chartData[timeRange]);
          }
        }
      } catch (error: any) {
        logger.error('Failed to fetch dashboard stats:', error);
        // Fallback to empty data
        setTotalQueries(0);
        setRepliedComments(0);
        setChartData([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, []); // Fetch once on mount

  // Update chart data when time range changes
  useEffect(() => {
    const fetchChartData = async () => {
      try {
        const response = await apiService.getUserDashboardStats();
        if (response && response.chartData && response.chartData[timeRange]) {
          setChartData(response.chartData[timeRange]);
        }
      } catch (error: any) {
        logger.error('Failed to fetch chart data:', error);
        setChartData([]);
      }
    };

    fetchChartData();
  }, [timeRange]);

  const getChartTitle = () => {
    switch (timeRange) {
      case '7days':
        return 'نشاط المحادثات (آخر 7 أيام)';
      case 'month':
        return 'نشاط المحادثات (آخر شهر)';
      case 'year':
        return 'نشاط المحادثات (آخر سنة)';
      default:
        return 'نشاط المحادثات';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between transition-colors">
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">إجمالي المنتجات</p>
            <h3 className="text-3xl font-bold text-gray-800 dark:text-white">{products.length}</h3>
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full">
            <ShoppingBag size={24} />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between transition-colors">
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">استفسارات العملاء</p>
            <h3 className="text-3xl font-bold text-gray-800 dark:text-white">{totalQueries}</h3>
          </div>
          <div className="p-3 bg-brand-50 dark:bg-brand-900/30 text-brand dark:text-brand rounded-full">
            <MessageCircle size={24} />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between transition-colors">
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">تعليقات رد عليها البوت</p>
            <h3 className="text-3xl font-bold text-gray-800 dark:text-white">{repliedComments}</h3>
          </div>
          <div className="p-3 bg-pink-50 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 rounded-full">
            <MessageSquare size={24} />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between transition-colors">
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">المخزون الكلي</p>
            <h3 className="text-3xl font-bold text-gray-800 dark:text-white">{totalStock}</h3>
          </div>
          <div className="p-3 bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full">
            <TrendingUp size={24} />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between transition-colors">
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">تنبيهات المخزون</p>
            <h3 className="text-3xl font-bold text-orange-600 dark:text-orange-400">{lowStockProducts}</h3>
          </div>
          <div className="p-3 bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-full">
            <Users size={24} />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 transition-colors">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white">{getChartTitle()}</h3>
          <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setTimeRange('7days')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                timeRange === '7days'
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
            >
              آخر 7 أيام
            </button>
            <button
              onClick={() => setTimeRange('month')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                timeRange === 'month'
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
            >
              آخر شهر
            </button>
            <button
              onClick={() => setTimeRange('year')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                timeRange === 'year'
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
            >
              آخر سنة
            </button>
          </div>
        </div>
        <div className="h-64 w-full min-h-[256px]" dir="ltr">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="animate-spin text-brand" size={32} />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={256} minHeight={256} minWidth={0}>
              <BarChart data={chartData} width={undefined} height={undefined}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" strokeOpacity={0.1} />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{fill: '#9CA3AF', fontSize: timeRange === 'year' ? 10 : 12}} 
                angle={timeRange === 'year' ? -45 : 0}
                textAnchor={timeRange === 'year' ? 'end' : 'middle'}
                height={timeRange === 'year' ? 60 : 30}
              />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#9CA3AF'}} />
              <Tooltip 
                cursor={{fill: 'transparent'}}
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="queries" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={timeRange === 'year' ? 30 : 40} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardStats;
