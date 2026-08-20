/**
 * Admin: Official XO Bot Facebook page comment automation.
 * Mirrors merchant SocialAutomationPanel (per-post) but platform-scoped — no products/CRM.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw,
  Plus,
  Trash2,
  Pencil,
  X,
  ChevronDown,
  Search,
  Image as ImageIcon,
  Check,
  MessageSquareText,
  ExternalLink,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import apiService from '../../services/api';
import { useAdminNotifications } from './AdminNotificationContext';
import { adminPath } from '../../routes/paths';
import { AdminView } from '../../types';
import {
  COMMENT_PUBLIC_REPLY_PRESETS,
  COMMENT_DM_AFTER_PRESETS,
} from '../../constants/commentReplyPresets';

/** Presets tuned for the official XO Bot page (signup / product education). */
const PLATFORM_PUBLIC_PRESETS = [
  ...COMMENT_PUBLIC_REPLY_PRESETS,
  {
    id: 'xo_trial',
    label: 'تجربة مجانية',
    body: 'شكراً لاهتمامك بـ Xo Bot! 🚀 جرّب المنصة مجاناً 7 أيام من xo-bot.com/signup — بوت مبيعات عربي لواتساب وفيسبوك وإنستغرام وتيليجرام.',
  },
  {
    id: 'xo_dm_help',
    label: 'توجيه للخاص',
    body: 'أهلاً بك! راسلنا في الخاص وسنشرح لك كيف Xo Bot يرد ويبيع عن متجرك خطوة بخطوة.',
  },
];

const PLATFORM_DM_PRESETS = [
  ...COMMENT_DM_AFTER_PRESETS,
  {
    id: 'xo_welcome',
    label: 'ترحيب Xo Bot',
    body: 'مرحباً {{name}}! أنا مساعد Xo Bot الرسمي. أقدر أشرح لك الباقات وطريقة الربط. وش تبيع حالياً وعلى أي قناة؟\nابدأ التجربة: https://xo-bot.com/signup',
  },
];

const emptyPostSettings = {
  commentReplyEnabled: false,
  publicReplyText: '',
  sendDmOnComment: false,
  privateReplyText: '',
};

const postLabel = (p: any) => {
  const caption = String(p?.caption || '').trim();
  if (caption) return caption;
  return p?.external_post_id ? `منشور ${p.external_post_id}` : 'منشور بدون نص';
};

const PostThumbnail: React.FC<{ url?: string | null; size?: 'sm' | 'md' }> = ({
  url,
  size = 'sm',
}) => {
  const dim = size === 'md' ? 'w-14 h-14' : 'w-10 h-10';
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={`${dim} rounded-lg object-cover flex-shrink-0 bg-slate-800`}
      />
    );
  }
  return (
    <div
      className={`${dim} rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-500`}
    >
      <ImageIcon size={size === 'md' ? 22 : 16} />
    </div>
  );
};

const AdminOfficialPageComments: React.FC = () => {
  const { showSuccess, showError } = useAdminNotifications();
  const [pageLinked, setPageLinked] = useState(false);
  const [pageName, setPageName] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string>('');
  const [statusLoading, setStatusLoading] = useState(true);

  const [posts, setPosts] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState('');
  const [postSettings, setPostSettings] = useState(emptyPostSettings);
  const [presetNonce, setPresetNonce] = useState({ reply: 0, dm: 0 });
  const [postPickerOpen, setPostPickerOpen] = useState(false);
  const [postSearch, setPostSearch] = useState('');
  const [ruleForm, setRuleForm] = useState({
    keywords: '',
    publicReplyText: '',
    privateReplyText: '',
    privateReplyEnabled: false,
    priority: 100,
  });
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const postPickerRef = useRef<HTMLDivElement>(null);
  const postSearchRef = useRef<HTMLInputElement>(null);
  const selectedPostIdRef = useRef(selectedPostId);
  selectedPostIdRef.current = selectedPostId;

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const status = await apiService.getOfficialFacebookStatus();
      setPageLinked(!!status.linked);
      setPageName(status.page?.pageName || null);
      setPageId(status.page?.pageId || '');
    } catch (e: any) {
      showError(e?.message || 'فشل تحميل حالة الصفحة');
      setPageLinked(false);
    } finally {
      setStatusLoading(false);
    }
  }, [showError]);

  const loadData = useCallback(
    async (opts?: { preserveSelection?: boolean }) => {
      if (!pageLinked) return;
      setLoading(true);
      try {
        const res = await apiService.getOfficialPagePosts({ limit: 50 });
        const nextPosts = res.posts || [];
        setPosts(nextPosts);

        const keepId = opts?.preserveSelection ? selectedPostIdRef.current : '';
        if (keepId) {
          const selected = nextPosts.find((p: any) => p.id === keepId);
          if (selected) {
            setPostSettings({
              commentReplyEnabled: !!selected.comment_reply_enabled,
              publicReplyText: selected.public_reply_text || '',
              sendDmOnComment: !!selected.send_dm_on_comment,
              privateReplyText: selected.private_reply_text || '',
            });
          }
        }
      } catch (e: any) {
        showError(e?.message || 'فشل تحميل المنشورات');
      } finally {
        setLoading(false);
      }
    },
    [pageLinked, showError]
  );

  const loadRulesForPost = useCallback(
    async (postId: string) => {
      if (!postId) {
        setRules([]);
        return;
      }
      try {
        const rulesRes = await apiService.getOfficialPageKeywordRules(postId);
        setRules(rulesRes.rules || []);
      } catch {
        setRules([]);
      }
    },
    []
  );

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (pageLinked) {
      setSelectedPostId('');
      setPostSettings(emptyPostSettings);
      setRules([]);
      loadData();
    }
  }, [pageLinked, loadData]);

  useEffect(() => {
    if (!postPickerOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (postPickerRef.current && !postPickerRef.current.contains(e.target as Node)) {
        setPostPickerOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPostPickerOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    const canHover =
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    let t: number | undefined;
    if (canHover) t = window.setTimeout(() => postSearchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      if (t !== undefined) window.clearTimeout(t);
    };
  }, [postPickerOpen]);

  const selectedPost = useMemo(
    () => posts.find((p) => p.id === selectedPostId) || null,
    [posts, selectedPostId]
  );

  const filteredPosts = useMemo(() => {
    const q = postSearch.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter((p) => {
      const hay = `${p.caption || ''} ${p.external_post_id || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [posts, postSearch]);

  const resetRuleForm = () => {
    setEditingRuleId(null);
    setRuleForm({
      keywords: '',
      publicReplyText: '',
      privateReplyText: '',
      privateReplyEnabled: false,
      priority: 100,
    });
  };

  const selectPost = (p: any) => {
    setSelectedPostId(p.id);
    setPostSettings({
      commentReplyEnabled: !!p.comment_reply_enabled,
      publicReplyText: p.public_reply_text || '',
      sendDmOnComment: !!p.send_dm_on_comment,
      privateReplyText: p.private_reply_text || '',
    });
    resetRuleForm();
    loadRulesForPost(p.id);
    setPostPickerOpen(false);
    setPostSearch('');
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await apiService.syncOfficialPagePosts();
      const total = (res.results || []).reduce((s, r) => s + (r.synced || 0), 0);
      showSuccess(`تمت مزامنة ${total} منشوراً`);
      await loadData({ preserveSelection: true });
    } catch (e: any) {
      showError(e?.message || 'فشلت المزامنة');
    } finally {
      setSyncing(false);
    }
  };

  const handleSavePostSettings = async () => {
    if (!selectedPostId) {
      showError('اختر منشوراً أولاً');
      return;
    }
    setSaving(true);
    try {
      await apiService.updateOfficialPagePostCommentSettings({
        socialPostId: selectedPostId,
        commentReplyEnabled: postSettings.commentReplyEnabled,
        publicReplyText: postSettings.publicReplyText,
        sendDmOnComment: postSettings.sendDmOnComment,
        privateReplyText: postSettings.privateReplyText,
      });
      showSuccess('تم حفظ إعدادات المنشور');
      await loadData({ preserveSelection: true });
    } catch (e: any) {
      showError(e?.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleEditRule = (r: any) => {
    setEditingRuleId(r.id);
    setRuleForm({
      keywords: Array.isArray(r.keywords) ? r.keywords.join('، ') : String(r.keywords || ''),
      publicReplyText: r.public_reply_text || '',
      privateReplyText: r.private_reply_text || '',
      privateReplyEnabled: !!r.private_reply_enabled,
      priority: Number.isFinite(Number(r.priority)) ? Number(r.priority) : 100,
    });
  };

  const handleSaveRule = async () => {
    if (!selectedPostId) {
      showError('اختر منشوراً لإضافة قاعدة');
      return;
    }
    if (!ruleForm.keywords.trim()) {
      showError('أدخل كلمات مفتاحية');
      return;
    }
    try {
      if (editingRuleId) {
        await apiService.updateOfficialPageKeywordRule(editingRuleId, {
          keywords: ruleForm.keywords,
          publicReplyText: ruleForm.publicReplyText,
          privateReplyText: ruleForm.privateReplyText,
          privateReplyEnabled: ruleForm.privateReplyEnabled,
          priority: ruleForm.priority,
        });
        showSuccess('تم تحديث القاعدة');
      } else {
        await apiService.createOfficialPageKeywordRule({
          socialPostId: selectedPostId,
          keywords: ruleForm.keywords,
          publicReplyText: ruleForm.publicReplyText || undefined,
          privateReplyText: ruleForm.privateReplyText || undefined,
          privateReplyEnabled: ruleForm.privateReplyEnabled,
          priority: ruleForm.priority,
        });
        showSuccess('تم إنشاء القاعدة للمنشور');
      }
      resetRuleForm();
      await loadRulesForPost(selectedPostId);
    } catch (e: any) {
      showError(e?.message || (editingRuleId ? 'فشل تحديث القاعدة' : 'فشل إنشاء القاعدة'));
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await apiService.deleteOfficialPageKeywordRule(ruleId);
      if (editingRuleId === ruleId) resetRuleForm();
      showSuccess('تم حذف القاعدة');
      await loadRulesForPost(selectedPostId);
    } catch (e: any) {
      showError(e?.message || 'فشل الحذف');
    }
  };

  if (statusLoading) {
    return (
      <div className="p-6 text-slate-400 flex items-center gap-2">
        <RefreshCw size={16} className="animate-spin" />
        جاري التحميل…
      </div>
    );
  }

  if (!pageLinked) {
    return (
      <div className="p-6 space-y-4">
        <header>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <MessageSquareText className="text-indigo-400" size={28} />
            ردود تعليقات صفحة XO Bot
          </h2>
          <p className="text-slate-400 text-sm mt-2">
            أتمتة الرد العام والرسالة الخاصة على تعليقات منشورات الصفحة الرسمية — معزولة تماماً عن
            بيانات التجار.
          </p>
        </header>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 space-y-3">
          <p className="text-amber-100 font-medium">
            لم تُربط صفحة فيسبوك الرسمية بعد.
          </p>
          <p className="text-sm text-slate-400">
            اربط الصفحة أولاً من الإعدادات العامة (قسم بوت صفحة XO Bot)، ثم عد هنا لمزامنة المنشورات
            وتفعيل الردود.
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
    <div className="p-4 lg:p-6 space-y-5 max-w-6xl">
      <header className="space-y-2">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <MessageSquareText className="text-indigo-400" size={28} />
          ردود تعليقات صفحة XO Bot
        </h2>
        <p className="text-slate-400 text-sm">
          الصفحة:{' '}
          <span className="text-white font-medium">{pageName || pageId}</span>
          {' · '}
          الرد يتم فقط على المنشورات التي تفعّلها. الرسالة الخاصة نص ثابت (بدون AI)، ثم يستمر بوت
          الصفحة في المحادثة إن وُجد.
        </p>
      </header>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 bg-gradient-to-l from-slate-900 to-indigo-950/40 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-white text-lg">إعدادات التعليق لكل منشور</h3>
            <p className="text-xs text-slate-400 mt-1">
              نفس نموذج التاجر — معزول لمنصة XO Bot فقط
            </p>
          </div>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm disabled:opacity-60"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'جاري المزامنة…' : 'مزامنة المنشورات'}
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid lg:grid-cols-2 gap-5">
            {/* Mobile picker */}
            <div className="space-y-2 lg:hidden" ref={postPickerRef}>
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-bold text-slate-200">اختيار المنشور</label>
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  {loading && <span>تحميل…</span>}
                  {!loading && posts.length > 0 && <span>{posts.length} منشور</span>}
                </div>
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    if (posts.length === 0) return;
                    setPostPickerOpen((o) => !o);
                  }}
                  disabled={loading || posts.length === 0}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-right transition disabled:opacity-60 ${
                    postPickerOpen
                      ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-slate-950'
                      : selectedPost
                        ? 'border-indigo-500/40 bg-indigo-950/30'
                        : 'border-slate-700 bg-slate-950'
                  }`}
                >
                  {selectedPost ? (
                    <>
                      <PostThumbnail url={selectedPost.thumbnail_url} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-100 line-clamp-2">
                          {postLabel(selectedPost)}
                        </p>
                        <span
                          className={`inline-flex mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            selectedPost.comment_reply_enabled
                              ? 'bg-emerald-900/50 text-emerald-300'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {selectedPost.comment_reply_enabled ? 'مفعّل للرد' : 'غير مفعّل'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-14 h-14 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500">
                        <ImageIcon size={22} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-300">
                          {posts.length === 0
                            ? 'لا منشورات بعد — اضغط مزامنة'
                            : 'اختر منشوراً لضبط الردود…'}
                        </p>
                      </div>
                    </>
                  )}
                  <ChevronDown
                    size={18}
                    className={`text-slate-500 flex-shrink-0 transition-transform ${
                      postPickerOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {postPickerOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                      aria-hidden
                      onClick={() => setPostPickerOpen(false)}
                    />
                    <div className="fixed z-50 inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] max-h-[min(70dvh,32rem)] rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden flex flex-col">
                      <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-slate-800">
                        <p className="text-sm font-bold text-slate-100">المنشورات</p>
                        <button
                          type="button"
                          onClick={() => setPostPickerOpen(false)}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div className="p-2 border-b border-slate-800">
                        <div className="relative">
                          <Search
                            size={14}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                          />
                          <input
                            ref={postSearchRef}
                            type="search"
                            value={postSearch}
                            onChange={(e) => setPostSearch(e.target.value)}
                            placeholder="بحث في المنشورات…"
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 pr-9 pl-3 py-2.5 text-sm text-slate-100"
                          />
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-y-auto">
                        {filteredPosts.length === 0 ? (
                          <p className="text-xs text-slate-500 p-4 text-center">لا نتائج</p>
                        ) : (
                          filteredPosts.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => selectPost(p)}
                              className={`w-full flex items-start gap-3 p-3 text-right border-b border-slate-800/80 ${
                                selectedPostId === p.id
                                  ? 'bg-indigo-950/40'
                                  : 'hover:bg-slate-800/60'
                              }`}
                            >
                              <PostThumbnail url={p.thumbnail_url} />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-slate-100 line-clamp-2">
                                  {postLabel(p)}
                                </p>
                                <p className="text-[10px] text-slate-500 mt-1">
                                  {p.comment_reply_enabled ? 'مفعّل للرد' : 'غير مفعّل'}
                                </p>
                              </div>
                              {selectedPostId === p.id && (
                                <Check size={16} className="text-indigo-400 mt-1" />
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Desktop list */}
            <div className="hidden lg:block space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-200">المنشورات</h4>
                {loading && <span className="text-[10px] text-slate-500">تحميل…</span>}
              </div>
              <div className="max-h-[28rem] overflow-y-auto space-y-2 border border-slate-800 rounded-xl p-2">
                {posts.length === 0 && (
                  <p className="text-xs text-slate-500 p-3 text-center">
                    لا منشورات بعد — اضغط مزامنة
                  </p>
                )}
                {posts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectPost(p)}
                    className={`w-full text-right p-2 rounded-lg border text-xs transition ${
                      selectedPostId === p.id
                        ? 'border-indigo-500 bg-indigo-950/40'
                        : 'border-transparent hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex gap-2">
                      <PostThumbnail url={p.thumbnail_url} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-slate-100">{postLabel(p)}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {p.comment_reply_enabled ? 'مفعّل للرد' : 'غير مفعّل'}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Settings panel */}
            <div className="space-y-4">
              {!selectedPostId ? (
                <div className="rounded-xl border border-dashed border-slate-700 py-12 px-4 text-center">
                  <p className="text-sm text-slate-500">اختر منشوراً لضبط الردود</p>
                </div>
              ) : (
                <>
                  <label className="flex items-center justify-between p-3 border border-slate-800 rounded-xl bg-slate-950/50">
                    <span className="text-sm font-bold text-slate-200">
                      تفعيل الرد على تعليقات هذا المنشور
                    </span>
                    <input
                      type="checkbox"
                      checked={postSettings.commentReplyEnabled}
                      onChange={(e) =>
                        setPostSettings((s) => ({
                          ...s,
                          commentReplyEnabled: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 accent-indigo-500"
                    />
                  </label>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      نص الرد العام (تحت التعليق)
                    </label>
                    <select
                      key={`pub-${presetNonce.reply}`}
                      className="w-full mb-2 text-xs rounded-lg border border-slate-700 bg-slate-950 py-2 px-3 text-slate-200"
                      value=""
                      onChange={(e) => {
                        const p = PLATFORM_PUBLIC_PRESETS.find((x) => x.id === e.target.value);
                        if (!p) return;
                        setPostSettings((s) => ({ ...s, publicReplyText: p.body }));
                        setPresetNonce((n) => ({ ...n, reply: n.reply + 1 }));
                      }}
                    >
                      <option value="">— إدراج قالب جاهز —</option>
                      {PLATFORM_PUBLIC_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={postSettings.publicReplyText}
                      onChange={(e) =>
                        setPostSettings((s) => ({ ...s, publicReplyText: e.target.value }))
                      }
                      rows={3}
                      className="w-full text-sm rounded-lg border border-slate-700 bg-slate-950 p-3 text-slate-100"
                      placeholder="اكتب الرد أو اختر قالباً…"
                    />
                  </div>

                  <label className="flex items-center justify-between p-3 border border-slate-800 rounded-xl bg-slate-950/50">
                    <div>
                      <span className="text-sm font-bold text-slate-200 block">
                        رسالة خاصة بعد التعليق
                      </span>
                      <span className="text-[10px] text-slate-500">نص ثابت — بدون AI</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={postSettings.sendDmOnComment}
                      onChange={(e) =>
                        setPostSettings((s) => ({
                          ...s,
                          sendDmOnComment: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 accent-indigo-500"
                    />
                  </label>

                  {postSettings.sendDmOnComment && (
                    <div>
                      <select
                        key={`dm-${presetNonce.dm}`}
                        className="w-full mb-2 text-xs rounded-lg border border-slate-700 bg-slate-950 py-2 px-3 text-slate-200"
                        value=""
                        onChange={(e) => {
                          const p = PLATFORM_DM_PRESETS.find((x) => x.id === e.target.value);
                          if (!p) return;
                          setPostSettings((s) => ({ ...s, privateReplyText: p.body }));
                          setPresetNonce((n) => ({ ...n, dm: n.dm + 1 }));
                        }}
                      >
                        <option value="">— إدراج قالب رسالة خاصة —</option>
                        {PLATFORM_DM_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <textarea
                        value={postSettings.privateReplyText}
                        onChange={(e) =>
                          setPostSettings((s) => ({
                            ...s,
                            privateReplyText: e.target.value,
                          }))
                        }
                        rows={3}
                        className="w-full text-sm rounded-lg border border-slate-700 bg-slate-950 p-3 text-slate-100"
                        placeholder="مرحباً {{name}}! …"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        متغيرات: {'{{name}}'} · {'{{comment}}'}
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSavePostSettings}
                    disabled={saving}
                    className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm disabled:opacity-60"
                  >
                    {saving ? 'جاري الحفظ…' : 'حفظ إعدادات المنشور'}
                  </button>

                  {/* Keyword rules */}
                  <div className="pt-4 border-t border-slate-800 space-y-3">
                    <h4 className="text-sm font-bold text-slate-200">قواعد الكلمات المفتاحية</h4>
                    <p className="text-[11px] text-slate-500">
                      إن طابق التعليق كلمة، يُستخدم نص القاعدة بدل القالب العام.
                    </p>

                    <input
                      type="text"
                      value={ruleForm.keywords}
                      onChange={(e) =>
                        setRuleForm((f) => ({ ...f, keywords: e.target.value }))
                      }
                      placeholder="كلمات مفصولة بفاصلة: سعر، اشتراك، تجربة…"
                      className="w-full text-sm rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-slate-100"
                    />
                    <textarea
                      value={ruleForm.publicReplyText}
                      onChange={(e) =>
                        setRuleForm((f) => ({ ...f, publicReplyText: e.target.value }))
                      }
                      rows={2}
                      placeholder="رد عام لهذه القاعدة (اختياري)"
                      className="w-full text-sm rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-slate-100"
                    />
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={ruleForm.privateReplyEnabled}
                        onChange={(e) =>
                          setRuleForm((f) => ({
                            ...f,
                            privateReplyEnabled: e.target.checked,
                          }))
                        }
                        className="accent-indigo-500"
                      />
                      رسالة خاصة لهذه القاعدة
                    </label>
                    {ruleForm.privateReplyEnabled && (
                      <textarea
                        value={ruleForm.privateReplyText}
                        onChange={(e) =>
                          setRuleForm((f) => ({
                            ...f,
                            privateReplyText: e.target.value,
                          }))
                        }
                        rows={2}
                        className="w-full text-sm rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-slate-100"
                        placeholder="نص الرسالة الخاصة"
                      />
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSaveRule}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium"
                      >
                        {editingRuleId ? <Pencil size={12} /> : <Plus size={12} />}
                        {editingRuleId ? 'تحديث القاعدة' : 'إضافة قاعدة'}
                      </button>
                      {editingRuleId && (
                        <button
                          type="button"
                          onClick={resetRuleForm}
                          className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white"
                        >
                          إلغاء
                        </button>
                      )}
                    </div>

                    <ul className="space-y-2">
                      {rules.map((r) => (
                        <li
                          key={r.id}
                          className="flex items-start justify-between gap-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="text-slate-200 font-medium">
                              {(Array.isArray(r.keywords) ? r.keywords : []).join('، ')}
                            </p>
                            {r.public_reply_text && (
                              <p className="text-slate-500 mt-1 line-clamp-2">
                                {r.public_reply_text}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => handleEditRule(r)}
                              className="p-1.5 rounded text-slate-400 hover:text-indigo-300 hover:bg-slate-800"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRule(r.id)}
                              className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </li>
                      ))}
                      {rules.length === 0 && (
                        <p className="text-[11px] text-slate-500 text-center py-2">
                          لا قواعد لهذا المنشور
                        </p>
                      )}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminOfficialPageComments;
