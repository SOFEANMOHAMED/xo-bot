
import React, { useEffect, useState } from 'react';
import { Check, Edit, Activity, Share2, DollarSign, TrendingUp, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from 'recharts';
import apiService from '../../services/api';
import { useAdminNotifications } from './AdminNotificationContext';
import EditPlanModal from './EditPlanModal';
import { logger } from '../../utils/logger';

interface AdminAnalyticsProps {
  view: 'SUBSCRIPTIONS' | 'USAGE' | 'AFFILIATE_PROGRAM';
}

const AdminAnalytics: React.FC<AdminAnalyticsProps> = ({ view }) => {
  const { showInfo, showError, showSuccess } = useAdminNotifications();
  
  // Subscriptions state
  const [subscriptionPlans, setSubscriptionPlans] = useState<Array<{
    name: string;
    planKey: string;
    price: number;
    users: number;
    features: string[];
    billingPeriod?: 'monthly' | 'yearly';
    description?: string;
  }>>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(true);
  const [editingPlan, setEditingPlan] = useState<{
    name: string;
    planKey: string;
    price: number;
    users: number;
    features: string[];
    billingPeriod?: 'monthly' | 'yearly';
    description?: string;
  } | null>(null);

  // Usage state
  const [topUsers, setTopUsers] = useState<Array<{ id: string; name: string; requests: number; cost: 'Low' | 'Medium' | 'High' }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Affiliate state
  const [affiliateStats, setAffiliateStats] = useState<{
    totalAffiliates: number;
    totalReferralSignups: number;
    totalCommissionsOwed: number;
    topAffiliates: Array<{
      id: string;
      name: string;
      email: string;
      clicks: number;
      signups: number;
      commission: number;
    }>;
  } | null>(null);
  const [isLoadingAffiliates, setIsLoadingAffiliates] = useState(true);
  const [errorAffiliates, setErrorAffiliates] = useState<string | null>(null);

  const fetchPlans = async () => {
    try {
      setIsLoadingPlans(true);
      const response = await apiService.getAdminSubscriptionPlans();
      setSubscriptionPlans(response.plans);
    } catch (err: any) {
      logger.error('Failed to fetch subscription plans:', err);
      showError('فشل تحميل بيانات الخطط');
    } finally {
      setIsLoadingPlans(false);
    }
  };

  // Fetch subscriptions
  useEffect(() => {
    if (view === 'SUBSCRIPTIONS') {
      fetchPlans();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Fetch usage stats
  useEffect(() => {
    if (view === 'USAGE') {
      const fetchUsageStats = async () => {
        try {
          setIsLoading(true);
          setError(null);
          const response = await apiService.getAdminUsageStats();
          logger.log('Usage stats response:', response);
          // Handle different response formats
          let users: any[] = [];
          if (Array.isArray(response)) {
            users = response;
          } else if (response && typeof response === 'object') {
            users = response.data || response.users || [];
          }
          
          // Ensure all users have required fields
          const validUsers = Array.isArray(users) ? users.map((u: any) => ({
            id: String(u.id || ''),
            name: String(u.name || 'مستخدم غير معروف'),
            requests: typeof u.requests === 'number' ? u.requests : parseInt(String(u.requests || '0'), 10),
            cost: (u.cost === 'High' || u.cost === 'Medium' || u.cost === 'Low') ? u.cost : 'Low' as const
          })) : [];
          
          logger.log('Valid users:', validUsers);
          setTopUsers(validUsers);
        } catch (err: any) {
          logger.error('Failed to fetch usage stats:', err);
          setError(err.message || 'فشل تحميل بيانات الاستخدام');
          setTopUsers([]);
        } finally {
          setIsLoading(false);
        }
      };
      
      fetchUsageStats();
    }
  }, [view]);

  // Fetch affiliate stats
  useEffect(() => {
    if (view === 'AFFILIATE_PROGRAM') {
      const fetchAffiliateStats = async () => {
        try {
          setIsLoadingAffiliates(true);
          setErrorAffiliates(null);
          const response = await apiService.getAdminAffiliateStats();
          logger.log('Affiliate stats response:', response);
          // Handle both direct response and response.data
          const data = response?.data || response;
          // Ensure all fields are properly typed and have default values
          const stats = {
            totalAffiliates: typeof data.totalAffiliates === 'number' ? data.totalAffiliates : 0,
            totalReferralSignups: typeof data.totalReferralSignups === 'number' ? data.totalReferralSignups : 0,
            totalCommissionsOwed: typeof data.totalCommissionsOwed === 'number' ? data.totalCommissionsOwed : parseFloat(String(data.totalCommissionsOwed || '0')),
            topAffiliates: Array.isArray(data.topAffiliates) ? data.topAffiliates.map((aff: any) => ({
              id: String(aff.id || ''),
              name: String(aff.name || aff.email || 'مستخدم غير معروف'),
              email: String(aff.email || ''),
              clicks: typeof aff.clicks === 'number' ? aff.clicks : parseInt(String(aff.clicks || '0'), 10),
              signups: typeof aff.signups === 'number' ? aff.signups : parseInt(String(aff.signups || '0'), 10),
              commission: typeof aff.commission === 'number' ? aff.commission : parseFloat(String(aff.commission || '0'))
            })) : []
          };
          setAffiliateStats(stats);
        } catch (err: any) {
          logger.error('Failed to fetch affiliate stats:', err);
          setErrorAffiliates(err.message || 'فشل تحميل بيانات برنامج التسويق بالعمولة');
          setAffiliateStats({
            totalAffiliates: 0,
            totalReferralSignups: 0,
            totalCommissionsOwed: 0,
            topAffiliates: []
          });
        } finally {
          setIsLoadingAffiliates(false);
        }
      };
      
      fetchAffiliateStats();
    }
  }, [view]);
  
  // --- Subscriptions View ---
  if (view === 'SUBSCRIPTIONS') {
      const handleEditPlan = (plan: {
        name: string;
        planKey: string;
        price: number;
        users: number;
        features: string[];
      }) => {
          setEditingPlan(plan);
      };

      const handleSavePlan = async (updatedPlan: {
        name: string;
        planKey: string;
        price: number;
        users: number;
        features: string[];
        limits?: any;
      }) => {
          try {
              await apiService.updateAdminSubscriptionPlan(
                  updatedPlan.planKey,
                  updatedPlan.name,
                  updatedPlan.price,
                  updatedPlan.features,
                  updatedPlan.limits,
                  (updatedPlan as any).billingPeriod,
                  (updatedPlan as any).description
              );
              showSuccess('تم تحديث الباقة بنجاح');
              setEditingPlan(null);
              // Refresh plans
              await fetchPlans();
          } catch (err: any) {
              showError(err.message || 'فشل تحديث الباقة');
              throw err;
          }
      };

      if (isLoadingPlans) {
          return (
              <div className="flex h-96 items-center justify-center">
                  <Loader2 className="animate-spin text-indigo-500" size={40} />
              </div>
          );
      }

      const plans = subscriptionPlans.length > 0 ? subscriptionPlans : [
          {
            name: 'التعليقات',
            planKey: 'comments',
            price: 5,
            users: 0,
            billingPeriod: 'monthly' as const,
            description: 'رد آلي على التعليقات فقط — بدون بوت مبيعات.',
            features: [
              'رد على تعليقات فيسبوك وإنستغرام فقط',
              'بدون بوت مبيعات (رسائل خاصة)',
              'ربط صفحة فيسبوك واحدة',
              'ربط حساب إنستغرام واحد',
              'استخدام AI غير محدود',
              '5 صور تسويقية بالذكاء الاصطناعي شهرياً'
            ]
          },
          {
            name: 'القناة الواحدة',
            planKey: 'single',
            price: 21,
            users: 0,
            billingPeriod: 'monthly' as const,
            description: 'بوت مبيعات على قناة واحدة من اختيارك.',
            features: [
              'بوت مبيعات ذكي',
              'ربط قناة واحدة: فيسبوك أو إنستغرام أو تيليجرام',
              'استخدام AI غير محدود',
              '20 صورة تسويقية بالذكاء الاصطناعي شهرياً'
            ]
          },
          {
            name: 'السوشيال',
            planKey: 'social',
            price: 35,
            users: 0,
            billingPeriod: 'monthly' as const,
            description: 'فيسبوك وإنستغرام معاً لبوت المبيعات.',
            features: [
              'بوت مبيعات ذكي',
              'ربط صفحة فيسبوك واحدة',
              'ربط حساب إنستغرام واحد',
              'استخدام AI غير محدود',
              '40 صورة تسويقية بالذكاء الاصطناعي شهرياً',
              'تحليلات متقدمة'
            ]
          },
          {
            name: 'السنوية',
            planKey: 'yearly',
            price: 200,
            users: 0,
            billingPeriod: 'yearly' as const,
            description: 'باقة سنوية شاملة للقنوات الرئيسية.',
            features: [
              'بوت مبيعات ذكي',
              'ربط فيسبوك + إنستغرام + تيليجرام',
              'استخدام AI غير محدود',
              '200 صورة تسويقية بالذكاء الاصطناعي سنوياً',
              'تحليلات متقدمة',
              'فوترة سنوية'
            ]
          },
      ];

      const monthlyEquivalent = (plan: { price: number; planKey: string; billingPeriod?: string }) =>
        (plan.billingPeriod === 'yearly' || plan.planKey === 'yearly') ? plan.price / 12 : plan.price;
      const totalRevenue = plans.reduce((sum, plan) => sum + (monthlyEquivalent(plan) * plan.users), 0);
      const totalSubscribers = plans.reduce((sum, plan) => sum + plan.users, 0);
      const avgRevenuePerUser = totalSubscribers > 0 ? totalRevenue / totalSubscribers : 0;
      const arr = totalRevenue * 12;

      return (
          <>
              <div className="space-y-6 animate-fade-in">
                  <h2 className="text-xl font-bold text-white mb-4">الاشتراكات والخطط</h2>
                  
                  {/* Financial Statistics */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-6">
                    <div className="bg-gradient-to-br from-indigo-900/30 to-indigo-800/20 border border-indigo-500/50 rounded-2xl p-4 lg:p-6">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-slate-400 text-xs lg:text-sm">الإيرادات الشهرية (MRR)</p>
                        <DollarSign size={20} className="text-indigo-400" />
                      </div>
                      <h3 className="text-2xl lg:text-3xl font-bold text-white">{totalRevenue.toLocaleString('en-US')} $</h3>
                      <p className="text-xs text-slate-500 mt-1">من {totalSubscribers} مشترك</p>
                    </div>

                    <div className="bg-gradient-to-br from-green-900/30 to-green-800/20 border border-green-500/50 rounded-2xl p-4 lg:p-6">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-slate-400 text-xs lg:text-sm">الإيرادات السنوية (ARR)</p>
                        <TrendingUp size={20} className="text-green-400" />
                      </div>
                      <h3 className="text-2xl lg:text-3xl font-bold text-white">{arr.toLocaleString('en-US')} $</h3>
                      <p className="text-xs text-slate-500 mt-1">MRR × 12</p>
                    </div>

                    <div className="bg-gradient-to-br from-yellow-900/30 to-yellow-800/20 border border-yellow-500/50 rounded-2xl p-4 lg:p-6">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-slate-400 text-xs lg:text-sm">متوسط الإيراد لكل مستخدم</p>
                        <Activity size={20} className="text-yellow-400" />
                      </div>
                      <h3 className="text-2xl lg:text-3xl font-bold text-white">{avgRevenuePerUser.toFixed(2)} $</h3>
                      <p className="text-xs text-slate-500 mt-1">ARPU</p>
                    </div>

                    <div className="bg-gradient-to-br from-purple-900/30 to-purple-800/20 border border-purple-500/50 rounded-2xl p-4 lg:p-6">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-slate-400 text-xs lg:text-sm">إجمالي المشتركين</p>
                        <Check size={20} className="text-purple-400" />
                      </div>
                      <h3 className="text-2xl lg:text-3xl font-bold text-white">{totalSubscribers}</h3>
                      <p className="text-xs text-slate-500 mt-1">مشترك نشط</p>
                    </div>
                  </div>

                  {/* Plan Distribution */}
                  <div className="bg-slate-800 rounded-2xl p-4 lg:p-6 border border-slate-700 mb-6">
                    <h3 className="text-lg font-bold text-white mb-4">توزيع الباقات</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                      {plans.map((plan) => {
                        const percentage = totalSubscribers > 0 ? (plan.users / totalSubscribers) * 100 : 0;
                        const revenue = ((plan.billingPeriod === 'yearly' || plan.planKey === 'yearly') ? plan.price / 12 : plan.price) * plan.users;
                        return (
                          <div key={plan.planKey} className="bg-slate-900/50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-bold text-white">{plan.name}</span>
                              <span className="text-xs text-slate-400">{plan.users} مشترك</span>
                            </div>
                            <div className="w-full bg-slate-700 rounded-full h-2 mb-2">
                              <div
                                className="bg-indigo-500 h-2 rounded-full transition-all"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-slate-400">{percentage.toFixed(1)}%</span>
                              <span className="text-green-400 font-bold">{revenue.toLocaleString('en-US')} $/شهر</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-6">
                     {plans.map((plan, idx) => (
                         <div key={idx} className="bg-slate-800 rounded-2xl p-4 lg:p-6 border border-slate-700 hover:border-indigo-500/50 transition-colors">
                            <div className="flex justify-between items-start mb-4">
                                <h3 className="text-base lg:text-lg font-bold text-white">{plan.name}</h3>
                                <button 
                                    onClick={() => handleEditPlan(plan)}
                                    className="text-slate-400 hover:text-white p-1 hover:bg-slate-700 rounded transition-colors flex-shrink-0"
                                >
                                    <Edit size={16} />
                                </button>
                            </div>
                            <div className="text-2xl lg:text-3xl font-bold text-indigo-400 mb-2">{plan.price}$ <span className="text-xs lg:text-sm text-slate-500 font-normal">/ {(plan as any).billingPeriod === 'yearly' || plan.planKey === 'yearly' ? 'سنوياً' : 'شهرياً'}</span></div>
                            <div className="mb-4 lg:mb-6 p-2 bg-slate-900/50 rounded-lg text-xs lg:text-sm text-center text-slate-300">
                                عدد المشتركين: <span className="font-bold text-white">{plan.users}</span>
                            </div>
                            <ul className="space-y-2 mb-4 lg:mb-6">
                                {plan.features.map((f, i) => (
                                    <li key={i} className="text-xs lg:text-sm text-slate-400 flex items-center gap-2">
                                        <Check size={12} className="text-green-500 flex-shrink-0" /> <span>{f}</span>
                                    </li>
                                ))}
                            </ul>
                         </div>
                     ))}
                  </div>

                  {/* Revenue Chart */}
                  <div className="bg-slate-800 rounded-2xl p-4 lg:p-6 border border-slate-700 mt-6">
                    <h3 className="text-lg font-bold text-white mb-4">مخطط الإيرادات حسب الباقة</h3>
                    <div className="h-64 w-full" dir="ltr">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={plans.map(plan => ({
                          name: plan.name,
                          revenue: ((plan.billingPeriod === 'yearly' || plan.planKey === 'yearly') ? plan.price / 12 : plan.price) * plan.users,
                          subscribers: plan.users
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                          <XAxis 
                            dataKey="name" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{fill: '#94a3b8', fontSize: 12}}
                          />
                          <YAxis 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{fill: '#94a3b8', fontSize: 12}}
                            width={60}
                          />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                            itemStyle={{ color: '#fff' }}
                            formatter={(value: any) => [`${value.toLocaleString('en-US')} $`, 'الإيرادات']}
                          />
                          <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Plan Distribution Pie Chart */}
                  <div className="bg-slate-800 rounded-2xl p-4 lg:p-6 border border-slate-700 mt-6">
                    <h3 className="text-lg font-bold text-white mb-4">توزيع المشتركين حسب الباقة</h3>
                    <div className="h-64 w-full" dir="ltr">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={plans.map(plan => ({
                              name: plan.name,
                              value: plan.users,
                              revenue: ((plan.billingPeriod === 'yearly' || plan.planKey === 'yearly') ? plan.price / 12 : plan.price) * plan.users
                            }))}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                            outerRadius={80}
                            fill="#8884d8"
                            dataKey="value"
                          >
                            {plans.map((plan, index) => {
                              const colors = ['#FF9A00', '#6366f1', '#10b981', '#8b5cf6'];
                              return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                            })}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                            formatter={(value: any, name: string, props: any) => [
                              `${value} مشترك (${props.payload.revenue.toLocaleString('en-US')} $/شهر)`,
                              'المشتركين'
                            ]}
                          />
                          <Legend 
                            formatter={(value, entry: any) => `${value}: ${entry.payload.value} مشترك`}
                            wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
              </div>
              {editingPlan && (
                  <EditPlanModal
                      isOpen={!!editingPlan}
                      plan={editingPlan}
                      onClose={() => setEditingPlan(null)}
                      onSave={handleSavePlan}
                  />
              )}
          </>
      );
  }

  // --- Usage View ---
  if (view === 'USAGE') {

      // Ensure topUsers is always an array
      const safeTopUsers = Array.isArray(topUsers) ? topUsers : [];
      const maxRequests = safeTopUsers.length > 0 ? Math.max(...safeTopUsers.map(u => u.requests), 1) : 1;

      if (isLoading) {
          return (
              <div className="flex h-96 items-center justify-center">
                  <Loader2 className="animate-spin text-indigo-500" size={40} />
              </div>
          );
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

      return (
          <div className="space-y-4 lg:space-y-6 animate-fade-in">
              <h2 className="text-lg lg:text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <Activity size={20} className="lg:w-6 lg:h-6 text-indigo-400" />
                  <span>تحليلات استخدام النظام</span>
              </h2>
              
              <div className="bg-slate-800 rounded-2xl p-4 lg:p-6 border border-slate-700">
                  <h3 className="text-base lg:text-lg font-bold text-white mb-4">أكثر المستخدمين استهلاكاً للموارد (AI Requests)</h3>
                  {safeTopUsers.length === 0 ? (
                      <div className="text-center py-8 lg:py-12 text-slate-400 text-sm lg:text-base">
                          لا توجد بيانات استخدام حالياً
                      </div>
                  ) : (
                      <div className="space-y-3 lg:space-y-4">
                          {safeTopUsers.map((u, i) => (
                              <div key={u.id || i} className="flex items-center gap-2 lg:gap-4">
                                  <span className="text-slate-500 font-mono text-xs lg:text-sm w-4 lg:w-6 flex-shrink-0">#{i+1}</span>
                                  <div className="flex-1 min-w-0">
                                      <div className="flex justify-between items-center mb-1 gap-2">
                                          <span className="text-white font-medium text-sm lg:text-base truncate">{u.name}</span>
                                          <span className="text-indigo-300 text-xs lg:text-sm font-bold flex-shrink-0">{u.requests.toLocaleString('en-US')} طلب</span>
                                      </div>
                                      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                          <div 
                                              className={`h-full rounded-full ${
                                                  u.cost === 'High' ? 'bg-red-500' : 
                                                  u.cost === 'Medium' ? 'bg-yellow-500' : 
                                                  'bg-indigo-500'
                                              }`} 
                                              style={{ width: `${Math.min((u.requests / maxRequests) * 100, 100)}%` }}
                                          ></div>
                                      </div>
                                  </div>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
          </div>
      );
  }

  // --- Affiliate View ---
  if (view === 'AFFILIATE_PROGRAM') {

      if (isLoadingAffiliates) {
          return (
              <div className="flex h-96 items-center justify-center">
                  <Loader2 className="animate-spin text-indigo-500" size={40} />
              </div>
          );
      }

      if (errorAffiliates && !affiliateStats) {
          return (
              <div className="flex h-96 items-center justify-center">
                  <div className="text-center">
                      <p className="text-red-400 text-lg mb-2">❌ خطأ في تحميل البيانات</p>
                      <p className="text-slate-400">{errorAffiliates}</p>
                  </div>
              </div>
          );
      }

      const stats = affiliateStats || {
          totalAffiliates: 0,
          totalReferralSignups: 0,
          totalCommissionsOwed: 0,
          topAffiliates: []
      };

      return (
          <div className="space-y-4 lg:space-y-6 animate-fade-in">
              <h2 className="text-lg lg:text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <Share2 size={20} className="lg:w-6 lg:h-6 text-green-400" />
                  <span>برنامج التسويق بالعمولة</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6 mb-6 lg:mb-8">
                  <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700">
                      <p className="text-slate-400 text-xs lg:text-sm mb-2">إجمالي المسوقين</p>
                      <h3 className="text-2xl lg:text-3xl font-bold text-white">{stats.totalAffiliates}</h3>
                  </div>
                  <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700">
                      <p className="text-slate-400 text-xs lg:text-sm mb-2">إجمالي الاشتراكات عبر الإحالة</p>
                      <h3 className="text-2xl lg:text-3xl font-bold text-white">{stats.totalReferralSignups}</h3>
                  </div>
                  <div className="bg-slate-800 p-4 lg:p-6 rounded-2xl border border-slate-700">
                      <p className="text-slate-400 text-xs lg:text-sm mb-2">إجمالي العمولات المستحقة</p>
                      <h3 className="text-2xl lg:text-3xl font-bold text-green-400">{stats.totalCommissionsOwed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $</h3>
                  </div>
              </div>

              <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
                  <div className="p-6 border-b border-slate-700">
                      <h3 className="font-bold text-white">أفضل المسوقين أداءً</h3>
                  </div>
                  {stats.topAffiliates.length === 0 ? (
                      <div className="p-12 text-center text-slate-400">
                          لا توجد بيانات مسوقين حالياً
                      </div>
                  ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-right min-w-[600px]">
                            <thead className="bg-slate-900/50 text-slate-400 text-xs">
                                <tr>
                                    <th className="px-3 lg:px-6 py-3 lg:py-4">المسوق</th>
                                    <th className="px-3 lg:px-6 py-3 lg:py-4">النقرات</th>
                                    <th className="px-3 lg:px-6 py-3 lg:py-4">الاشتراكات</th>
                                    <th className="px-3 lg:px-6 py-3 lg:py-4">العمولة (تقديري)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {stats.topAffiliates.map((aff, i) => (
                                    <tr key={aff.id || i} className="hover:bg-slate-700/30">
                                        <td className="px-3 lg:px-6 py-3 lg:py-4 text-white font-medium text-sm lg:text-base">{aff.name || aff.email}</td>
                                        <td className="px-3 lg:px-6 py-3 lg:py-4 text-slate-300 text-sm lg:text-base">{aff.clicks.toLocaleString('en-US')}</td>
                                        <td className="px-3 lg:px-6 py-3 lg:py-4 text-slate-300 text-sm lg:text-base">{aff.signups}</td>
                                        <td className="px-3 lg:px-6 py-3 lg:py-4 text-green-400 font-bold text-sm lg:text-base">{aff.commission.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                      </div>
                  )}
              </div>
          </div>
      );
  }

  return null;
};

export default AdminAnalytics;
