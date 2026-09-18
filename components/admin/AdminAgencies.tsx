import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  Check,
  Loader2,
  RefreshCw,
  Search,
  X,
  Ban,
  Play,
} from 'lucide-react';
import apiService from '../../services/api';
import { useAdminNotifications } from './AdminNotificationContext';
import { PaymentMethodLogo } from '../PaymentMethodLogo';
import ModalOverlay from '../ModalOverlay';

const PLAN_KEYS = ['comments', 'single', 'social', 'yearly'] as const;
const PLAN_LABELS: Record<string, string> = {
  comments: 'التعليقات',
  single: 'القناة الواحدة',
  social: 'السوشيال',
  yearly: 'السنوية',
};

type AgencyRow = {
  id: string;
  name: string;
  status: string;
  notes: string | null;
  ownerMerchantId: string;
  ownerEmail: string;
  ownerName: string | null;
  seatCount: number;
  activeSeatCount: number;
  createdAt: string;
};

type SeatPayment = {
  id: string;
  agencyName: string;
  agencyOwnerEmail: string;
  clientLabel: string | null;
  clientEmail: string;
  planKey: string;
  amount: number;
  purpose: string;
  method: string;
  status: string;
  createdAt: string;
};

type SignupRequest = {
  id: string;
  email: string;
  phone: string;
  agencyName: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNote: string | null;
  reviewedAt: string | null;
  createdMerchantId: string | null;
  createdAt: string;
};

const AdminAgencies: React.FC = () => {
  const { showError, showSuccess } = useAdminNotifications();
  const [tab, setTab] = useState<'requests' | 'agencies' | 'payments'>('requests');
  const [agencies, setAgencies] = useState<AgencyRow[]>([]);
  const [payments, setPayments] = useState<SeatPayment[]>([]);
  const [signupRequests, setSignupRequests] = useState<SignupRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [showActivate, setShowActivate] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [candidates, setCandidates] = useState<
    Array<{ id: string; email: string; name: string | null }>
  >([]);
  const [selectedMerchantId, setSelectedMerchantId] = useState<string | null>(null);
  const [agencyName, setAgencyName] = useState('');
  const [pricingDraft, setPricingDraft] = useState<Record<string, string>>({
    comments: '3',
    single: '15',
    social: '25',
    yearly: '150',
  });
  const [activating, setActivating] = useState(false);

  const [editAgency, setEditAgency] = useState<AgencyRow | null>(null);
  const [editPricing, setEditPricing] = useState<Record<string, string>>({});
  const [savingPricing, setSavingPricing] = useState(false);

  const [reviewRequest, setReviewRequest] = useState<SignupRequest | null>(null);
  const [reviewPricing, setReviewPricing] = useState<Record<string, string>>({
    comments: '3',
    single: '15',
    social: '25',
    yearly: '150',
  });
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const loadAgencies = useCallback(async () => {
    const res = await apiService.getAdminAgencies();
    setAgencies(res.agencies || []);
  }, []);

  const loadPayments = useCallback(async () => {
    const res = await apiService.getAdminAgencySeatPayments('pending');
    setPayments(res.payments || []);
  }, []);

  const loadSignupRequests = useCallback(async () => {
    const res = await apiService.getAdminAgencySignupRequests();
    setSignupRequests(res.requests || []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadAgencies(), loadPayments(), loadSignupRequests()]);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'تعذر التحميل');
    } finally {
      setLoading(false);
    }
  }, [loadAgencies, loadPayments, loadSignupRequests, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!showActivate || searchQ.trim().length < 2) {
      setCandidates([]);
      return;
    }
    const t = setTimeout(() => {
      void apiService
        .searchAgencyCandidates(searchQ.trim())
        .then((res) => setCandidates(res.merchants || []))
        .catch(() => setCandidates([]));
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ, showActivate]);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMerchantId) return;
    setActivating(true);
    try {
      const pricing = PLAN_KEYS.filter((k) => pricingDraft[k] && Number(pricingDraft[k]) > 0).map(
        (k) => ({ planKey: k, unitPrice: Number(pricingDraft[k]) })
      );
      await apiService.activateAgency({
        merchantId: selectedMerchantId,
        name: agencyName.trim() || undefined,
        pricing,
      });
      showSuccess('تم تفعيل الوكالة');
      setShowActivate(false);
      setSelectedMerchantId(null);
      setSearchQ('');
      setAgencyName('');
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'فشل التفعيل');
    } finally {
      setActivating(false);
    }
  };

  const openEditPricing = async (agency: AgencyRow) => {
    try {
      const detail = await apiService.getAdminAgency(agency.id);
      const draft: Record<string, string> = {};
      for (const key of PLAN_KEYS) {
        const found = detail.pricing.find((p) => p.planKey === key);
        draft[key] = found ? String(found.unitPrice) : '';
      }
      setEditPricing(draft);
      setEditAgency(agency);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'تعذر تحميل التسعير');
    }
  };

  const savePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAgency) return;
    setSavingPricing(true);
    try {
      const pricing = PLAN_KEYS.filter((k) => editPricing[k] && Number(editPricing[k]) > 0).map(
        (k) => ({ planKey: k, unitPrice: Number(editPricing[k]) })
      );
      await apiService.updateAdminAgencyPricing(editAgency.id, pricing);
      showSuccess('تم تحديث الأسعار');
      setEditAgency(null);
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'فشل التحديث');
    } finally {
      setSavingPricing(false);
    }
  };

  const toggleStatus = async (agency: AgencyRow) => {
    const next = agency.status === 'active' ? 'suspended' : 'active';
    try {
      await apiService.updateAdminAgencyStatus(agency.id, next);
      showSuccess(next === 'active' ? 'تم تفعيل الوكالة' : 'تم تعليق الوكالة');
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'فشل تحديث الحالة');
    }
  };

  const reviewPayment = async (id: string, action: 'approve' | 'reject') => {
    try {
      await apiService.reviewAdminAgencySeatPayment(id, action);
      showSuccess(action === 'approve' ? 'تمت الموافقة وتفعيل المقعد' : 'تم الرفض');
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'فشل المراجعة');
    }
  };

  const openApproveRequest = (req: SignupRequest) => {
    setReviewRequest(req);
    setReviewNote('');
    setReviewPricing({
      comments: '3',
      single: '15',
      social: '25',
      yearly: '150',
    });
  };

  const approveSignupRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewRequest) return;
    setReviewing(true);
    try {
      const pricing = PLAN_KEYS.filter((k) => reviewPricing[k] && Number(reviewPricing[k]) > 0).map(
        (k) => ({ planKey: k, unitPrice: Number(reviewPricing[k]) })
      );
      await apiService.approveAdminAgencySignupRequest(reviewRequest.id, {
        adminNote: reviewNote.trim() || undefined,
        pricing,
      });
      showSuccess('تمت الموافقة وإنشاء حساب الوكالة');
      setReviewRequest(null);
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'فشل الموافقة');
    } finally {
      setReviewing(false);
    }
  };

  const rejectSignupRequest = async (req: SignupRequest) => {
    const note = window.prompt('سبب الرفض (اختياري):') ?? undefined;
    try {
      await apiService.rejectAdminAgencySignupRequest(req.id, note || undefined);
      showSuccess('تم رفض الطلب');
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'فشل الرفض');
    }
  };

  const pendingRequests = signupRequests.filter((r) => r.status === 'pending');

  const inputClass =
    'w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 outline-none';
  const priceInputClass =
    'w-28 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 outline-none';

  return (
    <div className="space-y-6 animate-fade-in" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Building2 size={22} className="text-indigo-400" />
            الوكالات
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            طلبات التسجيل، تفعيل الوكالات، التسعير المخفّض، ومراجعة مدفوعات المقاعد
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white"
            title="تحديث"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => setShowActivate(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold px-4 py-2 rounded-xl shadow-lg shadow-indigo-900/30"
          >
            تفعيل وكالة
          </button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-700 overflow-x-auto">
        <button
          type="button"
          onClick={() => setTab('requests')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            tab === 'requests'
              ? 'border-indigo-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          طلبات التسجيل ({pendingRequests.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('agencies')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            tab === 'agencies'
              ? 'border-indigo-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          الوكالات ({agencies.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('payments')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            tab === 'payments'
              ? 'border-indigo-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          مدفوعات بانتظار المراجعة ({payments.length})
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 className="animate-spin text-indigo-400" size={28} />
          جاري التحميل...
        </div>
      ) : tab === 'requests' ? (
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right min-w-[800px]">
              <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">الوكالة</th>
                  <th className="px-4 py-3 font-medium">البريد</th>
                  <th className="px-4 py-3 font-medium">الهاتف</th>
                  <th className="px-4 py-3 font-medium">التاريخ</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {signupRequests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      لا توجد طلبات تسجيل
                    </td>
                  </tr>
                ) : (
                  signupRequests.map((req) => (
                    <tr key={req.id} className="border-t border-slate-700/80">
                      <td className="px-4 py-3 font-medium">{req.agencyName}</td>
                      <td className="px-4 py-3" dir="ltr">
                        {req.email}
                      </td>
                      <td className="px-4 py-3" dir="ltr">
                        {req.phone}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {new Date(req.createdAt).toLocaleString('ar')}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-semibold ${
                            req.status === 'pending'
                              ? 'bg-amber-500/15 text-amber-300'
                              : req.status === 'approved'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-red-500/15 text-red-300'
                          }`}
                        >
                          {req.status === 'pending'
                            ? 'قيد المراجعة'
                            : req.status === 'approved'
                              ? 'موافق عليه'
                              : 'مرفوض'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {req.status === 'pending' ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openApproveRequest(req)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 text-xs font-bold"
                            >
                              <Check size={14} />
                              موافقة
                            </button>
                            <button
                              type="button"
                              onClick={() => void rejectSignupRequest(req)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600/20 text-red-300 hover:bg-red-600/30 text-xs font-bold"
                            >
                              <X size={14} />
                              رفض
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-500 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'agencies' ? (
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right min-w-[700px]">
              <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">الوكالة</th>
                  <th className="px-4 py-3 font-medium">المالك</th>
                  <th className="px-4 py-3 font-medium">المقاعد</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {agencies.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                      لا توجد وكالات بعد
                    </td>
                  </tr>
                ) : (
                  agencies.map((a) => (
                    <tr key={a.id} className="border-t border-slate-700/80 hover:bg-slate-900/40">
                      <td className="px-4 py-3 font-semibold text-white">{a.name}</td>
                      <td className="px-4 py-3">
                        <div className="text-slate-200">{a.ownerName || '—'}</div>
                        <div className="text-xs text-slate-500">{a.ownerEmail}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {a.activeSeatCount} نشط / {a.seatCount} إجمالي
                      </td>
                      <td className="px-4 py-3">
                        {a.status === 'active' ? (
                          <span className="px-2.5 py-1 rounded-lg text-xs font-bold border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                            نشطة
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-lg text-xs font-bold border bg-red-500/15 text-red-400 border-red-500/30">
                            معلّقة
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => void openEditPricing(a)}
                            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 hover:text-white"
                          >
                            التسعير
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleStatus(a)}
                            className={`text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 ${
                              a.status === 'active'
                                ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                                : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                            }`}
                          >
                            {a.status === 'active' ? (
                              <>
                                <Ban size={12} /> تعليق
                              </>
                            ) : (
                              <>
                                <Play size={12} /> تفعيل
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right min-w-[900px]">
              <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">الوكالة</th>
                  <th className="px-4 py-3 font-medium">العميل</th>
                  <th className="px-4 py-3 font-medium">الباقة</th>
                  <th className="px-4 py-3 font-medium">المبلغ</th>
                  <th className="px-4 py-3 font-medium">الغرض</th>
                  <th className="px-4 py-3 font-medium">الدفع</th>
                  <th className="px-4 py-3 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      لا توجد طلبات معلقة
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id} className="border-t border-slate-700/80">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{p.agencyName}</div>
                        <div className="text-xs text-slate-500">{p.agencyOwnerEmail}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-200">{p.clientLabel || '—'}</div>
                        <div className="text-xs text-slate-500">{p.clientEmail}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {PLAN_LABELS[p.planKey] || p.planKey}
                      </td>
                      <td className="px-4 py-3 font-semibold text-white">${p.amount}</td>
                      <td className="px-4 py-3 text-slate-400">{p.purpose}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <PaymentMethodLogo methodId={p.method} className="w-7 h-7 rounded-md" />
                          <button
                            type="button"
                            className="text-xs text-indigo-400 hover:text-indigo-300 underline"
                            onClick={() => void apiService.openAdminAgencySeatPaymentProof(p.id)}
                          >
                            الإثبات
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => void reviewPayment(p.id, 'approve')}
                            className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                            title="موافقة"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void reviewPayment(p.id, 'reject')}
                            className="p-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25"
                            title="رفض"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showActivate && (
        <ModalOverlay onClose={() => setShowActivate(false)}>
          <form
            onSubmit={handleActivate}
            className="bg-slate-900 border border-slate-700 rounded-2xl w-full p-6 space-y-4 shadow-2xl text-slate-200"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-white">تفعيل وكالة</h3>
              <button
                type="button"
                onClick={() => setShowActivate(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X size={18} />
              </button>
            </div>
            <div className="relative">
              <Search size={16} className="absolute right-3 top-3.5 text-slate-500" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="ابحث بالإيميل أو الاسم..."
                className={`${inputClass} pr-9`}
              />
            </div>
            {candidates.length > 0 && (
              <ul className="border border-slate-700 rounded-xl divide-y divide-slate-700 max-h-40 overflow-y-auto bg-slate-800">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMerchantId(c.id);
                        setAgencyName(c.name || '');
                        setSearchQ(c.email);
                        setCandidates([]);
                      }}
                      className={`w-full text-right px-3 py-2 text-sm hover:bg-slate-700 ${
                        selectedMerchantId === c.id ? 'bg-indigo-600/30' : ''
                      }`}
                    >
                      <div className="font-medium text-white">{c.name || '—'}</div>
                      <div className="text-xs text-slate-400">{c.email}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              type="text"
              placeholder="اسم الوكالة"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              className={inputClass}
            />
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-300">أسعار مخفّضة متفق عليها</p>
              {PLAN_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-3 text-sm text-slate-200"
                >
                  <span>{PLAN_LABELS[key]}</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={pricingDraft[key] || ''}
                    onChange={(e) =>
                      setPricingDraft({ ...pricingDraft, [key]: e.target.value })
                    }
                    className={priceInputClass}
                    placeholder="$"
                  />
                </label>
              ))}
            </div>
            <button
              type="submit"
              disabled={!selectedMerchantId || activating}
              className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {activating ? 'جاري التفعيل...' : 'تفعيل الوكالة'}
            </button>
          </form>
        </ModalOverlay>
      )}

      {editAgency && (
        <ModalOverlay panelClassName="w-full max-w-md" onClose={() => setEditAgency(null)}>
          <form
            onSubmit={savePricing}
            className="bg-slate-900 border border-slate-700 rounded-2xl w-full p-6 space-y-4 shadow-2xl text-slate-200"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-white">تسعير — {editAgency.name}</h3>
              <button
                type="button"
                onClick={() => setEditAgency(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X size={18} />
              </button>
            </div>
            {PLAN_KEYS.map((key) => (
              <label
                key={key}
                className="flex items-center justify-between gap-3 text-sm text-slate-200"
              >
                <span>{PLAN_LABELS[key]}</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={editPricing[key] || ''}
                  onChange={(e) => setEditPricing({ ...editPricing, [key]: e.target.value })}
                  className={priceInputClass}
                />
              </label>
            ))}
            <button
              type="submit"
              disabled={savingPricing}
              className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 disabled:opacity-50"
            >
              {savingPricing ? 'جاري الحفظ...' : 'حفظ الأسعار'}
            </button>
          </form>
        </ModalOverlay>
      )}

      {reviewRequest && (
        <ModalOverlay onClose={() => setReviewRequest(null)}>
          <form
            onSubmit={approveSignupRequest}
            className="bg-slate-900 border border-slate-700 rounded-2xl w-full p-6 space-y-4 shadow-2xl text-slate-200"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-white">موافقة على طلب وكالة</h3>
              <button
                type="button"
                onClick={() => setReviewRequest(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X size={18} />
              </button>
            </div>
            <div className="rounded-xl bg-slate-800 border border-slate-700 p-4 text-sm space-y-1">
              <p>
                <span className="text-slate-400">الوكالة: </span>
                {reviewRequest.agencyName}
              </p>
              <p dir="ltr">
                <span className="text-slate-400">البريد: </span>
                {reviewRequest.email}
              </p>
              <p dir="ltr">
                <span className="text-slate-400">الهاتف: </span>
                {reviewRequest.phone}
              </p>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">ملاحظة إدارية (اختياري)</label>
              <textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                rows={2}
                className={inputClass}
                placeholder="اتفاق التسعير أو أي ملاحظات..."
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-300">أسعار الوكالة المخفّضة</p>
              {PLAN_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-3 text-sm text-slate-200"
                >
                  <span>{PLAN_LABELS[key]}</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={reviewPricing[key] || ''}
                    onChange={(e) => setReviewPricing({ ...reviewPricing, [key]: e.target.value })}
                    className={priceInputClass}
                  />
                </label>
              ))}
            </div>
            <button
              type="submit"
              disabled={reviewing}
              className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 disabled:opacity-50"
            >
              {reviewing ? 'جاري الموافقة...' : 'موافقة وإنشاء الحساب'}
            </button>
          </form>
        </ModalOverlay>
      )}
    </div>
  );
};

export default AdminAgencies;
