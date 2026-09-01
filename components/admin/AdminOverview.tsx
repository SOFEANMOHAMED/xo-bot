
import React, { useEffect, useState } from 'react';
import { AdminStats } from '../../types';
import apiService from '../../services/api';
import { Users, UserCheck, DollarSign, MessageSquare, TrendingUp, Loader2, TrendingDown, AlertCircle, ArrowUpRight, Calendar } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { logger } from '../../utils/logger';
import { formatTokenCount, formatUsdCost } from '../../utils/formatLlmCost';

const AdminOverview: React.FC = () => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartData, setChartData] = useState<{
    newUsers: Array<{ name: string; users: number }>;
    aiUsage: Array<{ name: string; calls: number }>;
  } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Fetch stats and chart data in parallel
        const [statsResponse, chartResponse] = await Promise.all([
          apiService.getAdminStats(),
          apiService.getAdminChartData()
        ]);
        
        setStats({
          totalUsers: statsResponse.totalUsers,
          activeUsersMonth: statsResponse.activeUsersMonth,
          paidSubscriptions: statsResponse.paidSubscriptions,
          totalAiResponses: statsResponse.totalAiResponses,
          estimatedMrr: statsResponse.estimatedMrr,
          arpu: statsResponse.arpu || 0,
          churnRate: statsResponse.churnRate || 0,
          conversionRate: statsResponse.conversionRate || 0,
          trialsEndingSoon: statsResponse.trialsEndingSoon || 0,
          arr: statsResponse.arr || 0,
          newUsersToday: statsResponse.newUsersToday || 0,
          newUsersThisWeek: statsResponse.newUsersThisWeek || 0,
          newUsersThisMonth: statsResponse.newUsersThisMonth || 0,
          llmTokens: statsResponse.llmTokens || 0,
          llmCostUsd: statsResponse.llmCostUsd || 0,
          llmTokensThisMonth: statsResponse.llmTokensThisMonth || 0,
          llmCostUsdThisMonth: statsResponse.llmCostUsdThisMonth || 0,
          llmPlatformCostUsdThisMonth: statsResponse.llmPlatformCostUsdThisMonth || 0
        });
        
        setChartData({
          newUsers: chartResponse.newUsers,
          aiUsage: chartResponse.aiUsage
        });
      } catch (err: any) {
        logger.error('Failed to fetch admin data:', err);
        setError(err.message || 'فشل تحميل الإحصائيات');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchData();
  }, []);

  if (isLoading) {
    return <div className="flex h-96 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={40} /></div>;
  }

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-2">❌ خطأ في تحميل البيانات</p>
          <p className="text-slate-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!stats || !chartData) {
    return <div className="flex h-96 items-center justify-center text-slate-400">لا توجد بيانات</div>;
  }

  // Use real data from API
  const newUsersData = chartData.newUsers;
  const aiUsageData = chartData.aiUsage;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* KPI Cards - Row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-slate-400 text-xs lg:text-sm mb-1 truncate">إجمالي المستخدمين</p>
            <h3 className="text-2xl lg:text-3xl font-bold text-white">{stats.totalUsers}</h3>
          </div>
          <div className="p-2 lg:p-3 bg-blue-900/30 text-blue-400 rounded-full flex-shrink-0">
            <Users size={20} className="lg:w-6 lg:h-6" />
          </div>
        </div>

        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-slate-400 text-xs lg:text-sm mb-1 truncate">النشطون هذا الشهر</p>
            <h3 className="text-2xl lg:text-3xl font-bold text-white">{stats.activeUsersMonth}</h3>
          </div>
          <div className="p-2 lg:p-3 bg-green-900/30 text-green-400 rounded-full flex-shrink-0">
            <UserCheck size={20} className="lg:w-6 lg:h-6" />
          </div>
        </div>

        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-slate-400 text-xs lg:text-sm mb-1 truncate">الإيرادات الشهرية (MRR)</p>
            <h3 className="text-2xl lg:text-3xl font-bold text-white">{stats.estimatedMrr.toLocaleString('en-US')} $</h3>
            <p className="text-xs text-slate-500 mt-1">ARR: {stats.arr.toLocaleString('en-US')} $</p>
          </div>
          <div className="p-2 lg:p-3 bg-indigo-900/30 text-indigo-400 rounded-full flex-shrink-0">
            <DollarSign size={20} className="lg:w-6 lg:h-6" />
          </div>
        </div>

        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-slate-400 text-xs lg:text-sm mb-1 truncate">ردود الذكاء الاصطناعي</p>
            <h3 className="text-2xl lg:text-3xl font-bold text-white">{stats.totalAiResponses.toLocaleString('en-US')}</h3>
          </div>
          <div className="p-2 lg:p-3 bg-purple-900/30 text-purple-400 rounded-full flex-shrink-0">
            <MessageSquare size={20} className="lg:w-6 lg:h-6" />
          </div>
        </div>
      </div>

      {/* KPI Cards - Row 2 (New Metrics) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-slate-400 text-xs lg:text-sm mb-1 truncate">متوسط الإيراد لكل مستخدم (ARPU)</p>
            <h3 className="text-2xl lg:text-3xl font-bold text-white">{stats.arpu.toFixed(2)} $</h3>
          </div>
          <div className="p-2 lg:p-3 bg-yellow-900/30 text-yellow-400 rounded-full flex-shrink-0">
            <TrendingUp size={20} className="lg:w-6 lg:h-6" />
          </div>
        </div>

        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-slate-400 text-xs lg:text-sm mb-1 truncate">معدل التحويل</p>
            <h3 className="text-2xl lg:text-3xl font-bold text-white">{stats.conversionRate.toFixed(1)}%</h3>
            <p className="text-xs text-slate-500 mt-1">تجربة → مدفوعة</p>
          </div>
          <div className="p-2 lg:p-3 bg-emerald-900/30 text-emerald-400 rounded-full flex-shrink-0">
            <ArrowUpRight size={20} className="lg:w-6 lg:h-6" />
          </div>
        </div>

        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-slate-400 text-xs lg:text-sm mb-1 truncate">معدل الإلغاء (Churn)</p>
            <h3 className="text-2xl lg:text-3xl font-bold text-white">{stats.churnRate.toFixed(1)}%</h3>
            <p className="text-xs text-slate-500 mt-1">آخر 30 يوم</p>
          </div>
          <div className="p-2 lg:p-3 bg-red-900/30 text-red-400 rounded-full flex-shrink-0">
            <TrendingDown size={20} className="lg:w-6 lg:h-6" />
          </div>
        </div>

        <div className={`bg-slate-800 p-4 lg:p-6 rounded-2xl border ${stats.trialsEndingSoon > 0 ? 'border-orange-500/50' : 'border-slate-700'} shadow-sm flex items-center justify-between`}>
          <div className="flex-1 min-w-0">
            <p className="text-slate-400 text-xs lg:text-sm mb-1 truncate">تجارب تنتهي قريباً</p>
            <h3 className="text-2xl lg:text-3xl font-bold text-white">{stats.trialsEndingSoon}</h3>
            <p className="text-xs text-slate-500 mt-1">خلال 7 أيام</p>
          </div>
          <div className={`p-2 lg:p-3 ${stats.trialsEndingSoon > 0 ? 'bg-orange-900/30 text-orange-400' : 'bg-slate-700/30 text-slate-400'} rounded-full flex-shrink-0`}>
            <AlertCircle size={20} className="lg:w-6 lg:h-6" />
          </div>
        </div>
      </div>

      {/* New Users Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6">
        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-400 text-xs lg:text-sm">مستخدمون جدد اليوم</p>
            <Calendar size={16} className="text-blue-400" />
          </div>
          <h3 className="text-2xl lg:text-3xl font-bold text-white">{stats.newUsersToday}</h3>
        </div>

        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-400 text-xs lg:text-sm">مستخدمون جدد هذا الأسبوع</p>
            <Calendar size={16} className="text-green-400" />
          </div>
          <h3 className="text-2xl lg:text-3xl font-bold text-white">{stats.newUsersThisWeek}</h3>
        </div>

        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-400 text-xs lg:text-sm">مستخدمون جدد هذا الشهر</p>
            <Calendar size={16} className="text-indigo-400" />
          </div>
          <h3 className="text-2xl lg:text-3xl font-bold text-white">{stats.newUsersThisMonth}</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm">
          <p className="text-slate-400 text-xs lg:text-sm mb-1">تكلفة GPT-4o mini هذا الشهر</p>
          <h3 className="text-2xl lg:text-3xl font-bold text-emerald-400" dir="ltr">{formatUsdCost(stats.llmCostUsdThisMonth)}</h3>
          <p className="text-xs text-slate-500 mt-1">تجار المنصة فقط</p>
        </div>
        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm">
          <p className="text-slate-400 text-xs lg:text-sm mb-1">توكنات التجار هذا الشهر</p>
          <h3 className="text-2xl lg:text-3xl font-bold text-white" dir="ltr">{formatTokenCount(stats.llmTokensThisMonth)}</h3>
          <p className="text-xs text-slate-500 mt-1">إجمالي كل الفترات: {formatTokenCount(stats.llmTokens)}</p>
        </div>
        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm">
          <p className="text-slate-400 text-xs lg:text-sm mb-1">التكلفة الإجمالية (كل الفترات)</p>
          <h3 className="text-2xl lg:text-3xl font-bold text-indigo-300" dir="ltr">{formatUsdCost(stats.llmCostUsd)}</h3>
          <p className="text-xs text-slate-500 mt-1">منصة هذا الشهر: {formatUsdCost(stats.llmPlatformCostUsdThisMonth)}</p>
        </div>
      </div>

      {/* Alerts Section */}
      {stats.trialsEndingSoon > 0 && (
        <div className="bg-gradient-to-r from-orange-900/20 to-red-900/20 border border-orange-500/50 rounded-2xl p-4 lg:p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-900/30 text-orange-400 rounded-full">
                <AlertCircle size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">تنبيه: تجارب تنتهي قريباً</h3>
                <p className="text-sm text-slate-300">
                  يوجد {stats.trialsEndingSoon} تجربة مجانية ستنتهي خلال 7 أيام القادمة
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                // This will be handled by parent component navigation
                const event = new CustomEvent('admin-navigate', { detail: { view: 'TRIALS' } });
                window.dispatchEvent(event);
              }}
              className="text-orange-400 hover:text-orange-300 text-sm font-bold flex items-center gap-1 transition-colors"
            >
              عرض التفاصيل
              <ArrowUpRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm">
           <h3 className="text-base lg:text-lg font-bold text-white mb-4 lg:mb-6 flex items-center gap-2">
             <TrendingUp size={18} className="text-green-400" />
             <span className="text-sm lg:text-base">نمو المستخدمين (آخر 7 أيام)</span>
           </h3>
           <div className="h-48 sm:h-56 lg:h-64 w-full min-w-0" dir="ltr">
             <ResponsiveContainer width="100%" height="100%">
                <BarChart data={newUsersData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#94a3b8', fontSize: 12}}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#94a3b8', fontSize: 12}}
                    width={40}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                    itemStyle={{ color: '#fff' }}
                    cursor={{fill: '#334155', opacity: 0.2}}
                  />
                  <Bar dataKey="users" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={30} />
                </BarChart>
             </ResponsiveContainer>
           </div>
        </div>

        <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700 shadow-sm">
           <h3 className="text-base lg:text-lg font-bold text-white mb-4 lg:mb-6 flex items-center gap-2">
             <MessageSquare size={18} className="text-purple-400" />
             <span className="text-sm lg:text-base">نشاط الذكاء الاصطناعي (آخر 7 أيام)</span>
           </h3>
           <div className="h-48 sm:h-56 lg:h-64 w-full min-w-0" dir="ltr">
             <ResponsiveContainer width="100%" height="100%">
                <LineChart data={aiUsageData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#94a3b8', fontSize: 12}}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#94a3b8', fontSize: 12}}
                    width={40}
                  />
                  <Tooltip 
                     contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                     itemStyle={{ color: '#fff' }}
                  />
                  <Line type="monotone" dataKey="calls" stroke="#a855f7" strokeWidth={2} dot={{r: 3, fill: '#a855f7'}} activeDot={{r: 5}} />
                </LineChart>
             </ResponsiveContainer>
           </div>
        </div>
      </div>
    </div>
  );
};

export default AdminOverview;
