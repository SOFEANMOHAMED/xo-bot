
import React, { useEffect, useState } from 'react';
import { AffiliateStats, MerchantSettings } from '../types';
import apiService from '../services/api';
import { Copy, Users, DollarSign, ExternalLink, QrCode, CheckCircle, TrendingUp, AlertCircle, Loader2, X, Tag, Download } from 'lucide-react';
import { logger } from '../utils/logger';

interface AffiliateDashboardProps {
  settings: MerchantSettings;
}

const AffiliateDashboard: React.FC<AffiliateDashboardProps> = ({ settings }) => {
  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  const [isCodeCopied, setIsCodeCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      setIsLoading(true);
      try {
        const response = await apiService.getAffiliateStats();
        logger.log('Affiliate stats response:', response);
        
        // Ensure response exists and has required fields
        if (!response) {
          throw new Error('Empty response from server');
        }

        // Map API response to AffiliateStats format
        const data: AffiliateStats = {
          referralCode: response.referralCode || 'N/A',
          referralLink: response.referralLink || '',
          totalVisits: response.totalVisits || 0,
          totalSignups: response.totalSignups || 0,
          activeConversions: response.activeConversions || 0,
          totalEarnings: response.totalEarnings || 0,
          availableBalance: response.availableBalance || 0,
          referrals: Array.isArray(response.referrals) 
            ? response.referrals.map((ref: any) => ({
                id: ref.id,
                referrerId: ref.referrerId,
                newUserId: ref.newUserId,
                newUserEmail: ref.newUserEmail,
                date: ref.date instanceof Date ? ref.date : new Date(ref.date),
                status: ref.status,
                commissionAmount: ref.commissionAmount || 0,
                plan: ref.plan,
                daysRemaining: ref.daysRemaining !== undefined ? ref.daysRemaining : null
              }))
            : []
        };
        
        logger.log('Mapped affiliate stats:', data);
        setStats(data);
      } catch (e: any) {
        logger.error("Failed to load affiliate stats:", e);
        // Set empty stats on error
        setStats({
          referralCode: 'N/A',
          referralLink: '',
          totalVisits: 0,
          totalSignups: 0,
          activeConversions: 0,
          totalEarnings: 0,
          availableBalance: 0,
          referrals: []
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchStats();
  }, []);

  const handleCopyLink = () => {
    if (stats?.referralLink) {
      navigator.clipboard.writeText(stats.referralLink);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const handleCopyCode = () => {
    if (stats?.referralCode) {
      navigator.clipboard.writeText(stats.referralCode);
      setIsCodeCopied(true);
      setTimeout(() => setIsCodeCopied(false), 2000);
    }
  };

  const handleDownloadQR = async () => {
    if (!stats?.referralLink) return;
    
    try {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(stats.referralLink)}&color=4f46e5&bgcolor=ffffff&margin=1`;
      
      // Fetch the QR code image
      const response = await fetch(qrUrl);
      const blob = await response.blob();
      
      // Create a download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `QR-${stats.referralCode || 'affiliate'}.png`;
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      logger.error('Failed to download QR code:', error);
    }
  };

  const handleWithdrawal = async () => {
    if (!stats || stats.availableBalance < 50) {
      alert("الحد الأدنى للسحب هو 50$");
      return;
    }
    
    if (confirm(`هل تود سحب رصيدك الحالي (${stats.availableBalance}$)?`)) {
        setIsWithdrawing(true);
        try {
          await apiService.requestAffiliateWithdrawal(stats.availableBalance);
          alert("تم استلام طلب السحب بنجاح! سيتم التحويل خلال 48 ساعة.");
          // Optimistically update UI
          setStats(prev => prev ? { ...prev, availableBalance: 0 } : null);
        } catch (err: any) {
          alert("فشل إرسال طلب السحب: " + (err.message || 'خطأ غير معروف'));
        } finally {
          setIsWithdrawing(false);
        }
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="animate-spin text-brand" size={40} />
      </div>
    );
  }

  if (!stats) return <div className="p-8 text-center">حدث خطأ أثناء تحميل البيانات</div>;

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-900 to-brand-900 rounded-3xl p-8 text-white relative overflow-hidden shadow-xl">
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden opacity-20">
             <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand rounded-full blur-[100px]"></div>
             <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-brand rounded-full blur-[100px]"></div>
        </div>
        
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h2 className="text-3xl font-bold mb-2">برنامج التسويق بالعمولة</h2>
            <p className="text-brand-200 text-lg max-w-2xl">
              شارك رابطك واربح عمولات مستمرة. نساعدك على تحقيق دخل إضافي بسهولة.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/20 text-center min-w-[150px]">
             <p className="text-xs text-brand-200 mb-1">الرصيد المتاح للسحب</p>
             <h3 className="text-3xl font-bold text-white mb-2">{stats.availableBalance}$</h3>
             <button 
                onClick={handleWithdrawal}
                disabled={isWithdrawing || stats.availableBalance === 0}
                className="w-full py-2 bg-white text-brand-900 rounded-lg text-xs font-bold hover:bg-brand-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
             >
                {isWithdrawing ? 'جاري المعالجة...' : 'طلب سحب الأرباح'}
             </button>
          </div>
        </div>
      </div>

      {/* Referral Link Section */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 transition-colors">
         <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <ExternalLink size={20} className="text-brand dark:text-brand" />
            رابط الإحالة الخاص بك
         </h3>
         
         {!stats.referralLink || stats.referralLink === '' ? (
           <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 mb-4">
             <p className="text-yellow-800 dark:text-yellow-200 text-sm">
               ⚠️ جاري إنشاء رابط الإحالة الخاص بك...
             </p>
           </div>
         ) : null}
         
         <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
               <input 
                 type="text" 
                 readOnly 
                 value={stats.referralLink || 'جاري التحميل...'} 
                 className="w-full bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl px-4 py-3 pr-12 text-left dir-ltr font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
               />
               <div className="absolute top-1/2 right-3 -translate-y-1/2">
                  <div className={`w-2 h-2 rounded-full ${stats.referralLink && stats.referralLink !== '' ? 'bg-green-500' : 'bg-gray-300'}`}></div>
               </div>
            </div>
            
            <div className="flex gap-2">
               <button 
                 onClick={handleCopyLink}
                 className="flex items-center gap-2 px-6 py-3 bg-brand hover:bg-brand-700 text-white rounded-xl font-bold transition-all active:scale-95 shadow-lg shadow-brand/25 dark:shadow-none"
               >
                  {isCopied ? <CheckCircle size={20} /> : <Copy size={20} />}
                  <span>{isCopied ? 'تم النسخ' : 'نسخ الرابط'}</span>
               </button>
               
               <button 
                 onClick={() => setShowQR(!showQR)}
                 className={`p-3 rounded-xl border transition-colors ${showQR ? 'bg-brand-50 border-brand-200 text-brand' : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}
                 title="عرض رمز QR"
               >
                  <QrCode size={20} />
               </button>
            </div>
         </div>

         {showQR && (
             <div className="mt-6 flex justify-center animate-fade-in">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700">
                    <div className="flex flex-col items-center gap-4">
                        <img 
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(stats.referralLink)}&color=4f46e5&bgcolor=ffffff&margin=1`} 
                          alt="Affiliate QR Code" 
                          className="w-48 h-48 rounded-lg"
                          id="qr-code-image"
                        />
                        <p className="text-center text-sm font-mono text-gray-700 dark:text-gray-300 font-bold">
                          {stats.referralCode}
                        </p>
                        <button
                          onClick={handleDownloadQR}
                          className="flex items-center gap-2 px-4 py-2 bg-brand hover:bg-brand-700 text-white rounded-xl font-medium transition-colors shadow-md"
                        >
                          <Download size={18} />
                          <span>تنزيل رمز QR</span>
                        </button>
                    </div>
                </div>
             </div>
         )}
      </div>

      {/* Referral Code Section */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 transition-colors">
         <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Tag size={20} className="text-brand dark:text-brand" />
            كود الإحالة (Referral Code)
         </h3>
         
         {!stats.referralCode || stats.referralCode === 'N/A' ? (
           <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 mb-4">
             <p className="text-yellow-800 dark:text-yellow-200 text-sm">
               ⚠️ جاري إنشاء كود الإحالة الخاص بك...
             </p>
           </div>
         ) : null}
         
         <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 border border-dashed border-gray-300 dark:border-gray-600">
            <div className="font-mono text-2xl font-bold text-brand dark:text-brand tracking-wider">
               {stats.referralCode && stats.referralCode !== 'N/A' ? stats.referralCode : 'جاري التحميل...'}
            </div>
            <button 
               onClick={handleCopyCode}
               className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
            >
               {isCodeCopied ? <CheckCircle size={16} className="text-green-500" /> : <Copy size={16} />}
               <span>{isCodeCopied ? 'تم النسخ' : 'نسخ الكود'}</span>
            </button>
         </div>
         <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            شارك هذا الكود مع أصدقائك ليستخدموه أثناء التسجيل في خانة "كود الدعوة".
         </p>
      </div>

      {/* Commission Logic Explanation */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-brand-50 to-white dark:from-brand-900/20 dark:to-gray-800 p-6 rounded-2xl border border-brand-100 dark:border-brand-800/50 flex items-center gap-4 shadow-sm transition-colors">
           <div className="w-14 h-14 rounded-full bg-brand-100 dark:bg-brand-900/50 flex items-center justify-center text-brand dark:text-brand shrink-0 border border-brand-200 dark:border-brand-700">
             <span className="text-xl font-bold">30%</span>
           </div>
           <div>
             <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">عمولة أول اشتراك</h3>
             <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">
               اربح 30% من قيمة الدفعة الأولى لأي عميل يسجل عن طريقك. العمولة تصبح متاحة للسحب بعد 15 يوم من تاريخ التسجيل.
             </p>
           </div>
        </div>
        
        <div className="bg-gradient-to-br from-brand-50 to-white dark:from-brand-900/20 dark:to-gray-800 p-6 rounded-2xl border border-brand-100 dark:border-brand-800/50 flex items-center gap-4 shadow-sm transition-colors">
           <div className="w-14 h-14 rounded-full bg-brand-100 dark:bg-brand-900/50 flex items-center justify-center text-brand dark:text-brand shrink-0 border border-brand-200 dark:border-brand-700">
             <span className="text-xl font-bold">10%</span>
           </div>
           <div>
             <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">دخل شهري متكرر</h3>
             <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">
               احصل على 10% شهرياً من كل عملية تجديد اشتراك يقوم بها عملاؤك.
             </p>
           </div>
        </div>
      </div>

      {/* Important Notice */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <AlertCircle size={20} />
          </div>
          <div>
            <h3 className="text-base font-bold text-blue-900 dark:text-blue-200 mb-2">مهم: فترة انتظار العمولات</h3>
            <p className="text-blue-800 dark:text-blue-300 text-sm leading-relaxed">
              جميع العمولات تبدأ بحالة "قيد الانتظار" وتصبح متاحة للسحب بعد مرور <strong>15 يوم</strong> من تاريخ تسجيل المستخدم الجديد. 
              هذا يضمن جودة التسجيلات ويمنع الاحتيال. يمكنك رؤية عدد الأيام المتبقية لكل عمولة معلقة في جدول الدعوات أدناه.
            </p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 transition-colors">
            <div className="flex justify-between items-start mb-4">
               <div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">إجمالي النقرات</p>
                  <h3 className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{stats.totalVisits}</h3>
               </div>
               <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl">
                  <ExternalLink size={24} />
               </div>
            </div>
            <div className="text-xs text-gray-400 flex items-center gap-1">
               <TrendingUp size={12} className="text-green-500" />
               <span>زيارات فريدة لرابطك</span>
            </div>
         </div>

         <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 transition-colors">
            <div className="flex justify-between items-start mb-4">
               <div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">المستخدمين المسجلين</p>
                  <h3 className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{stats.totalSignups}</h3>
               </div>
               <div className="p-3 bg-brand-50 dark:bg-brand-900/20 text-brand dark:text-brand rounded-xl">
                  <Users size={24} />
               </div>
            </div>
            <div className="text-xs text-gray-400 flex items-center gap-1">
               <span>معدل تحويل الزيارات: {((stats.totalSignups / (stats.totalVisits || 1)) * 100).toFixed(1)}%</span>
            </div>
         </div>

         <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 transition-colors">
            <div className="flex justify-between items-start mb-4">
               <div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">إجمالي الأرباح</p>
                  <h3 className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{stats.totalEarnings}$</h3>
               </div>
               <div className="p-3 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-xl">
                  <DollarSign size={24} />
               </div>
            </div>
            <div className="text-xs text-gray-400 flex items-center gap-1">
               <CheckCircle size={12} className="text-green-500" />
               <span>{stats.activeConversions} اشتراكات مدفوعة نشطة</span>
            </div>
         </div>
      </div>

      {/* Referrals Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden transition-colors">
         <div className="p-6 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">سجل الدعوات</h3>
         </div>
         <div className="overflow-x-auto">
            <table className="w-full text-right">
               <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 text-xs font-bold uppercase tracking-wider">
                  <tr>
                     <th className="px-6 py-4">المستخدم</th>
                     <th className="px-6 py-4">التاريخ</th>
                     <th className="px-6 py-4">الباقة</th>
                     <th className="px-6 py-4">العمولة</th>
                     <th className="px-6 py-4">الحالة</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {stats.referrals.map((ref) => (
                     <tr key={ref.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors text-sm">
                        <td className="px-6 py-4">
                           <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center text-brand dark:text-brand font-bold">
                                 {ref.newUserId.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-gray-900 dark:text-white font-medium">{ref.newUserEmail}</span>
                           </div>
                        </td>
                        <td className="px-6 py-4 text-gray-500 dark:text-gray-400" dir="ltr">
                           {new Date(ref.date).toLocaleDateString('ar-u-nu-latn')}
                        </td>
                        <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                           <span className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-xs">{ref.plan}</span>
                        </td>
                        <td className="px-6 py-4 font-bold text-green-600 dark:text-green-400">
                           +{ref.commissionAmount}$
                        </td>
                        <td className="px-6 py-4">
                           {ref.status === 'active' && (
                              <span className="inline-flex items-center gap-1 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-2.5 py-0.5 rounded-full text-xs font-medium">
                                 <CheckCircle size={12} /> نشط
                              </span>
                           )}
                           {ref.status === 'pending' && (
                              <div className="flex flex-col gap-1">
                                 <span className="inline-flex items-center gap-1 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 px-2.5 py-0.5 rounded-full text-xs font-medium">
                                    <AlertCircle size={12} /> قيد الانتظار
                                 </span>
                                 {ref.daysRemaining !== null && ref.daysRemaining !== undefined && (
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                       متبقي {ref.daysRemaining} يوم
                                    </span>
                                 )}
                              </div>
                           )}
                           {ref.status === 'expired' && (
                              <span className="inline-flex items-center gap-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 px-2.5 py-0.5 rounded-full text-xs font-medium">
                                 <X size={12} /> منتهي
                              </span>
                           )}
                        </td>
                     </tr>
                  ))}
                  {stats.referrals.length === 0 && (
                     <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                           لم تقم بدعوة أي مستخدم بعد. انسخ الرابط وابدأ الآن!
                        </td>
                     </tr>
                  )}
               </tbody>
            </table>
         </div>
      </div>
    </div>
  );
};

export default AffiliateDashboard;
    