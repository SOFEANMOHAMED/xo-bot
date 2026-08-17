import React, { useEffect, useState } from 'react';
import { Check, X, Loader2, ExternalLink, RefreshCw, FileText, Image as ImageIcon } from 'lucide-react';
import apiService from '../../services/api';
import { useAdminNotifications } from './AdminNotificationContext';
import { logger } from '../../utils/logger';

interface PaymentRequest {
  id: string;
  planKey: string;
  amount: number;
  method: string;
  proofUrl: string;
  status: string;
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  merchant: {
    id: string;
    name: string;
    email: string;
  };
}

const planLabels: Record<string, string> = {
  comments: 'التعليقات',
  single: 'القناة الواحدة',
  social: 'السوشيال',
  yearly: 'السنوية',
  starter: 'البداية (قديم)',
  pro: 'المحترف (قديم)',
  business: 'الأعمال (قديم)'
};

const methodLabels: Record<string, string> = {
  sham_cash: 'شام كاش',
  usdt: 'USDT'
};

const AdminPaymentRequests: React.FC = () => {
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [actionId, setActionId] = useState<string | null>(null);
  const { showSuccess, showError } = useAdminNotifications();

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const status = filter === 'all' ? undefined : filter;
      const data = await apiService.getAdminPaymentRequests(status);
      setRequests(Array.isArray(data) ? data : []);
    } catch (err: any) {
      logger.error('Failed to fetch payment requests:', err);
      showError('فشل تحميل طلبات الدفع: ' + (err.message || 'خطأ غير معروف'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [filter]);

  const handleReview = async (id: string, action: 'approve' | 'reject') => {
    let note: string | undefined;
    if (action === 'reject') {
      const input = window.prompt('سبب الرفض (اختياري):');
      if (input === null) return;
      note = input || undefined;
    }

    try {
      setActionId(id);
      await apiService.reviewPaymentRequest(id, action, note);
      showSuccess(action === 'approve' ? 'تم تأكيد الدفع وتفعيل الاشتراك' : 'تم رفض الطلب');
      await fetchRequests();
    } catch (err: any) {
      showError(err.message || 'فشل تنفيذ الإجراء');
    } finally {
      setActionId(null);
    }
  };

  const handleOpenProof = async (requestId: string) => {
    try {
      await apiService.openAdminPaymentProof(requestId);
    } catch (error) {
      logger.error('Failed to open payment proof', error);
    }
  };

  const isPdf = (url: string) => /\.pdf($|\?)/i.test(url);

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      approved: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      rejected: 'bg-red-500/15 text-red-400 border-red-500/30'
    };
    const labels: Record<string, string> = {
      pending: 'قيد المراجعة',
      approved: 'مقبول',
      rejected: 'مرفوض'
    };
    return (
      <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${styles[status] || styles.pending}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">طلبات دفع الاشتراك</h2>
          <p className="text-sm text-slate-400 mt-1">مراجعة تحويلات شام كاش وUSDT وتفعيل الاشتراكات</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white"
          >
            <option value="pending">قيد المراجعة</option>
            <option value="all">الكل</option>
            <option value="approved">مقبول</option>
            <option value="rejected">مرفوض</option>
          </select>
          <button
            onClick={fetchRequests}
            className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white"
            title="تحديث"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-indigo-400" size={32} />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-20 text-slate-400 text-sm">لا توجد طلبات في هذا التصفية</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right min-w-[900px]">
              <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-4">التاجر</th>
                  <th className="px-4 py-4">الخطة</th>
                  <th className="px-4 py-4">الوسيلة</th>
                  <th className="px-4 py-4">المبلغ</th>
                  <th className="px-4 py-4">الإثبات</th>
                  <th className="px-4 py-4">الحالة</th>
                  <th className="px-4 py-4">التاريخ</th>
                  <th className="px-4 py-4">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {requests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-4">
                      <div className="font-medium text-white">{req.merchant.name || '—'}</div>
                      <div className="text-xs text-slate-400" dir="ltr">{req.merchant.email}</div>
                    </td>
                    <td className="px-4 py-4 text-slate-200">
                      {planLabels[req.planKey] || req.planKey}
                    </td>
                    <td className="px-4 py-4 text-slate-300 text-sm">
                      {methodLabels[req.method] || req.method}
                    </td>
                    <td className="px-4 py-4 text-white font-bold" dir="ltr">
                      ${req.amount}
                    </td>
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => handleOpenProof(req.id)}
                        className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 text-sm"
                      >
                        {isPdf(req.proofUrl) ? <FileText size={14} /> : <ImageIcon size={14} />}
                        عرض
                        <ExternalLink size={12} />
                      </button>
                    </td>
                    <td className="px-4 py-4">{statusBadge(req.status)}</td>
                    <td className="px-4 py-4 text-slate-400 text-xs" dir="ltr">
                      {new Date(req.createdAt).toLocaleString('ar-SY-u-nu-latn')}
                    </td>
                    <td className="px-4 py-4">
                      {req.status === 'pending' ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleReview(req.id, 'approve')}
                            disabled={actionId === req.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
                          >
                            {actionId === req.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            تأكيد
                          </button>
                          <button
                            onClick={() => handleReview(req.id, 'reject')}
                            disabled={actionId === req.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-xs font-bold disabled:opacity-50"
                          >
                            <X size={12} />
                            رفض
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">
                          {req.adminNote || '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPaymentRequests;
