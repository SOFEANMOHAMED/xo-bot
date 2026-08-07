import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  Check,
  Clock3,
  Facebook,
  ImagePlus,
  Instagram,
  Link2,
  Loader2,
  Megaphone,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { apiService } from '../services/api';
import type {
  ContentPlatform,
  ContentPublication,
  ContentPublishAccount,
  PublicationStatus
} from '../types/contentPublishing';

interface ContentPublishingPageProps {
  showNotification?: (
    message: string,
    type: 'success' | 'error' | 'info' | 'warning',
    duration?: number
  ) => void;
  onGoToIntegrations?: () => void;
}

type TargetKey = `${ContentPlatform}:${string}`;

const STATUS_LABEL: Record<PublicationStatus, string> = {
  draft: 'مسودة',
  scheduled: 'مجدول',
  publishing: 'جاري النشر',
  published: 'منشور',
  partial: 'منشور جزئياً',
  failed: 'فشل',
  cancelled: 'ملغى'
};

const STATUS_STYLE: Record<PublicationStatus, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  scheduled: 'bg-amber-50 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  publishing: 'bg-blue-50 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  published: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  partial: 'bg-orange-50 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  failed: 'bg-red-50 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
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
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function accountKey(platform: ContentPlatform, accountRef: string): TargetKey {
  return `${platform}:${accountRef}`;
}

const ContentPublishingPage: React.FC<ContentPublishingPageProps> = ({
  showNotification,
  onGoToIntegrations
}) => {
  const notifyRef = useRef(showNotification);
  notifyRef.current = showNotification;

  const [loading, setLoading] = useState(true);
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
        draft: 'draft,failed,cancelled'
      };
      const [accountsRes, listRes] = await Promise.all([
        apiService.getContentPublishAccounts(),
        apiService.listContentPublications({
          status: statusMap[filter],
          limit: 40
        })
      ]);
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
      notifyRef.current?.(
        error instanceof Error ? error.message : 'تعذّر تحميل بيانات النشر',
        'error'
      );
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
        const isVideo = file.type.startsWith('video/');
        const result = await apiService.uploadFile(file);
        uploaded.push({
          url: result.file.url,
          mediaType: isVideo ? 'video' : 'image'
        });
      }
      setMediaUrls((prev) => [...prev, ...uploaded].slice(0, 10));
      notifyRef.current?.('تم رفع الوسائط', 'success');
    } catch (error) {
      notifyRef.current?.(
        error instanceof Error ? error.message : 'فشل رفع الملف',
        'error'
      );
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
      notifyRef.current?.('اختر حساباً واحداً على الأقل', 'warning');
      return;
    }
    setSaving(true);
    try {
      const targets = accounts
        .filter((a) => selectedTargets.has(accountKey(a.platform, a.accountRef)))
        .map((a) => ({
          platform: a.platform,
          accountRef: a.accountRef,
          accountLabel: a.accountLabel
        }));

      const payload = {
        caption: caption.trim() || null,
        media: mediaUrls.map((m, index) => ({
          mediaUrl: m.url,
          mediaType: m.mediaType,
          sortOrder: index
        })),
        targets,
        publishNow: scheduleMode === 'now',
        scheduledAt:
          scheduleMode === 'later' ? new Date(scheduledAt).toISOString() : null
      };

      const result = await apiService.createContentPublication(payload);
      notifyRef.current?.(result.message || 'تم بنجاح', 'success');
      resetComposer();
      await loadData();
    } catch (error) {
      notifyRef.current?.(
        error instanceof Error ? error.message : 'فشل إنشاء المنشور',
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('حذف هذا المنشور؟')) return;
    try {
      await apiService.deleteContentPublication(id);
      notifyRef.current?.('تم الحذف', 'success');
      await loadData();
    } catch (error) {
      notifyRef.current?.(
        error instanceof Error ? error.message : 'فشل الحذف',
        'error'
      );
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await apiService.cancelContentPublication(id);
      notifyRef.current?.('تم إلغاء الجدولة', 'success');
      await loadData();
    } catch (error) {
      notifyRef.current?.(
        error instanceof Error ? error.message : 'فشل الإلغاء',
        'error'
      );
    }
  };

  const handlePublishNow = async (id: string) => {
    try {
      const result = await apiService.publishContentPublicationNow(id);
      notifyRef.current?.(result.message || 'تم النشر', 'success');
      await loadData();
    } catch (error) {
      notifyRef.current?.(
        error instanceof Error ? error.message : 'فشل النشر',
        'error'
      );
    }
  };

  const captionLimitHint = useMemo(() => {
    const hasIg = accounts.some(
      (a) =>
        a.platform === 'instagram' &&
        selectedTargets.has(accountKey(a.platform, a.accountRef))
    );
    const limit = hasIg ? 2200 : 63206;
    return `${caption.length.toLocaleString('ar')} / ${limit.toLocaleString('ar')}`;
  }, [accounts, caption.length, selectedTargets]);

  if (loading && !accounts.length && !publications.length) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-gray-500 dark:text-gray-400 text-sm gap-2">
        <Loader2 className="animate-spin" size={18} />
        جاري التحميل…
      </div>
    );
  }

  if (!hasAccounts) {
    return (
      <div className="max-w-xl mx-auto mt-10 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-8 text-center shadow-sm">
        <div className="mx-auto w-12 h-12 rounded-xl bg-brand-50 dark:bg-brand-900/40 text-brand flex items-center justify-center mb-4">
          <Link2 size={22} />
        </div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
          نشر المحتوى على فيسبوك وإنستغرام
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          اربط صفحة فيسبوك أو حساب إنستغرام للأعمال من «الربط والتكامل» أولاً.
          لحسابات إنستغرام الحالية أعد الربط لتفعيل صلاحية نشر المحتوى.
        </p>
        {onGoToIntegrations && (
          <button
            type="button"
            onClick={onGoToIntegrations}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-700 text-white text-sm font-medium"
          >
            <Link2 size={16} />
            الذهاب للربط والتكامل
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Megaphone className="text-brand" size={22} />
            نشر وجدولة المحتوى
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            أنشئ منشوراً وانشره فوراً أو جدولّه على صفحات فيسبوك وحسابات إنستغرام المرتبطة.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadData()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          تحديث
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Composer */}
        <section className="lg:col-span-3 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 shadow-sm space-y-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">إنشاء منشور</h2>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
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
                        ? 'border-brand bg-brand-50 text-brand dark:bg-brand-900/30 dark:border-brand'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
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
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                نص المنشور
              </label>
              <span className="text-[11px] text-gray-400">{captionLimitHint}</span>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={5}
              placeholder="اكتب محتوى المنشور…"
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              الوسائط (حتى 10)
            </label>
            <div className="flex flex-wrap gap-3">
              {mediaUrls.map((item, index) => (
                <div
                  key={`${item.url}-${index}`}
                  className="relative w-24 h-24 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600"
                >
                  {item.mediaType === 'video' ? (
                    <video src={item.url} className="w-full h-full object-cover" />
                  ) : (
                    <img src={item.url} alt="" className="w-full h-full object-cover" />
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setMediaUrls((prev) => prev.filter((_, i) => i !== index))
                    }
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
                  className="w-24 h-24 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center gap-1 text-gray-500 dark:text-gray-400 hover:border-brand hover:text-brand text-xs"
                >
                  {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                  رفع
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <p className="mt-2 text-[11px] text-gray-400">
              يجب أن تكون الروابط عامة عبر HTTPS — الرفع يتم إلى مساحة التاجر المعزولة.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setScheduleMode('now')}
              className={`flex items-center gap-2 px-3 py-3 rounded-xl border text-sm ${
                scheduleMode === 'now'
                  ? 'border-brand bg-brand-50 text-brand dark:bg-brand-900/30'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
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
                  ? 'border-brand bg-brand-50 text-brand dark:bg-brand-900/30'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              <CalendarClock size={16} />
              جدولة لاحقاً
            </button>
          </div>

          {scheduleMode === 'later' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                وقت النشر
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2.5 text-sm"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={resetComposer}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              مسح
            </button>
            <button
              type="button"
              disabled={saving || uploading}
              onClick={submitPublication}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-60"
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

        {/* Queue / history */}
        <section className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['all', 'الكل'],
                ['scheduled', 'مجدول'],
                ['published', 'منشور'],
                ['draft', 'مسودات']
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  filter === key
                    ? 'bg-brand text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="text-xs text-gray-400">{total.toLocaleString('ar')} منشوراً</div>

          <div className="space-y-3">
            {publications.length === 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
                لا توجد منشورات في هذا التصفية بعد.
              </div>
            )}

            {publications.map((pub) => {
              const thumb = pub.media[0]?.thumbnailUrl || pub.media[0]?.mediaUrl;
              return (
                <article
                  key={pub.id}
                  className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm"
                >
                  <div className="flex gap-3">
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-700 flex-shrink-0 flex items-center justify-center text-gray-400">
                      {thumb ? (
                        <img src={thumb} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Megaphone size={18} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-gray-900 dark:text-white line-clamp-2">
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
                              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300"
                            >
                              <Icon size={10} />
                              {t.accountLabel || t.accountRef}
                            </span>
                          );
                        })}
                      </div>
                      <p className="mt-1.5 text-[11px] text-gray-400">
                        {pub.status === 'scheduled'
                          ? `مجدول: ${formatDate(pub.scheduledAt)}`
                          : pub.publishedAt
                            ? `نُشر: ${formatDate(pub.publishedAt)}`
                            : `أُنشئ: ${formatDate(pub.createdAt)}`}
                      </p>
                      {pub.errorSummary && (
                        <p className="mt-1 text-[11px] text-red-500 line-clamp-2">
                          {pub.errorSummary}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {pub.status === 'scheduled' && (
                          <button
                            type="button"
                            onClick={() => handleCancel(pub.id)}
                            className="text-[11px] text-amber-700 dark:text-amber-300 hover:underline"
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
                            className="text-[11px] text-brand hover:underline"
                          >
                            نشر الآن
                          </button>
                        )}
                        {pub.targets.some((t) => t.permalink) && (
                          <a
                            href={pub.targets.find((t) => t.permalink)?.permalink || '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-gray-500 hover:underline"
                          >
                            فتح المنشور
                          </a>
                        )}
                        {pub.status !== 'publishing' && (
                          <button
                            type="button"
                            onClick={() => handleDelete(pub.id)}
                            className="inline-flex items-center gap-1 text-[11px] text-red-500 hover:underline"
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
    </div>
  );
};

export default ContentPublishingPage;
