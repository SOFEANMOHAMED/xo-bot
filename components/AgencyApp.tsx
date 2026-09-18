import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Ban,
  CreditCard,
  X,
  Search,
  KeyRound,
  Pencil,
  Trash2,
  Copy,
  Users,
  Wallet,
  AlertTriangle,
  LayoutDashboard,
  Receipt,
} from 'lucide-react';
import apiService from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import SeoHead from './SeoHead';
import { PaymentMethodLogo } from './PaymentMethodLogo';
import ModalOverlay from './ModalOverlay';

const PLAN_LABELS: Record<string, string> = {
  comments: 'التعليقات',
  single: 'القناة الواحدة',
  social: 'السوشيال',
  yearly: 'السنوية',
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'بانتظار الدفع',
  active: 'نشط',
  suspended: 'معلّق',
  cancelled: 'ملغى',
};

const PURPOSE_LABELS: Record<string, string> = {
  activate: 'تفعيل',
  renew: 'تجديد',
  change_plan: 'تغيير باقة',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'قيد المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
};

type Seat = {
  id: string;
  planKey: string;
  unitPrice: number;
  status: string;
  clientLabel: string | null;
  clientEmail?: string;
  endsAt: string | null;
  createdAt: string;
};

type Pricing = { planKey: string; unitPrice: number };

type AgencyReports = {
  seats: {
    pending_payment: number;
    active: number;
    suspended: number;
    cancelled: number;
    total: number;
  };
  byPlan: Array<{ planKey: string; total: number; active: number }>;
  expiringSoon: Array<{
    id: string;
    planKey: string;
    clientLabel: string | null;
    clientEmail: string;
    endsAt: string;
    unitPrice: number;
  }>;
  spending: {
    thisMonth: number;
    total: number;
    pendingAmount: number;
    pendingCount: number;
    approvedCount: number;
  };
};

type AgencyPayment = {
  id: string;
  seatId: string;
  planKey: string;
  amount: number;
  purpose: string;
  method: string;
  status: string;
  adminNote: string | null;
  createdAt: string;
  clientLabel: string | null;
  clientEmail: string;
};

type Tab = 'overview' | 'seats' | 'payments';

const AgencyApp: React.FC = () => {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [agencyName, setAgencyName] = useState('');
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [reports, setReports] = useState<AgencyReports | null>(null);
  const [payments, setPayments] = useState<AgencyPayment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [seatFilter, setSeatFilter] = useState('all');
  const [seatSearch, setSeatSearch] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    email: '',
    password: '',
    planKey: 'comments',
    clientLabel: '',
  });
  const [creating, setCreating] = useState(false);

  const [paySeat, setPaySeat] = useState<Seat | null>(null);
  const [payPurpose, setPayPurpose] = useState<'activate' | 'renew' | 'change_plan'>('activate');
  const [payPlanKey, setPayPlanKey] = useState('comments');
  const [payMethods, setPayMethods] = useState<
    Array<{
      id: string;
      name: string;
      walletAddress: string;
      qrImageUrl: string;
      network?: string;
      instructions?: string;
    }>
  >([]);
  const [selectedMethod, setSelectedMethod] = useState<string>('sham_cash');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [paying, setPaying] = useState(false);

  const [editSeat, setEditSeat] = useState<Seat | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [passwordSeat, setPasswordSeat] = useState<Seat | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [me, seatsRes, reportsRes, paymentsRes] = await Promise.all([
        apiService.getAgencyMe(),
        apiService.getAgencySeats(),
        apiService.getAgencyReports(),
        apiService.getAgencyPayments(),
      ]);
      setAgencyName(me.agency.name);
      setPricing(me.pricing || []);
      setSeats(seatsRes.seats || []);
      setReports(reportsRes.reports || null);
      setPayments(paymentsRes.payments || []);
      if (me.pricing?.length) {
        setCreateForm((f) => ({
          ...f,
          planKey: me.pricing.some((p) => p.planKey === f.planKey)
            ? f.planKey
            : me.pricing[0].planKey,
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات الوكالة');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const priceFor = (planKey: string) =>
    pricing.find((p) => p.planKey === planKey)?.unitPrice;

  const filteredSeats = useMemo(() => {
    const q = seatSearch.trim().toLowerCase();
    return seats.filter((s) => {
      if (seatFilter !== 'all' && s.status !== seatFilter) return false;
      if (!q) return true;
      return (
        (s.clientEmail || '').toLowerCase().includes(q) ||
        (s.clientLabel || '').toLowerCase().includes(q) ||
        (PLAN_LABELS[s.planKey] || s.planKey).includes(q)
      );
    });
  }, [seats, seatFilter, seatSearch]);

  const flash = (msg: string) => {
    setSuccess(msg);
    setError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const result = await apiService.createAgencySeat({
        email: createForm.email.trim(),
        password: createForm.password,
        planKey: createForm.planKey,
        clientLabel: createForm.clientLabel.trim() || undefined,
      });
      flash(`تم إنشاء المقعد. المبلغ المستحق للتفعيل: $${result.amountDue}`);
      setShowCreate(false);
      setCreateForm({
        email: '',
        password: '',
        planKey: pricing[0]?.planKey || 'comments',
        clientLabel: '',
      });
      await load();
      setPaySeat(result.seat as Seat);
      setPayPurpose('activate');
      setPayPlanKey(result.seat.planKey);
      setTab('seats');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل إنشاء المقعد');
    } finally {
      setCreating(false);
    }
  };

  const openPay = async (seat: Seat, purpose: 'activate' | 'renew' | 'change_plan') => {
    setPaySeat(seat);
    setPayPurpose(purpose);
    setPayPlanKey(seat.planKey);
    setProofFile(null);
    setError(null);
    try {
      const methods = await apiService.getBillingPaymentMethods();
      setPayMethods(methods.methods || []);
      if (methods.methods?.[0]) setSelectedMethod(methods.methods[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل وسائل الدفع');
    }
  };

  const submitPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paySeat || !proofFile) return;
    setPaying(true);
    setError(null);
    try {
      const uploaded = await apiService.uploadPaymentProof(proofFile);
      await apiService.payAgencySeat(paySeat.id, {
        proofUrl: uploaded.file.url,
        method: selectedMethod,
        purpose: payPurpose,
        planKey: payPurpose === 'change_plan' ? payPlanKey : undefined,
      });
      flash('تم إرسال إثبات الدفع. سيتم التفعيل بعد موافقة الإدارة.');
      setPaySeat(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل إرسال الدفع');
    } finally {
      setPaying(false);
    }
  };

  const handleSuspend = async (seat: Seat) => {
    if (!window.confirm(`تعليق مقعد ${seat.clientLabel || seat.clientEmail}؟`)) return;
    try {
      await apiService.suspendAgencySeat(seat.id);
      flash('تم تعليق المقعد');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل التعليق');
    }
  };

  const handleCancel = async (seat: Seat) => {
    if (
      !window.confirm(
        `إلغاء مقعد ${seat.clientLabel || seat.clientEmail} نهائياً؟ لن يتمكن العميل من استخدام الخدمة.`
      )
    ) {
      return;
    }
    try {
      await apiService.cancelAgencySeat(seat.id);
      flash('تم إلغاء المقعد');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الإلغاء');
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editSeat) return;
    setSavingEdit(true);
    try {
      await apiService.updateAgencySeat(editSeat.id, { clientLabel: editLabel.trim() || null });
      flash('تم تحديث اسم العميل');
      setEditSeat(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل التحديث');
    } finally {
      setSavingEdit(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordSeat) return;
    setSavingPassword(true);
    try {
      await apiService.resetAgencySeatPassword(passwordSeat.id, newPassword);
      flash('تم تحديث كلمة مرور العميل');
      setPasswordSeat(null);
      setNewPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تحديث كلمة المرور');
    } finally {
      setSavingPassword(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash('تم النسخ');
    } catch {
      setError('تعذر النسخ');
    }
  };

  const selectedPayMethod = payMethods.find((m) => m.id === selectedMethod);
  const dueAmount =
    payPurpose === 'change_plan'
      ? priceFor(payPlanKey)
      : paySeat
        ? priceFor(paySeat.planKey) ?? paySeat.unitPrice
        : undefined;

  const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: 'التقارير', icon: LayoutDashboard },
    { id: 'seats', label: 'المقاعد', icon: Users },
    { id: 'payments', label: 'المدفوعات', icon: Receipt },
  ];

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      <SeoHead title="لوحة الوكالة" noindex />
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <Building2 size={20} />
            </div>
            <div>
              <h1 className="font-bold text-slate-900">{agencyName || 'وكالة'}</h1>
              <p className="text-xs text-slate-500">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              title="تحديث"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => logout()}
              className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-100"
            >
              <LogOut size={16} />
              خروج
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
                tab === t.id
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {error && (
          <div className="rounded-xl bg-red-50 text-red-700 text-sm px-4 py-3 border border-red-100">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl bg-emerald-50 text-emerald-700 text-sm px-4 py-3 border border-emerald-100">
            {success}
          </div>
        )}

        {loading && !reports ? (
          <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
            <Loader2 className="animate-spin" size={22} />
            جاري التحميل...
          </div>
        ) : (
          <>
            {tab === 'overview' && reports && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <div className="text-xs text-slate-500 mb-1">إجمالي المقاعد</div>
                    <div className="text-2xl font-bold text-slate-900">{reports.seats.total}</div>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <div className="text-xs text-slate-500 mb-1">نشطة</div>
                    <div className="text-2xl font-bold text-emerald-600">{reports.seats.active}</div>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <div className="text-xs text-slate-500 mb-1">بانتظار الدفع</div>
                    <div className="text-2xl font-bold text-amber-600">
                      {reports.seats.pending_payment}
                    </div>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <div className="text-xs text-slate-500 mb-1">معلّقة</div>
                    <div className="text-2xl font-bold text-red-600">{reports.seats.suspended}</div>
                  </div>
                </div>

                <div className="grid md:grid-cols-3 gap-3">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <div className="flex items-center gap-2 text-slate-700 font-bold mb-3">
                      <Wallet size={18} />
                      المدفوعات
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">هذا الشهر</span>
                        <span className="font-bold text-slate-900">
                          ${reports.spending.thisMonth.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">الإجمالي المعتمد</span>
                        <span className="font-bold text-slate-900">
                          ${reports.spending.total.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">قيد المراجعة</span>
                        <span className="font-bold text-amber-600">
                          ${reports.spending.pendingAmount.toFixed(2)} ({reports.spending.pendingCount})
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-5 md:col-span-2">
                    <div className="font-bold text-slate-700 mb-3">توزيع الباقات</div>
                    {reports.byPlan.length === 0 ? (
                      <p className="text-sm text-slate-500">لا توجد مقاعد بعد.</p>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-2">
                        {reports.byPlan.map((p) => (
                          <div
                            key={p.planKey}
                            className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 flex justify-between items-center"
                          >
                            <span className="text-sm font-medium text-slate-800">
                              {PLAN_LABELS[p.planKey] || p.planKey}
                            </span>
                            <span className="text-sm text-slate-600">
                              {p.active} نشط / {p.total}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <section className="bg-white rounded-2xl border border-slate-200 p-5">
                  <div className="flex items-center gap-2 font-bold text-slate-800 mb-3">
                    <AlertTriangle size={18} className="text-amber-500" />
                    تنتهي خلال 14 يوماً
                  </div>
                  {reports.expiringSoon.length === 0 ? (
                    <p className="text-sm text-slate-500">لا توجد مقاعد قريبة من الانتهاء.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-100 text-right">
                            <th className="py-2 px-2 font-medium">العميل</th>
                            <th className="py-2 px-2 font-medium">الباقة</th>
                            <th className="py-2 px-2 font-medium">ينتهي</th>
                            <th className="py-2 px-2 font-medium">إجراء</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reports.expiringSoon.map((row) => {
                            const seat = seats.find((s) => s.id === row.id);
                            return (
                              <tr key={row.id} className="border-b border-slate-50">
                                <td className="py-3 px-2">
                                  <div className="font-medium">{row.clientLabel || '—'}</div>
                                  <div className="text-xs text-slate-500">{row.clientEmail}</div>
                                </td>
                                <td className="py-3 px-2">
                                  {PLAN_LABELS[row.planKey] || row.planKey}
                                </td>
                                <td className="py-3 px-2 text-amber-700 font-medium">
                                  {new Date(row.endsAt).toLocaleDateString('ar')}
                                </td>
                                <td className="py-3 px-2">
                                  {seat && (
                                    <button
                                      type="button"
                                      onClick={() => void openPay(seat, 'renew')}
                                      className="text-xs px-2 py-1 rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100"
                                    >
                                      تجديد الآن
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="bg-white rounded-2xl border border-slate-200 p-5">
                  <h2 className="font-bold text-slate-900 mb-3">أسعارك المتفق عليها</h2>
                  {pricing.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      لم تُضبط أسعار لوكالتك بعد. تواصل مع الإدارة.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {pricing.map((p) => (
                        <div
                          key={p.planKey}
                          className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 min-w-[140px]"
                        >
                          <div className="text-sm text-slate-600">
                            {PLAN_LABELS[p.planKey] || p.planKey}
                          </div>
                          <div className="text-lg font-bold text-slate-900">${p.unitPrice}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {tab === 'seats' && (
              <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-bold text-slate-900">مقاعد العملاء</h2>
                  <button
                    type="button"
                    disabled={pricing.length === 0}
                    onClick={() => setShowCreate(true)}
                    className="inline-flex items-center gap-1.5 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-40"
                  >
                    <Plus size={16} />
                    مقعد جديد
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={16} className="absolute right-3 top-2.5 text-slate-400" />
                    <input
                      value={seatSearch}
                      onChange={(e) => setSeatSearch(e.target.value)}
                      placeholder="بحث بالاسم أو الإيميل..."
                      className="w-full rounded-xl border border-slate-200 pr-9 pl-3 py-2 text-sm"
                    />
                  </div>
                  <select
                    value={seatFilter}
                    onChange={(e) => setSeatFilter(e.target.value)}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="all">كل الحالات</option>
                    <option value="active">نشط</option>
                    <option value="pending_payment">بانتظار الدفع</option>
                    <option value="suspended">معلّق</option>
                    <option value="cancelled">ملغى</option>
                  </select>
                </div>

                {filteredSeats.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">لا توجد مقاعد مطابقة.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-100 text-right">
                          <th className="py-2 px-2 font-medium">العميل</th>
                          <th className="py-2 px-2 font-medium">الباقة</th>
                          <th className="py-2 px-2 font-medium">السعر</th>
                          <th className="py-2 px-2 font-medium">الحالة</th>
                          <th className="py-2 px-2 font-medium">ينتهي</th>
                          <th className="py-2 px-2 font-medium">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSeats.map((seat) => (
                          <tr key={seat.id} className="border-b border-slate-50 align-top">
                            <td className="py-3 px-2">
                              <div className="font-medium text-slate-900">
                                {seat.clientLabel || '—'}
                              </div>
                              <div className="text-xs text-slate-500 flex items-center gap-1">
                                {seat.clientEmail}
                                {seat.clientEmail && (
                                  <button
                                    type="button"
                                    onClick={() => void copyText(seat.clientEmail!)}
                                    className="text-slate-400 hover:text-slate-700"
                                    title="نسخ الإيميل"
                                  >
                                    <Copy size={12} />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-2">
                              {PLAN_LABELS[seat.planKey] || seat.planKey}
                            </td>
                            <td className="py-3 px-2">${seat.unitPrice}</td>
                            <td className="py-3 px-2">
                              {STATUS_LABELS[seat.status] || seat.status}
                            </td>
                            <td className="py-3 px-2 text-slate-500">
                              {seat.endsAt
                                ? new Date(seat.endsAt).toLocaleDateString('ar')
                                : '—'}
                            </td>
                            <td className="py-3 px-2">
                              <div className="flex flex-wrap gap-1">
                                {(seat.status === 'pending_payment' ||
                                  seat.status === 'suspended') && (
                                  <button
                                    type="button"
                                    onClick={() => void openPay(seat, 'activate')}
                                    className="text-xs px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 inline-flex items-center gap-1"
                                  >
                                    <CreditCard size={12} />
                                    دفع/تفعيل
                                  </button>
                                )}
                                {seat.status === 'active' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => void openPay(seat, 'renew')}
                                      className="text-xs px-2 py-1 rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100"
                                    >
                                      تجديد
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void openPay(seat, 'change_plan')}
                                      className="text-xs px-2 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100"
                                    >
                                      تغيير باقة
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleSuspend(seat)}
                                      className="text-xs px-2 py-1 rounded-lg bg-orange-50 text-orange-700 hover:bg-orange-100 inline-flex items-center gap-1"
                                    >
                                      <Ban size={12} />
                                      تعليق
                                    </button>
                                  </>
                                )}
                                {seat.status !== 'cancelled' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditSeat(seat);
                                        setEditLabel(seat.clientLabel || '');
                                      }}
                                      className="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 inline-flex items-center gap-1"
                                    >
                                      <Pencil size={12} />
                                      تعديل
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPasswordSeat(seat);
                                        setNewPassword('');
                                      }}
                                      className="text-xs px-2 py-1 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 inline-flex items-center gap-1"
                                    >
                                      <KeyRound size={12} />
                                      كلمة المرور
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleCancel(seat)}
                                      className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 inline-flex items-center gap-1"
                                    >
                                      <Trash2 size={12} />
                                      إلغاء
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {tab === 'payments' && (
              <section className="bg-white rounded-2xl border border-slate-200 p-5">
                <h2 className="font-bold text-slate-900 mb-4">سجل المدفوعات</h2>
                {payments.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">لا توجد مدفوعات بعد.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-100 text-right">
                          <th className="py-2 px-2 font-medium">العميل</th>
                          <th className="py-2 px-2 font-medium">الباقة</th>
                          <th className="py-2 px-2 font-medium">الغرض</th>
                          <th className="py-2 px-2 font-medium">المبلغ</th>
                          <th className="py-2 px-2 font-medium">الحالة</th>
                          <th className="py-2 px-2 font-medium">التاريخ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p) => (
                          <tr key={p.id} className="border-b border-slate-50">
                            <td className="py-3 px-2">
                              <div className="font-medium">{p.clientLabel || '—'}</div>
                              <div className="text-xs text-slate-500">{p.clientEmail}</div>
                            </td>
                            <td className="py-3 px-2">
                              {PLAN_LABELS[p.planKey] || p.planKey}
                            </td>
                            <td className="py-3 px-2">
                              {PURPOSE_LABELS[p.purpose] || p.purpose}
                            </td>
                            <td className="py-3 px-2 font-medium">${p.amount}</td>
                            <td className="py-3 px-2">
                              <span
                                className={`text-xs font-medium ${
                                  p.status === 'approved'
                                    ? 'text-emerald-600'
                                    : p.status === 'rejected'
                                      ? 'text-red-600'
                                      : 'text-amber-600'
                                }`}
                              >
                                {PAYMENT_STATUS_LABELS[p.status] || p.status}
                              </span>
                              {p.adminNote && (
                                <div className="text-xs text-slate-400 mt-0.5">{p.adminNote}</div>
                              )}
                            </td>
                            <td className="py-3 px-2 text-slate-500">
                              {new Date(p.createdAt).toLocaleDateString('ar')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {showCreate && (
        <ModalOverlay panelClassName="w-full max-w-md" onClose={() => setShowCreate(false)}>
          <form
            onSubmit={handleCreate}
            className="bg-white rounded-2xl w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900">مقعد عميل جديد</h3>
              <button type="button" onClick={() => setShowCreate(false)}>
                <X size={18} />
              </button>
            </div>
            <input
              required
              type="email"
              placeholder="بريد العميل"
              value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
            />
            <input
              required
              type="password"
              minLength={6}
              placeholder="كلمة مرور الحساب"
              value={createForm.password}
              onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
            />
            <input
              type="text"
              placeholder="اسم عرض للعميل (اختياري)"
              value={createForm.clientLabel}
              onChange={(e) => setCreateForm({ ...createForm, clientLabel: e.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
            />
            <select
              value={createForm.planKey}
              onChange={(e) => setCreateForm({ ...createForm, planKey: e.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
            >
              {pricing.map((p) => (
                <option key={p.planKey} value={p.planKey}>
                  {PLAN_LABELS[p.planKey] || p.planKey} — ${p.unitPrice}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-xl bg-slate-900 text-white font-medium py-3 disabled:opacity-50"
            >
              {creating ? 'جاري الإنشاء...' : 'إنشاء المقعد'}
            </button>
          </form>
        </ModalOverlay>
      )}

      {paySeat && (
        <ModalOverlay panelClassName="w-full max-w-md" onClose={() => setPaySeat(null)}>
          <form
            onSubmit={submitPay}
            className="bg-white rounded-2xl w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900">
                {payPurpose === 'renew'
                  ? 'تجديد مقعد'
                  : payPurpose === 'change_plan'
                    ? 'تغيير باقة'
                    : 'تفعيل مقعد'}
              </h3>
              <button type="button" onClick={() => setPaySeat(null)}>
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-600">
              {paySeat.clientLabel || paySeat.clientEmail} — المبلغ:{' '}
              <strong>${dueAmount ?? '—'}</strong>
            </p>

            {payPurpose === 'change_plan' && (
              <select
                value={payPlanKey}
                onChange={(e) => setPayPlanKey(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
              >
                {pricing.map((p) => (
                  <option key={p.planKey} value={p.planKey}>
                    {PLAN_LABELS[p.planKey] || p.planKey} — ${p.unitPrice}
                  </option>
                ))}
              </select>
            )}

            <div className="space-y-2">
              {payMethods.map((m) => (
                <label
                  key={m.id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2 cursor-pointer ${
                    selectedMethod === m.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="method"
                    checked={selectedMethod === m.id}
                    onChange={() => setSelectedMethod(m.id)}
                  />
                  <PaymentMethodLogo methodId={m.id} className="w-8 h-8" />
                  <span className="text-sm font-medium text-slate-800">{m.name}</span>
                </label>
              ))}
            </div>

            {selectedPayMethod && (
              <div className="rounded-xl bg-slate-50 p-3 text-sm space-y-2 text-slate-700">
                <div className="font-mono text-xs break-all">{selectedPayMethod.walletAddress}</div>
                {selectedPayMethod.qrImageUrl && (
                  <img
                    src={selectedPayMethod.qrImageUrl}
                    alt="QR"
                    className="w-40 h-40 object-contain mx-auto"
                  />
                )}
                {selectedPayMethod.instructions && <p>{selectedPayMethod.instructions}</p>}
              </div>
            )}

            <input
              required
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setProofFile(e.target.files?.[0] || null)}
              className="w-full text-sm"
            />

            <button
              type="submit"
              disabled={paying || !proofFile}
              className="w-full rounded-xl bg-emerald-600 text-white font-medium py-3 disabled:opacity-50"
            >
              {paying ? 'جاري الإرسال...' : 'إرسال إثبات الدفع'}
            </button>
          </form>
        </ModalOverlay>
      )}

      {editSeat && (
        <ModalOverlay panelClassName="w-full max-w-md" onClose={() => setEditSeat(null)}>
          <form
            onSubmit={saveEdit}
            className="bg-white rounded-2xl w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900">تعديل اسم العميل</h3>
              <button type="button" onClick={() => setEditSeat(null)}>
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-500">{editSeat.clientEmail}</p>
            <input
              type="text"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              placeholder="اسم العرض"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
            />
            <button
              type="submit"
              disabled={savingEdit}
              className="w-full rounded-xl bg-slate-900 text-white font-medium py-3 disabled:opacity-50"
            >
              {savingEdit ? 'جاري الحفظ...' : 'حفظ'}
            </button>
          </form>
        </ModalOverlay>
      )}

      {passwordSeat && (
        <ModalOverlay panelClassName="w-full max-w-md" onClose={() => setPasswordSeat(null)}>
          <form
            onSubmit={savePassword}
            className="bg-white rounded-2xl w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900">إعادة تعيين كلمة المرور</h3>
              <button type="button" onClick={() => setPasswordSeat(null)}>
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-500">{passwordSeat.clientEmail}</p>
            <input
              required
              type="password"
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="كلمة مرور جديدة (6 أحرف على الأقل)"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900"
            />
            <button
              type="submit"
              disabled={savingPassword}
              className="w-full rounded-xl bg-violet-600 text-white font-medium py-3 disabled:opacity-50"
            >
              {savingPassword ? 'جاري التحديث...' : 'تحديث كلمة المرور'}
            </button>
          </form>
        </ModalOverlay>
      )}
    </div>
  );
};

export default AgencyApp;
