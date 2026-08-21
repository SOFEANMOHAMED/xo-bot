import React, { useEffect, useState } from 'react';
import { Megaphone, Loader2, Users, CreditCard, CalendarDays } from 'lucide-react';
import apiService from '../../services/api';
import { useAdminNotifications } from './AdminNotificationContext';

const AdminAcquisition: React.FC = () => {
  const { showError } = useAdminNotifications();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Awaited<
    ReturnType<typeof apiService.getAdminAcquisitionStats>
  > | null>(null);

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

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={18} />
        جاري تحميل مصادر التسجيل…
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-slate-400">لا توجد بيانات</div>;
  }

  const cards = [
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
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-6xl">
      <header>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Megaphone className="text-indigo-400" size={26} />
          اكتساب التجار من الحملات
        </h2>
        <p className="text-slate-400 text-sm mt-2">
          تتبع UTM وروابط Messenger المتتبَّعة (`acq`) وربطها بتسجيل التاجر والتحويل للمدفوع.
          استخدم في الإعلانات:{' '}
          <code className="text-indigo-300">xo-bot.com/signup?utm_campaign=...</code> أو روابط البوت
          الرسمية.
        </p>
      </header>

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
    </div>
  );
};

export default AdminAcquisition;
