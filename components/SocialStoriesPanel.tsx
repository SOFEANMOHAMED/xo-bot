import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Link as LinkIcon, Image as ImageIcon, Clock } from 'lucide-react';
import { apiService } from '../services/api';

type Platform = 'facebook' | 'instagram';

interface SocialStoriesPanelProps {
  facebookConnected: boolean;
  instagramConnected: boolean;
  showNotification?: (message: string, type: 'success' | 'error' | 'info') => void;
}

type StoryRow = {
  id: string;
  platform: Platform;
  external_post_id: string;
  caption?: string | null;
  thumbnail_url?: string | null;
  posted_at?: string | null;
  expires_at?: string | null;
  synced_at?: string | null;
  media_type?: string | null;
  linked_product_id?: string | null;
  linked_product_name?: string | null;
  is_live?: boolean;
};

function remainingLabel(story: StoryRow): string {
  if (story.is_live === false) return 'انتهى';
  const exp = story.expires_at ? new Date(story.expires_at).getTime() : NaN;
  if (!Number.isFinite(exp)) return story.is_live ? 'نشط' : 'انتهى';
  const ms = exp - Date.now();
  if (ms <= 0) return 'انتهى';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}س ${m}د متبقية`;
  return `${Math.max(1, m)}د متبقية`;
}

const StoryThumb: React.FC<{ storyId: string; cacheKey?: string | null }> = ({
  storyId,
  cacheKey
}) => {
  const [failed, setFailed] = useState(false);
  const src = apiService.socialPostThumbnailUrl(storyId, cacheKey);
  if (failed) {
    return (
      <div className="w-full aspect-[9/16] bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400">
        <ImageIcon size={28} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="w-full aspect-[9/16] object-cover bg-gray-100 dark:bg-gray-700"
    />
  );
};

const SocialStoriesPanel: React.FC<SocialStoriesPanelProps> = ({
  facebookConnected,
  instagramConnected,
  showNotification
}) => {
  const [platform, setPlatform] = useState<Platform>(instagramConnected ? 'instagram' : 'facebook');
  const [stories, setStories] = useState<StoryRow[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [draftProduct, setDraftProduct] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const notifyRef = useRef(showNotification);
  notifyRef.current = showNotification;

  const loadData = useCallback(async () => {
    if (!facebookConnected && !instagramConnected) return;
    setLoading(true);
    try {
      const [storiesRes, productsRes] = await Promise.all([
        apiService.getSocialPosts({ platform, contentKind: 'story', limit: 40 }),
        apiService.getProducts()
      ]);
      const next = (storiesRes.posts || []) as StoryRow[];
      setStories(next);
      setProducts((productsRes.products || []).map((p) => ({ id: p.id, name: p.name })));
      const drafts: Record<string, string> = {};
      for (const s of next) drafts[s.id] = s.linked_product_id || '';
      setDraftProduct(drafts);
    } catch (e: any) {
      notifyRef.current?.(e?.message || 'فشل تحميل الستوري', 'error');
    } finally {
      setLoading(false);
    }
  }, [platform, facebookConnected, instagramConnected]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await apiService.syncSocialStories(platform);
      const total = (res.results || []).reduce((s, r) => s + (r.synced || 0), 0);
      const pruned = (res.results || []).reduce((s, r) => s + (r.pruned || 0), 0);
      notifyRef.current?.(
        pruned > 0
          ? total > 0
            ? `تمت مزامنة ${total} ستوري وحذف ${pruned} لم يعد على الصفحة`
            : `تم حذف ${pruned} ستوري لم يعد على الصفحة`
          : total > 0
            ? `تمت مزامنة ${total} ستوري`
            : 'لا يوجد ستوري نشط حالياً',
        'success'
      );
      await loadData();
    } catch (e: any) {
      notifyRef.current?.(e?.message || 'فشلت مزامنة الستوري', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async (storyId: string) => {
    setSavingId(storyId);
    try {
      await apiService.linkSocialPostProduct(storyId, draftProduct[storyId] || null);
      notifyRef.current?.('تم حفظ ربط المنتج بالستوري', 'success');
      await loadData();
    } catch (e: any) {
      notifyRef.current?.(e?.message || 'فشل حفظ الربط', 'error');
    } finally {
      setSavingId('');
    }
  };

  const liveCount = useMemo(() => stories.filter((s) => s.is_live !== false).length, [stories]);

  if (!facebookConnected && !instagramConnected) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-pink-100 dark:border-pink-900/40 overflow-hidden">
      <div className="p-5 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-l from-white to-pink-50/60 dark:from-gray-800 dark:to-pink-900/20">
        <h3 className="font-bold text-gray-900 dark:text-white text-lg">ربط الستوري بمنتج</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          عندما يرد عميل على ستوري مربوط، يعرف البوت المنتج ويبدأ الحديث عنه بدقة. الربط مستحسن وليس إلزامياً.
        </p>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex gap-2">
            {instagramConnected && (
              <button
                type="button"
                onClick={() => setPlatform('instagram')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  platform === 'instagram'
                    ? 'bg-pink-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                }`}
              >
                إنستغرام
              </button>
            )}
            {facebookConnected && (
              <button
                type="button"
                onClick={() => setPlatform('facebook')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  platform === 'facebook'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                }`}
              >
                فيسبوك
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-700 text-white text-sm disabled:opacity-60"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'جاري المزامنة…' : 'مزامنة الستوري'}
          </button>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <Clock size={12} />
          {loading
            ? 'تحميل…'
            : stories.length === 0
              ? 'لا يوجد ستوري على الصفحة. انشر ستوري ثم اضغط مزامنة.'
              : `${liveCount} ستوري نشط`}
        </div>

        {stories.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {stories.map((story) => {
              const live = story.is_live !== false;
              return (
                <div
                  key={story.id}
                  className={`rounded-xl border overflow-hidden bg-white dark:bg-gray-900 ${
                    live
                      ? 'border-pink-200 dark:border-pink-900/50'
                      : 'border-gray-200 dark:border-gray-700 opacity-80'
                  }`}
                >
                  <div className="relative">
                    <StoryThumb
                      key={`${story.id}:${story.synced_at || ''}`}
                      storyId={story.id}
                      cacheKey={story.synced_at}
                    />
                    <span
                      className={`absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        live
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-700 text-gray-100'
                      }`}
                    >
                      {remainingLabel(story)}
                    </span>
                  </div>
                  <div className="p-2.5 space-y-2">
                    {story.linked_product_name && (
                      <p className="text-[11px] text-blue-700 dark:text-blue-300 truncate">
                        {story.linked_product_name}
                      </p>
                    )}
                    <select
                      value={draftProduct[story.id] || ''}
                      onChange={(e) =>
                        setDraftProduct((prev) => ({ ...prev, [story.id]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs"
                    >
                      <option value="">— بدون ربط —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleSave(story.id)}
                      disabled={savingId === story.id}
                      className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-brand hover:bg-brand-700 text-white text-xs disabled:opacity-60"
                    >
                      <LinkIcon size={12} />
                      {savingId === story.id ? 'حفظ…' : 'حفظ الربط'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SocialStoriesPanel;
