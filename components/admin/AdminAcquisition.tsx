import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Megaphone,
  Loader2,
  Users,
  CreditCard,
  CalendarDays,
  Link2,
  Copy,
  Check,
  RotateCcw,
  Plus,
  Ban,
  Play,
} from 'lucide-react';
import apiService from '../../services/api';
import { useAdminNotifications } from './AdminNotificationContext';
import { buildUtmTrackingUrl } from '../../utils/marketingAttribution';
import { getSiteOrigin } from '../../utils/seo';

type UtmForm = {
  name: string;
  code: string;
  path: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
};

type SavedLink = Awaited<ReturnType<typeof apiService.getAdminAcquisitionLinks>>[number];

const EMPTY_FORM: UtmForm = {
  name: '',
  code: '',
  path: '/signup',
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
  utm_content: '',
  utm_term: '',
};

const PATH_OPTIONS = [
  { value: '/signup', label: 'التسجيل (/signup)' },
  { value: '/', label: 'الصفحة الرئيسية (/)' },
  { value: '/login', label: 'تسجيل الدخول (/login)' },
] as const;

const PRESETS: { id: string; label: string; patch: Partial<UtmForm> }[] = [
  {
    id: 'facebook-cpc',
    label: 'فيسبوك إعلان',
    patch: { utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: '' },
  },
  {
    id: 'instagram-cpc',
    label: 'إنستغرام إعلان',
    patch: { utm_source: 'instagram', utm_medium: 'cpc', utm_campaign: '' },
  },
  {
    id: 'google-cpc',
    label: 'جوجل إعلان',
    patch: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: '' },
  },
  {
    id: 'email',
    label: 'بريد',
    patch: { utm_source: 'email', utm_medium: 'email', utm_campaign: '' },
  },
  {
    id: 'whatsapp',
    label: 'واتساب',
    patch: { utm_source: 'whatsapp', utm_medium: 'social', utm_campaign: '' },
  },
  {
    id: 'tiktok',
    label: 'تيك توك',
    patch: { utm_source: 'tiktok', utm_medium: 'cpc', utm_campaign: '' },
  },
];

const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500';

const labelClass = 'block text-xs text-slate-400 mb-1.5';

const AdminAcquisition: React.FC = () => {
  const { showError, showSuccess } = useAdminNotifications();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Awaited<
    ReturnType<typeof apiService.getAdminAcquisitionStats>
  > | null>(null);

  const [form, setForm] = useState<UtmForm>(EMPTY_FORM);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await apiService.getAdminAcquisitionStats();
        if (!cancelled) setData(res);
      } catch (e: any) {
        if (!cancelled) showError(e?.message || 'فشل تحميل بيانات الاكتساب');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showError]);

  const loadLinks = useCallback(async () => {
    try {
      setLinksLoading(true);
      const res = await apiService.getAdminAcquisitionLinks();
      setLinks(res);
    } catch (e: any) {
      showError(e?.message || 'فشل تحميل الروابط الفريدة');
    } finally {
      setLinksLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  const trackedUrl = useMemo(
    () =>
      buildUtmTrackingUrl({
        baseUrl: getSiteOrigin(),
        path: form.path,
        utm_source: form.utm_source,
        utm_medium: form.utm_medium,
        utm_campaign: form.utm_campaign,
        utm_content: form.utm_content,
        utm_term: form.utm_term,
      }),
    [form]
  );

  const hasUtm = Boolean(
    form.utm_source.trim() ||
      form.utm_medium.trim() ||
      form.utm_campaign.trim() ||
      form.utm_content.trim() ||
      form.utm_term.trim()
  );

  const uniquePreview = `${getSiteOrigin()}/go/${(form.code.trim() || 'كود-تلقائي').replace(/\s+/g, '-')}`;

  const canSaveUnique = Boolean(form.name.trim() || hasUtm);

  const setField = (key: keyof UtmForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setCopied(false);
  };

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setForm((prev) => ({
      ...prev,
      ...preset.patch,
      utm_campaign: prev.utm_campaign || preset.patch.utm_campaign || '',
    }));
    setCopied(false);
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setCopied(false);
  };

  const copyText = async (text: string, id?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (id) {
        setCopiedId(id);
        window.setTimeout(() => setCopiedId(null), 2000);
      } else {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
      showSuccess('تم نسخ الرابط');
    } catch {
      showError('تعذّر النسخ — انسخ الرابط يدوياً من المعاينة');
    }
  };

  const copyUrl = async () => {
    if (!hasUtm) {
      showError('أدخل على الأقل مصدر أو حملة قبل النسخ');
      return;
    }
    await copyText(trackedUrl);
  };

  const saveUniqueLink = async () => {
    if (!canSaveUnique) {
      showError('أدخل اسماً أو حقول UTM قبل حفظ الرابط الفريد');
      return;
    }
    try {
      setSaving(true);
      const created = await apiService.createAdminAcquisitionLink({
        name: form.name.trim() || undefined,
        code: form.code.trim() || undefined,
        path: form.path,
        utm_source: form.utm_source.trim() || undefined,
        utm_medium: form.utm_medium.trim() || undefined,
        utm_campaign: form.utm_campaign.trim() || undefined,
        utm_content: form.utm_content.trim() || undefined,
        utm_term: form.utm_term.trim() || undefined,
      });
      showSuccess(`تم إنشاء الرابط ${created.code}`);
      setForm((prev) => ({ ...EMPTY_FORM, path: prev.path }));
      setCopied(false);
      await loadLinks();
      await copyText(created.url, created.id);
    } catch (e: any) {
      showError(e?.message || 'فشل حفظ الرابط الفريد');
    } finally {
      setSaving(false);
    }
  };

  const toggleLink = async (link: SavedLink) => {
    try {
      await apiService.updateAdminAcquisitionLink(link.id, !link.isActive);
      await loadLinks();
      showSuccess(link.isActive ? 'تم إيقاف الرابط' : 'تم تفعيل الرابط');
    } catch (e: any) {
      showError(e?.message || 'فشل تحديث الرابط');
    }
  };

  const cards = data
    ? [
        {
          label: 'تسجيلات بتتبع',
          value: data.totals.withAcquisition,
          icon: Users,
          tone: 'text-indigo-300',
        },
        {
          label: 'تحوّل لمدفوع',
          value: data.totals.paidConverted,
          icon: CreditCard,
          tone: 'text-emerald-300',
        },
        {
          label: 'تجربة نشطة',
          value: data.totals.trialActive,
          icon: Megaphone,
          tone: 'text-amber-300',
        },
        {
          label: 'آخر 7 أيام',
          value: data.totals.last7Days,
          icon: CalendarDays,
          tone: 'text-sky-300',
        },
      ]
    : [];

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-6xl">
      <header>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Megaphone className="text-indigo-400" size={26} />
          اكتساب التجار من الحملات
        </h2>
        <p className="text-slate-400 text-sm mt-2">
          أنشئ رابطاً فريداً قصيراً (`xo-bot.com/go/الكود`) أو رابط UTM كاملاً، ثم تابع النقرات والتسجيلات.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="font-bold text-slate-100 flex items-center gap-2">
            <Link2 size={18} className="text-indigo-400" />
            منشئ روابط UTM
          </div>
          <button
            type="button"
            onClick={resetForm}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <RotateCcw size={12} />
            إعادة تعيين
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:border-indigo-500/60 hover:text-indigo-200 hover:bg-indigo-950/40 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className={labelClass} htmlFor="utm-name">
                اسم الرابط
              </label>
              <input
                id="utm-name"
                className={inputClass}
                placeholder="حملة رمضان فيسبوك"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="utm-code">
                كود فريد مخصص
              </label>
              <input
                id="utm-code"
                className={inputClass}
                placeholder="RAMADAN26 أو اتركه فارغاً"
                value={form.code}
                onChange={(e) => setField('code', e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="utm-path">
                الصفحة المستهدفة
              </label>
              <select
                id="utm-path"
                value={form.path}
                onChange={(e) => setField('path', e.target.value)}
                className={inputClass}
              >
                {PATH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="utm-source">
                utm_source
              </label>
              <input
                id="utm-source"
                className={inputClass}
                placeholder="facebook"
                value={form.utm_source}
                onChange={(e) => setField('utm_source', e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="utm-medium">
                utm_medium
              </label>
              <input
                id="utm-medium"
                className={inputClass}
                placeholder="cpc"
                value={form.utm_medium}
                onChange={(e) => setField('utm_medium', e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="utm-campaign">
                utm_campaign
              </label>
              <input
                id="utm-campaign"
                className={inputClass}
                placeholder="ramadan_2026"
                value={form.utm_campaign}
                onChange={(e) => setField('utm_campaign', e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="utm-content">
                utm_content
              </label>
              <input
                id="utm-content"
                className={inputClass}
                placeholder="video_a"
                value={form.utm_content}
                onChange={(e) => setField('utm_content', e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="utm-term">
                utm_term
              </label>
              <input
                id="utm-term"
                className={inputClass}
                placeholder="بوت مبيعات"
                value={form.utm_term}
                onChange={(e) => setField('utm_term', e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 space-y-2">
            <div className="text-xs text-slate-500">معاينة الرابط</div>
            <code
              className={`block text-sm font-mono break-all leading-relaxed ${
                hasUtm ? 'text-indigo-300' : 'text-slate-500'
              }`}
            >
              {trackedUrl}
            </code>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => void copyUrl()}
                disabled={!hasUtm}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'تم النسخ' : 'نسخ الرابط'}
              </button>
            </div>
            {!hasUtm && (
              <p className="text-[11px] text-slate-500">
                املأ المصدر والحملة (على الأقل) ثم انسخ الرابط لاستخدامه في الإعلان.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-indigo-900/50 bg-indigo-950/20 p-3 space-y-2">
            <div className="text-xs text-indigo-300/80">الرابط الفريد القصير</div>
            <code className="block text-sm font-mono break-all leading-relaxed text-indigo-200">
              {uniquePreview}
            </code>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => void saveUniqueLink()}
                disabled={!canSaveUnique || saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                حفظ رابط فريد
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              يُحفظ في لوحة التحكم ويُحتسب نقراته وتسجيلاته. إن تركت الكود فارغاً يُولَّد تلقائياً.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 font-bold text-slate-100">
          الروابط الفريدة المحفوظة
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs">
              <tr>
                <th className="text-right px-4 py-2">الاسم / الكود</th>
                <th className="text-right px-4 py-2">الرابط</th>
                <th className="text-right px-4 py-2">نقرات</th>
                <th className="text-right px-4 py-2">تسجيلات</th>
                <th className="text-right px-4 py-2">مدفوع</th>
                <th className="text-right px-4 py-2">الحالة</th>
                <th className="text-right px-4 py-2">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {linksLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="animate-spin" size={16} />
                      جاري تحميل الروابط…
                    </span>
                  </td>
                </tr>
              )}
              {!linksLoading && links.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    لا روابط فريدة بعد — احفظ رابطاً من النموذج أعلاه
                  </td>
                </tr>
              )}
              {!linksLoading &&
                links.map((link) => (
                  <tr key={link.id} className="border-t border-slate-800/80">
                    <td className="px-4 py-2.5">
                      <div className="text-slate-100 font-medium">{link.name || '—'}</div>
                      <div className="text-[11px] text-indigo-300 font-mono">{link.code}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <code className="text-[11px] text-slate-400 break-all">{link.url}</code>
                    </td>
                    <td className="px-4 py-2.5 text-slate-300">{link.clickCount}</td>
                    <td className="px-4 py-2.5 text-slate-300">{link.signups}</td>
                    <td className="px-4 py-2.5 text-emerald-300">{link.paid}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-xs ${link.isActive ? 'text-emerald-300' : 'text-slate-500'}`}
                      >
                        {link.isActive ? 'نشط' : 'متوقف'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void copyText(link.url, link.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                          title="نسخ"
                        >
                          {copiedId === link.id ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleLink(link)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                          title={link.isActive ? 'إيقاف' : 'تفعيل'}
                        >
                          {link.isActive ? <Ban size={14} /> : <Play size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {loading && (
        <div className="flex items-center gap-2 text-slate-400 py-4">
          <Loader2 className="animate-spin" size={18} />
          جاري تحميل مصادر التسجيل…
        </div>
      )}

      {!loading && !data && (
        <div className="text-slate-400 py-2">لا توجد بيانات إحصائيات</div>
      )}

      {!loading && data && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map((c) => (
              <div
                key={c.label}
                className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-slate-400">{c.label}</span>
                  <c.icon size={16} className={c.tone} />
                </div>
                <p className="text-2xl font-extrabold text-white">{c.value}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <section className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 font-bold text-slate-100">
                حسب المصدر
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-slate-500 text-xs">
                    <tr>
                      <th className="text-right px-4 py-2">المصدر</th>
                      <th className="text-right px-4 py-2">تسجيلات</th>
                      <th className="text-right px-4 py-2">مدفوع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bySource.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                          لا بيانات بعد — ستظهر بعد أول تسجيل متتبَّع
                        </td>
                      </tr>
                    )}
                    {data.bySource.map((row) => (
                      <tr key={row.key} className="border-t border-slate-800/80">
                        <td className="px-4 py-2.5 text-slate-200">{row.key}</td>
                        <td className="px-4 py-2.5 text-slate-300">{row.signups}</td>
                        <td className="px-4 py-2.5 text-emerald-300">{row.paid}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 font-bold text-slate-100">
                حسب الحملة
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-slate-500 text-xs">
                    <tr>
                      <th className="text-right px-4 py-2">الحملة</th>
                      <th className="text-right px-4 py-2">تسجيلات</th>
                      <th className="text-right px-4 py-2">مدفوع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCampaign.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                          لا حملات بعد
                        </td>
                      </tr>
                    )}
                    {data.byCampaign.map((row) => (
                      <tr key={row.key} className="border-t border-slate-800/80">
                        <td className="px-4 py-2.5 text-slate-200">{row.key}</td>
                        <td className="px-4 py-2.5 text-slate-300">{row.signups}</td>
                        <td className="px-4 py-2.5 text-emerald-300">{row.paid}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 font-bold text-slate-100">
              أحدث التجار المتتبَّعين
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-xs">
                  <tr>
                    <th className="text-right px-4 py-2">التاجر</th>
                    <th className="text-right px-4 py-2">المصدر</th>
                    <th className="text-right px-4 py-2">الحملة</th>
                    <th className="text-right px-4 py-2">الخطة</th>
                    <th className="text-right px-4 py-2">acq</th>
                    <th className="text-right px-4 py-2">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                        لا تسجيلات متتبَّعة بعد
                      </td>
                    </tr>
                  )}
                  {data.recent.map((m) => (
                    <tr key={m.id} className="border-t border-slate-800/80">
                      <td className="px-4 py-2.5">
                        <div className="text-slate-100 font-medium">{m.name || '—'}</div>
                        <div className="text-[11px] text-slate-500">{m.email}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-300">{m.source || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-300">{m.campaign || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-300">{m.plan}</td>
                      <td className="px-4 py-2.5 text-indigo-300 font-mono text-xs">
                        {m.acqCode || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">
                        {m.createdAt ? new Date(m.createdAt).toLocaleDateString('ar') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default AdminAcquisition;
