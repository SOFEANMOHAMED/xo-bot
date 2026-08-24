/**
 * Super-admin: publish & schedule posts on the official XO Bot Facebook/Instagram page.
 * Mirrors merchant ContentPublishingPage — platform-scoped, isolated from merchant data.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  Check,
  Clock3,
  Facebook,
  ImagePlus,
  Instagram,
  Loader2,
  Megaphone,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  X,
  ExternalLink,
} from 'lucide-react';
import apiService from '../../services/api';
import { useAdminNotifications } from './AdminNotificationContext';
import { adminPath } from '../../routes/paths';
import { AdminView } from '../../types';
import type {
  ContentPlatform,
  ContentPublication,
  ContentPublishAccount,
  PublicationStatus,
} from '../../types/contentPublishing';

type TargetKey = `${ContentPlatform}:${string}`;

const STATUS_LABEL: Record<PublicationStatus, string> = {
  draft: 'مسودة',
  scheduled: 'مجدول',
  publishing: 'جاري النشر',
  published: 'منشور',
  partial: 'منشور جزئياً',
  failed: 'فشل',
  cancelled: 'ملغى',
};

const STATUS_STYLE: Record<PublicationStatus, string> = {
  draft: 'bg-slate-700 text-slate-200',
  scheduled: 'bg-amber-900/40 text-amber-200',
  publishing: 'bg-blue-900/40 text-blue-200',
  published: 'bg-emerald-900/40 text-emerald-200',
  partial: 'bg-orange-900/40 text-orange-200',
  failed: 'bg-red-900/40 text-red-200',
  cancelled: 'bg-slate-700 text-slate-400',
};

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultScheduleValue(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInputValue(d);
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function accountKey(platform: ContentPlatform, accountRef: string): TargetKey {
  return `${platform}:${accountRef}`;
}

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const VIDEO_ACCEPT = 'video/mp4,video/quicktime,.mp4,.mov,.m4v';
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v'];

function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  const name = file.name.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function validatePublishFile(file: File): string | null {
  const video = isVideoFile(file);
  if (video) {
    const name = file.name.toLowerCase();
    const okType =
      file.type === 'video/mp4' ||
      file.type === 'video/quicktime' ||
      file.type === 'video/x-m4v' ||
      VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
    if (!okType) return `"${file.name}" صيغة فيديو غير مدعومة. استخدم MP4 أو MOV.`;
    if (file.size > VIDEO_MAX_BYTES) return `"${file.name}" يتجاوز 100 ميجابايت.`;
    return null;
  }
  if (!file.type.startsWith('image/')) {
    return `"${file.name}" ليس صورة أو فيديو مدعوماً.`;
  }
  if (file.size > IMAGE_MAX_BYTES) return `"${file.name}" يتجاوز 10 ميجابايت.`;
  return null;
}

const AdminContentPublishing: React.FC = () => {
  const { showNotification } = useAdminNotifications();
  const notifyRef = useRef(showNotification);
  notifyRef.current = showNotification;

  const [loading, setLoading] = useState(true);
  const [pageLinked, setPageLinked] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [accounts, setAccounts] = useState<ContentPublishAccount[]>([]);
  const [publications, setPublications] = useState<ContentPublication[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<'all' | 'scheduled' | 'published' | 'draft'>('all');

  const [caption, setCaption] = useState('');
  const [mediaUrls, setMediaUrls] = useState<Array<{ url: string; mediaType: 'image' | 'video' }>>(
    []
  );
  const [selectedTargets, setSelectedTargets] = useState<Set<TargetKey>>(new Set());
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleValue);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasAccounts = accounts.length > 0;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const statusMap: Record<typeof filter, string | undefined> = {
        all: undefined,
        scheduled: 'scheduled',
        published: 'published,partial',
        draft: 'draft,failed,cancelled',
      };
      const [accountsRes, listRes] = await Promise.all([
        apiService.getOfficialContentAccounts(),
        apiService.listOfficialContentPublications({
          status: statusMap[filter],
          limit: 40,
        }),
      ]);
      setPageLinked(true);
      setAccounts(accountsRes.accounts || []);
      setPublications(listRes.publications || []);
      setTotal(listRes.total || 0);

      setSelectedTargets((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set<TargetKey>();
        for (const a of accountsRes.accounts || []) {
          next.add(accountKey(a.platform, a.accountRef));
        }
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذّر تحميل بيانات النشر';
      const status = (error as Error & { status?: number }).status;
      if (status === 400 || /اربط صفحة/i.test(message)) {
        setPageLinked(false);
        setAccounts([]);
        setPublications([]);
      } else {
        notifyRef.current(message, 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleTarget = (platform: ContentPlatform, accountRef: string) => {
    const key = accountKey(platform, accountRef);
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const list = Array.from(files).slice(0, 10 - mediaUrls.length);
      const uploaded: Array<{ url: string; mediaType: 'image' | 'video' }> = [];
      for (const file of list) {
        const invalid = validatePublishFile(file);
        if (invalid) {
          notifyRef.current(invalid, 'error');
          continue;
        }
        const isVideo = isVideoFile(file);
        const result = await apiService.uploadFile(file);
        uploaded.push({
          url: result.file.url,
          mediaType: isVideo ? 'video' : 'image',
        });
      }
      if (!uploaded.length) {
        notifyRef.current('لم يتم رفع أي ملف صالح', 'warning');
        return;
      }
      setMediaUrls((prev) => [...prev, ...uploaded].slice(0, 10));
      notifyRef.current('تم رفع الوسائط', 'success');
    } catch (error) {
      notifyRef.current(error instanceof Error ? error.message : 'فشل رفع الملف', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const resetComposer = () => {
    setCaption('');
    setMediaUrls([]);
    setScheduleMode('now');
    setScheduledAt(defaultScheduleValue());
  };

  const submitPublication = async () => {
    if (!selectedTargets.size) {
      notifyRef.current('اختر حساباً واحداً على الأقل', 'warning');
      return;
    }
    const selectedAccounts = accounts.filter((a) =>
      selectedTargets.has(accountKey(a.platform, a.accountRef))
    );
    const hasFacebook = selectedAccounts.some((a) => a.platform === 'facebook');
    const videoCount = mediaUrls.filter((m) => m.mediaType === 'video').length;
    if (hasFacebook && mediaUrls.length > 1 && videoCount > 0) {
      notifyRef.current('فيسبوك يدعم فيديو واحد لكل منشور، أو كاروسيل صور فقط', 'warning');
      return;
    }
    setSaving(true);
    try {
      const targets = accounts
        .filter((a) => selectedTargets.has(accountKey(a.platform, a.accountRef)))
        .map((a) => ({
          platform: a.platform,
          accountRef: a.accountRef,
          accountLabel: a.accountLabel,
        }));

      const result = await apiService.createOfficialContentPublication({
        caption: caption.trim() || null,
        media: mediaUrls.map((m, index) => ({
          mediaUrl: m.url,
          mediaType: m.mediaType,
          sortOrder: index,
        })),
        targets,
        publishNow: scheduleMode === 'now',
        scheduledAt: scheduleMode === 'later' ? new Date(scheduledAt).toISOString() : null,
      });
      notifyRef.current(result.message || 'تم بنجاح', 'success');
      resetComposer();
      await loadData();
    } catch (error) {
      notifyRef.current(error instanceof Error ? error.message : 'فشل إنشاء المنشور', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('حذف هذا المنشور؟')) return;
    try {
      await apiService.deleteOfficialContentPublication(id);
      notifyRef.current('تم الحذف', 'success');
      await loadData();
    } catch (error) {
      notifyRef.current(error instanceof Error ? error.message : 'فشل الحذف', 'error');
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await apiService.cancelOfficialContentPublication(id);
      notifyRef.current('تم إلغاء الجدولة', 'success');
      await loadData();
    } catch (error) {
      notifyRef.current(error instanceof Error ? error.message : 'فشل الإلغاء', 'error');
    }
  };

  const handlePublishNow = async (id: string) => {
    try {
      const result = await apiService.publishOfficialContentPublicationNow(id);
      notifyRef.current(result.message || 'تم النشر', 'success');
      await loadData();
    } catch (error) {
      notifyRef.current(error instanceof Error ? error.message : 'فشل النشر', 'error');
    }
  };

  const captionLimitHint = useMemo(() => {
    const hasIg = accounts.some(
      (a) =>
        a.platform === 'instagram' && selectedTargets.has(accountKey(a.platform, a.accountRef))
    );
    const limit = hasIg ? 2200 : 63206;
    return `${caption.length.toLocaleString('ar')} / ${limit.toLocaleString('ar')}`;
  }, [accounts, caption.length, selectedTargets]);

  if (loading && !accounts.length && !publications.length && pageLinked) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-slate-400 text-sm gap-2">
        <Loader2 className="animate-spin" size={18} />
        جاري التحميل…
      </div>
    );
  }

  if (!pageLinked) {
    return (
      <div className="space-y-4">
        <header>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Megaphone className="text-indigo-400" size={28} />
            نشر محتوى صفحة XO Bot
          </h2>
          <p className="text-slate-400 text-sm mt-2">
            جدولة ونشر منشورات على الصفحة الرسمية — معزولة تماماً عن بيانات التجار.
          </p>
        </header>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 space-y-3">
          <p className="text-amber-100 font-medium">لم تُربط صفحة فيسبوك الرسمية بعد.</p>
          <p className="text-sm text-slate-400">
            اربط الصفحة أولاً من الإعدادات العامة (قسم بوت صفحة XO Bot)، ثم عد هنا لإنشاء المنشورات
            وجدولتها. لحساب إنستغرام المربوط بالصفحة أعد الربط لتفعيل صلاحية النشر.
          </p>
          <Link
            to={adminPath(AdminView.SETTINGS)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold"
          >
            فتح الإعدادات العامة
            <ExternalLink size={14} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Megaphone className="text-indigo-400" size={26} />
            نشر وجدولة المحتوى
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            أنشئ منشوراً وانشره فوراً أو جدولّه على صفحة XO Bot الرسمية وحساب إنستغرام المرتبط إن وُجد.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadData()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-700 text-sm text-slate-200 hover:bg-slate-800"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          تحديث
        </button>
      </div>

      {!hasAccounts ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-8 text-center">
          <p className="text-slate-300 font-medium mb-2">لا توجد حسابات قابلة للنشر</p>
          <p className="text-sm text-slate-500">
            تأكد من ربط الصفحة الرسمية من الإعدادات. إنستغرام يظهر تلقائياً إذا كان مربوطاً بالصفحة.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <section className="lg:col-span-3 bg-slate-950 rounded-2xl border border-slate-800 p-5 space-y-5">
            <h3 className="text-sm font-semibold text-white">إنشاء منشور</h3>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">
                الحسابات المستهدفة
              </label>
              <div className="flex flex-wrap gap-2">
                {accounts.map((account) => {
                  const key = accountKey(account.platform, account.accountRef);
                  const active = selectedTargets.has(key);
                  const Icon = account.platform === 'facebook' ? Facebook : Instagram;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleTarget(account.platform, account.accountRef)}
                      className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition ${
                        active
                          ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200'
                          : 'border-slate-700 text-slate-300'
                      }`}
                    >
                      <Icon size={15} />
                      <span>{account.accountLabel || account.accountRef}</span>
                      {active && <Check size={14} />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-slate-400">نص المنشور</label>
                <span className="text-[11px] text-slate-500">{captionLimitHint}</span>
              </div>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={5}
                placeholder="اكتب محتوى المنشور…"
                className="w-full rounded-xl border border-slate-700 bg-slate-900 text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">
                الوسائط (حتى 10)
              </label>
              <div className="flex flex-wrap gap-3">
                {mediaUrls.map((item, index) => (
                  <div
                    key={`${item.url}-${index}`}
                    className="relative w-24 h-24 rounded-xl overflow-hidden bg-slate-800 border border-slate-700"
                  >
                    {item.mediaType === 'video' ? (
                      <video src={item.url} className="w-full h-full object-cover" />
                    ) : (
                      <img src={item.url} alt="" className="w-full h-full object-cover" />
                    )}
                    <button
                      type="button"
                      onClick={() => setMediaUrls((prev) => prev.filter((_, i) => i !== index))}
                      className="absolute top-1 left-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                      aria-label="إزالة"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {mediaUrls.length < 10 && (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-24 h-24 rounded-xl border border-dashed border-slate-600 flex flex-col items-center justify-center gap-1 text-slate-400 hover:border-indigo-400 hover:text-indigo-300 text-xs"
                  >
                    {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                    رفع
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={`${IMAGE_ACCEPT},${VIDEO_ACCEPT}`}
                multiple
                className="hidden"
                onChange={(e) => handleUpload(e.target.files)}
              />
              <p className="mt-2 text-[11px] text-slate-500">
                صور JPEG/PNG/WebP حتى 10 ميجابايت، وفيديو MP4 أو MOV حتى 100 ميجابايت. فيسبوك: فيديو
                واحد أو كاروسيل صور. إنستغرام: صورة، ريلز، أو كاروسيل.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setScheduleMode('now')}
                className={`flex items-center gap-2 px-3 py-3 rounded-xl border text-sm ${
                  scheduleMode === 'now'
                    ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200'
                    : 'border-slate-700 text-slate-300'
                }`}
              >
                <Send size={16} />
                نشر الآن
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode('later')}
                className={`flex items-center gap-2 px-3 py-3 rounded-xl border text-sm ${
                  scheduleMode === 'later'
                    ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200'
                    : 'border-slate-700 text-slate-300'
                }`}
              >
                <CalendarClock size={16} />
                جدولة لاحقاً
              </button>
            </div>

            {scheduleMode === 'later' && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">وقت النشر</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 text-white px-3 py-2.5 text-sm"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={resetComposer}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl text-sm text-slate-300 hover:bg-slate-800"
              >
                مسح
              </button>
              <button
                type="button"
                disabled={saving || uploading}
                onClick={submitPublication}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : scheduleMode === 'now' ? (
                  <Upload size={16} />
                ) : (
                  <Clock3 size={16} />
                )}
                {scheduleMode === 'now' ? 'نشر الآن' : 'جدولة المنشور'}
              </button>
            </div>
          </section>

          <section className="lg:col-span-2 space-y-4">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['all', 'الكل'],
                  ['scheduled', 'مجدول'],
                  ['published', 'منشور'],
                  ['draft', 'مسودات'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                    filter === key
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="text-xs text-slate-500">{total.toLocaleString('ar')} منشوراً</div>

            <div className="space-y-3">
              {publications.length === 0 && (
                <div className="bg-slate-950 rounded-2xl border border-slate-800 p-6 text-center text-sm text-slate-400">
                  لا توجد منشورات في هذا التصفية بعد.
                </div>
              )}

              {publications.map((pub) => {
                const thumb = pub.media[0]?.thumbnailUrl || pub.media[0]?.mediaUrl;
                return (
                  <article
                    key={pub.id}
                    className="bg-slate-950 rounded-2xl border border-slate-800 p-4"
                  >
                    <div className="flex gap-3">
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-800 flex-shrink-0 flex items-center justify-center text-slate-500">
                        {thumb ? (
                          <img src={thumb} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Megaphone size={18} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-white line-clamp-2">
                            {pub.caption?.trim() || 'منشور بدون نص'}
                          </p>
                          <span
                            className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[pub.status]}`}
                          >
                            {STATUS_LABEL[pub.status]}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {pub.targets.map((t) => {
                            const Icon = t.platform === 'facebook' ? Facebook : Instagram;
                            return (
                              <span
                                key={`${t.platform}-${t.accountRef}`}
                                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-slate-900 text-slate-300"
                              >
                                <Icon size={10} />
                                {t.accountLabel || t.accountRef}
                              </span>
                            );
                          })}
                        </div>
                        <p className="mt-1.5 text-[11px] text-slate-500">
                          {pub.status === 'scheduled'
                            ? `مجدول: ${formatDate(pub.scheduledAt)}`
                            : pub.publishedAt
                              ? `نُشر: ${formatDate(pub.publishedAt)}`
                              : `أُنشئ: ${formatDate(pub.createdAt)}`}
                        </p>
                        {pub.errorSummary && (
                          <p className="mt-1 text-[11px] text-red-400 line-clamp-2">
                            {pub.errorSummary}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {pub.status === 'scheduled' && (
                            <button
                              type="button"
                              onClick={() => handleCancel(pub.id)}
                              className="text-[11px] text-amber-300 hover:underline"
                            >
                              إلغاء الجدولة
                            </button>
                          )}
                          {(pub.status === 'draft' ||
                            pub.status === 'failed' ||
                            pub.status === 'cancelled') && (
                            <button
                              type="button"
                              onClick={() => handlePublishNow(pub.id)}
                              className="text-[11px] text-indigo-300 hover:underline"
                            >
                              نشر الآن
                            </button>
                          )}
                          {pub.targets.some((t) => t.permalink) && (
                            <a
                              href={pub.targets.find((t) => t.permalink)?.permalink || '#'}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-slate-400 hover:underline"
                            >
                              فتح المنشور
                            </a>
                          )}
                          {pub.status !== 'publishing' && (
                            <button
                              type="button"
                              onClick={() => handleDelete(pub.id)}
                              className="inline-flex items-center gap-1 text-[11px] text-red-400 hover:underline"
                            >
                              <Trash2 size={11} />
                              حذف
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default AdminContentPublishing;
