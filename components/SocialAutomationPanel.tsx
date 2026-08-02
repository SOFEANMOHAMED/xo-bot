import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw,
  Link as LinkIcon,
  Plus,
  Trash2,
  Pencil,
  X,
  ChevronDown,
  Search,
  Image as ImageIcon,
  Check
} from 'lucide-react';
import { apiService } from '../services/api';
import {
  COMMENT_PUBLIC_REPLY_PRESETS,
  COMMENT_DM_AFTER_PRESETS
} from '../constants/commentReplyPresets';

type Platform = 'facebook' | 'instagram';

interface SocialAutomationPanelProps {
  facebookConnected: boolean;
  instagramConnected: boolean;
  facebookPageId?: string;
  instagramUserId?: string;
  showNotification?: (message: string, type: 'success' | 'error' | 'info') => void;
}

const emptyPostSettings = {
  commentReplyEnabled: false,
  publicReplyText: '',
  sendDmOnComment: false,
  privateReplyText: ''
};

const postLabel = (p: any) => {
  const caption = String(p?.caption || '').trim();
  if (caption) return caption;
  return p?.external_post_id ? `منشور ${p.external_post_id}` : 'منشور بدون نص';
};

const PostThumbnail: React.FC<{ url?: string | null; size?: 'sm' | 'md' }> = ({
  url,
  size = 'sm'
}) => {
  const dim = size === 'md' ? 'w-14 h-14' : 'w-10 h-10';
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={`${dim} rounded-lg object-cover flex-shrink-0 bg-gray-100 dark:bg-gray-700`}
      />
    );
  }
  return (
    <div
      className={`${dim} rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 text-gray-400`}
    >
      <ImageIcon size={size === 'md' ? 22 : 16} />
    </div>
  );
};

const SocialAutomationPanel: React.FC<SocialAutomationPanelProps> = ({
  facebookConnected,
  instagramConnected,
  facebookPageId,
  instagramUserId,
  showNotification
}) => {
  const [platform, setPlatform] = useState<Platform>(facebookConnected ? 'facebook' : 'instagram');
  const [posts, setPosts] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string>('');
  const [linkProductId, setLinkProductId] = useState<string>('');
  const [postSettings, setPostSettings] = useState(emptyPostSettings);
  const [presetNonce, setPresetNonce] = useState({ reply: 0, dm: 0 });
  const [postPickerOpen, setPostPickerOpen] = useState(false);
  const [postSearch, setPostSearch] = useState('');
  const [ruleForm, setRuleForm] = useState({
    keywords: '',
    publicReplyText: '',
    privateReplyText: '',
    privateReplyEnabled: false,
    priority: 100
  });
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const postPickerRef = useRef<HTMLDivElement>(null);
  const postSearchRef = useRef<HTMLInputElement>(null);

  const accountRef =
    platform === 'facebook' ? facebookPageId || '' : instagramUserId || '';

  const notifyRef = useRef(showNotification);
  notifyRef.current = showNotification;
  const selectedPostIdRef = useRef(selectedPostId);
  selectedPostIdRef.current = selectedPostId;

  const notify = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    notifyRef.current?.(msg, type);
  };

  const loadData = useCallback(
    async (opts?: { preserveSelection?: boolean }) => {
      if (!facebookConnected && !instagramConnected) return;
      setLoading(true);
      try {
        const [postsRes, productsRes] = await Promise.all([
          apiService.getSocialPosts({ platform, limit: 50 }),
          apiService.getProducts()
        ]);
        const nextPosts = postsRes.posts || [];
        setPosts(nextPosts);
        setProducts((productsRes.products || []).map((p) => ({ id: p.id, name: p.name })));

        const keepId = opts?.preserveSelection ? selectedPostIdRef.current : '';
        if (keepId) {
          const selected = nextPosts.find((p: any) => p.id === keepId);
          if (selected) {
            setLinkProductId(selected.linked_product_id || '');
            setPostSettings({
              commentReplyEnabled: !!selected.comment_reply_enabled,
              publicReplyText: selected.public_reply_text || '',
              sendDmOnComment: !!selected.send_dm_on_comment,
              privateReplyText: selected.private_reply_text || ''
            });
          }
        }
      } catch (e: any) {
        notifyRef.current?.(e?.message || 'فشل تحميل المنشورات', 'error');
      } finally {
        setLoading(false);
      }
    },
    [platform, facebookConnected, instagramConnected]
  );

  const loadRulesForPost = useCallback(
    async (postId: string) => {
      if (!postId) {
        setRules([]);
        return;
      }
      try {
        const rulesRes = await apiService.getSocialKeywordRules(platform, postId);
        setRules(rulesRes.rules || []);
      } catch {
        setRules([]);
      }
    },
    [platform]
  );

  // Reload when platform changes only — clear selection for the new platform
  useEffect(() => {
    setSelectedPostId('');
    setPostSettings(emptyPostSettings);
    setLinkProductId('');
    setRules([]);
    setPostPickerOpen(false);
    setPostSearch('');
    loadData();
  }, [platform, loadData]);

  useEffect(() => {
    if (!postPickerOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (postPickerRef.current && !postPickerRef.current.contains(e.target as Node)) {
        setPostPickerOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPostPickerOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    const t = window.setTimeout(() => postSearchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(t);
    };
  }, [postPickerOpen]);

  // Close mobile picker when switching to desktop layout (lg+)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (mq.matches) {
        setPostPickerOpen(false);
        setPostSearch('');
      }
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const selectedPost = useMemo(
    () => posts.find((p) => p.id === selectedPostId) || null,
    [posts, selectedPostId]
  );

  const filteredPosts = useMemo(() => {
    const q = postSearch.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter((p) => {
      const hay = `${p.caption || ''} ${p.external_post_id || ''} ${p.linked_product_name || ''}`.toLowerCase();
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
      priority: 100
    });
  };

  const selectPost = (p: any) => {
    setSelectedPostId(p.id);
    setLinkProductId(p.linked_product_id || '');
    setPostSettings({
      commentReplyEnabled: !!p.comment_reply_enabled,
      publicReplyText: p.public_reply_text || '',
      sendDmOnComment: !!p.send_dm_on_comment,
      privateReplyText: p.private_reply_text || ''
    });
    resetRuleForm();
    loadRulesForPost(p.id);
    setPostPickerOpen(false);
    setPostSearch('');
  };

  if (!facebookConnected && !instagramConnected) return null;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await apiService.syncSocialPosts(platform);
      const total = (res.results || []).reduce((s, r) => s + (r.synced || 0), 0);
      notify(`تمت مزامنة ${total} منشوراً`, 'success');
      await loadData({ preserveSelection: true });
    } catch (e: any) {
      notify(e?.message || 'فشلت المزامنة', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleSavePostSettings = async () => {
    if (!selectedPostId) {
      notify('اختر منشوراً أولاً', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiService.updateSocialPostCommentSettings({
        socialPostId: selectedPostId,
        commentReplyEnabled: postSettings.commentReplyEnabled,
        publicReplyText: postSettings.publicReplyText,
        sendDmOnComment: postSettings.sendDmOnComment,
        privateReplyText: postSettings.privateReplyText
      });
      await apiService.linkSocialPostProduct(selectedPostId, linkProductId || null);
      notify('تم حفظ إعدادات المنشور', 'success');
      await loadData({ preserveSelection: true });
    } catch (e: any) {
      notify(e?.message || 'فشل الحفظ', 'error');
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
      priority: Number.isFinite(Number(r.priority)) ? Number(r.priority) : 100
    });
  };

  const handleSaveRule = async () => {
    if (!accountRef) {
      notify('لا يوجد حساب مربوط لهذه المنصة', 'error');
      return;
    }
    if (!selectedPostId) {
      notify('اختر منشوراً لإضافة قاعدة', 'error');
      return;
    }
    if (!ruleForm.keywords.trim()) {
      notify('أدخل كلمات مفتاحية', 'error');
      return;
    }
    try {
      const selected = posts.find((p) => p.id === selectedPostId);
      if (editingRuleId) {
        await apiService.updateSocialKeywordRule(editingRuleId, {
          keywords: ruleForm.keywords,
          publicReplyText: ruleForm.publicReplyText,
          privateReplyText: ruleForm.privateReplyText,
          privateReplyEnabled: ruleForm.privateReplyEnabled,
          openAiConversation: false,
          priority: ruleForm.priority,
          scope: 'post',
          socialPostId: selectedPostId,
          externalPostId: selected?.external_post_id
        });
        notify('تم تحديث القاعدة', 'success');
      } else {
        await apiService.createSocialKeywordRule({
          platform,
          accountRef,
          scope: 'post',
          socialPostId: selectedPostId,
          externalPostId: selected?.external_post_id,
          keywords: ruleForm.keywords,
          publicReplyText: ruleForm.publicReplyText || undefined,
          privateReplyText: ruleForm.privateReplyText || undefined,
          privateReplyEnabled: ruleForm.privateReplyEnabled,
          openAiConversation: false,
          priority: ruleForm.priority
        });
        notify('تم إنشاء القاعدة للمنشور', 'success');
      }
      resetRuleForm();
      await loadRulesForPost(selectedPostId);
    } catch (e: any) {
      notify(e?.message || (editingRuleId ? 'فشل تحديث القاعدة' : 'فشل إنشاء القاعدة'), 'error');
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await apiService.deleteSocialKeywordRule(ruleId);
      if (editingRuleId === ruleId) resetRuleForm();
      notify('تم حذف القاعدة', 'success');
      await loadRulesForPost(selectedPostId);
    } catch (e: any) {
      notify(e?.message || 'فشل الحذف', 'error');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-brand-100 dark:border-brand-900/40 overflow-hidden">
      <div className="p-5 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-l from-white to-brand-50/60 dark:from-gray-800 dark:to-brand-900/30">
        <h3 className="font-bold text-gray-900 dark:text-white text-lg">إعدادات التعليق لكل منشور</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          الرد يتم فقط على المنشورات التي تفعّلها. الرسالة الخاصة نص ثابت (قالب أو يدوي)، والبوت يعرف المنتج المربوط عند استمرار المحادثة.
        </p>
      </div>

      <div className="p-5 space-y-5">
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex gap-2">
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
          </div>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-700 text-white text-sm disabled:opacity-60"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'جاري المزامنة…' : 'مزامنة المنشورات'}
          </button>
        </div>

        <div className="grid lg:grid-cols-2 gap-5">
          {/* موبايل / تابلت: قائمة منسدلة */}
          <div className="space-y-2 lg:hidden" ref={postPickerRef}>
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-bold text-gray-800 dark:text-gray-100">
                اختيار المنشور
              </label>
              <div className="flex items-center gap-2 text-[10px] text-gray-400">
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
                aria-haspopup="listbox"
                aria-expanded={postPickerOpen}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border text-right transition disabled:opacity-60 disabled:cursor-not-allowed ${
                  postPickerOpen
                    ? 'border-brand ring-2 ring-brand/20 bg-white dark:bg-gray-900'
                    : selectedPost
                      ? 'border-brand/40 bg-brand-50/40 dark:bg-brand-900/20 hover:border-brand'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                {selectedPost ? (
                  <>
                    <PostThumbnail url={selectedPost.thumbnail_url} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                        {postLabel(selectedPost)}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            selectedPost.comment_reply_enabled
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                              : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                          }`}
                        >
                          {selectedPost.comment_reply_enabled ? 'مفعّل للرد' : 'غير مفعّل'}
                        </span>
                        {selectedPost.linked_product_name && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                            {selectedPost.linked_product_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 text-gray-400">
                      <ImageIcon size={22} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                        {posts.length === 0
                          ? 'لا منشورات بعد — اضغط مزامنة'
                          : 'اختر منشوراً لضبط الردود…'}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        يمكنك البحث بالعنوان أو المنتج المرتبط
                      </p>
                    </div>
                  </>
                )}
                <ChevronDown
                  size={18}
                  className={`text-gray-400 flex-shrink-0 transition-transform ${
                    postPickerOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {postPickerOpen && (
                <div
                  className="absolute z-30 mt-2 w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 shadow-xl overflow-hidden"
                  role="listbox"
                >
                  <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                    <div className="relative">
                      <Search
                        size={14}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                      />
                      <input
                        ref={postSearchRef}
                        type="search"
                        value={postSearch}
                        onChange={(e) => setPostSearch(e.target.value)}
                        placeholder="بحث في المنشورات…"
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 pr-9 pl-3 py-2 text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                      />
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto custom-scrollbar">
                    {filteredPosts.length === 0 ? (
                      <p className="text-xs text-gray-400 p-4 text-center">لا نتائج مطابقة</p>
                    ) : (
                      filteredPosts.map((p) => {
                        const active = selectedPostId === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onClick={() => selectPost(p)}
                            className={`w-full flex items-start gap-3 p-2.5 text-right transition border-b border-gray-50 dark:border-gray-800 last:border-0 ${
                              active
                                ? 'bg-brand-50 dark:bg-brand-900/30'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-800/80'
                            }`}
                          >
                            <PostThumbnail url={p.thumbnail_url} />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-gray-800 dark:text-gray-100 line-clamp-2">
                                {postLabel(p)}
                              </p>
                              <p className="text-[10px] text-gray-400 mt-1">
                                {p.comment_reply_enabled ? 'مفعّل للرد' : 'غير مفعّل'}
                                {p.linked_product_name ? ` · ${p.linked_product_name}` : ''}
                              </p>
                            </div>
                            {active && (
                              <Check size={16} className="text-brand flex-shrink-0 mt-1" />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* كمبيوتر: قائمة المنشورات الجانبية */}
          <div className="hidden lg:block space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">المنشورات</h4>
              {loading && <span className="text-[10px] text-gray-400">تحميل…</span>}
            </div>
            <div className="max-h-[28rem] overflow-y-auto space-y-2 border border-gray-100 dark:border-gray-700 rounded-xl p-2">
              {posts.length === 0 && (
                <p className="text-xs text-gray-400 p-3 text-center">لا منشورات بعد — اضغط مزامنة</p>
              )}
              {posts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPost(p)}
                  className={`w-full text-right p-2 rounded-lg border text-xs transition ${
                    selectedPostId === p.id
                      ? 'border-brand bg-brand-50 dark:bg-brand-900/40'
                      : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
                >
                  <div className="flex gap-2">
                    {p.thumbnail_url ? (
                      <img
                        src={p.thumbnail_url}
                        alt=""
                        className="w-12 h-12 rounded object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-gray-100 dark:bg-gray-700 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-gray-800 dark:text-gray-100">
                        {p.caption || p.external_post_id}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {p.comment_reply_enabled ? 'مفعّل للرد' : 'غير مفعّل'}
                        {p.linked_product_name ? ` · ${p.linked_product_name}` : ''}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {!selectedPostId ? (
              <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-600 bg-gray-50/60 dark:bg-gray-900/40 py-12 px-4 text-center lg:border-0 lg:bg-transparent lg:dark:bg-transparent lg:py-10">
                <p className="text-sm text-gray-400">
                  <span className="lg:hidden">اختر منشوراً من القائمة أعلاه لضبط الردود</span>
                  <span className="hidden lg:inline">اختر منشوراً لضبط الردود</span>
                </p>
              </div>
            ) : (
              <>
                <label className="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-700 rounded-xl">
                  <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
                    تفعيل الرد على تعليقات هذا المنشور
                  </span>
                  <input
                    type="checkbox"
                    checked={postSettings.commentReplyEnabled}
                    onChange={(e) =>
                      setPostSettings((s) => ({ ...s, commentReplyEnabled: e.target.checked }))
                    }
                    className="w-4 h-4"
                  />
                </label>

                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    نص الرد العام (يظهر تحت التعليق)
                  </label>
                  <select
                    key={`pub-${presetNonce.reply}`}
                    className="w-full mb-2 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 py-2 px-3"
                    value=""
                    onChange={(e) => {
                      const p = COMMENT_PUBLIC_REPLY_PRESETS.find((x) => x.id === e.target.value);
                      if (!p) return;
                      setPostSettings((s) => ({ ...s, publicReplyText: p.body }));
                      setPresetNonce((n) => ({ ...n, reply: n.reply + 1 }));
                    }}
                  >
                    <option value="">— إدراج قالب جاهز —</option>
                    {COMMENT_PUBLIC_REPLY_PRESETS.map((p) => (
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
                    className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-3"
                    placeholder="اكتب الرد أو اختر قالباً…"
                  />
                </div>

                <label className="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-700 rounded-xl">
                  <div>
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-200 block">
                      رسالة خاصة بعد التعليق
                    </span>
                    <span className="text-[10px] text-gray-400">نص ثابت — بدون AI</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={postSettings.sendDmOnComment}
                    onChange={(e) =>
                      setPostSettings((s) => ({ ...s, sendDmOnComment: e.target.checked }))
                    }
                    className="w-4 h-4"
                  />
                </label>

                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    نص الرسالة الخاصة
                  </label>
                  <select
                    key={`dm-${presetNonce.dm}`}
                    className="w-full mb-2 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 py-2 px-3"
                    value=""
                    onChange={(e) => {
                      const p = COMMENT_DM_AFTER_PRESETS.find((x) => x.id === e.target.value);
                      if (!p) return;
                      setPostSettings((s) => ({ ...s, privateReplyText: p.body }));
                      setPresetNonce((n) => ({ ...n, dm: n.dm + 1 }));
                    }}
                  >
                    <option value="">— إدراج قالب جاهز —</option>
                    {COMMENT_DM_AFTER_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={postSettings.privateReplyText}
                    onChange={(e) =>
                      setPostSettings((s) => ({ ...s, privateReplyText: e.target.value }))
                    }
                    rows={3}
                    className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-3"
                    placeholder="رسالة الترحيب في الخاص…"
                  />
                </div>

                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="block text-[10px] text-gray-500 mb-1">ربط منتج (مستحسن)</label>
                    <select
                      value={linkProductId}
                      onChange={(e) => setLinkProductId(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-2 text-sm"
                    >
                      <option value="">— بدون ربط —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleSavePostSettings}
                    disabled={saving}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-brand hover:bg-brand-700 text-white text-sm disabled:opacity-60"
                  >
                    <LinkIcon size={14} />
                    {saving ? 'حفظ…' : 'حفظ الإعدادات'}
                  </button>
                </div>

                <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-3">
                  <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">
                    قواعد كلمات مفتاحية لهذا المنشور
                  </h4>
                  <input
                    value={ruleForm.keywords}
                    onChange={(e) => setRuleForm((f) => ({ ...f, keywords: e.target.value }))}
                    placeholder="كلمات مفصولة بفاصلة (سعر، طلب، متوفر)"
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
                  />
                  <textarea
                    value={ruleForm.publicReplyText}
                    onChange={(e) => setRuleForm((f) => ({ ...f, publicReplyText: e.target.value }))}
                    placeholder="رد عام عند تطابق الكلمة (اختياري — وإلا يُستخدم رد المنشور)"
                    rows={2}
                    className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-3"
                  />
                  <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={ruleForm.privateReplyEnabled}
                      onChange={(e) =>
                        setRuleForm((f) => ({ ...f, privateReplyEnabled: e.target.checked }))
                      }
                    />
                    إرسال رسالة خاصة عند تطابق هذه القاعدة
                  </label>
                  <textarea
                    value={ruleForm.privateReplyText}
                    onChange={(e) => setRuleForm((f) => ({ ...f, privateReplyText: e.target.value }))}
                    placeholder="نص الرسالة الخاصة لهذه القاعدة (اختياري)"
                    rows={2}
                    className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-3"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSaveRule}
                      className="flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-lg bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 text-sm"
                    >
                      {editingRuleId ? <Pencil size={14} /> : <Plus size={14} />}
                      {editingRuleId ? 'حفظ تعديلات القاعدة' : 'إضافة قاعدة للمنشور'}
                    </button>
                    {editingRuleId && (
                      <button
                        type="button"
                        onClick={resetRuleForm}
                        className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-sm"
                        title="إلغاء التعديل"
                      >
                        <X size={14} />
                        إلغاء
                      </button>
                    )}
                  </div>

                  <div className="max-h-40 overflow-y-auto space-y-2">
                    {rules.length === 0 && (
                      <p className="text-[10px] text-gray-400 text-center">لا قواعد بعد لهذا المنشور</p>
                    )}
                    {rules.map((r) => (
                      <div
                        key={r.id}
                        className={`flex items-start justify-between gap-2 p-2 rounded-lg text-xs ${
                          editingRuleId === r.id
                            ? 'bg-brand-50 dark:bg-brand-900/30 border border-brand'
                            : 'bg-gray-50 dark:bg-gray-700/40'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-800 dark:text-gray-100">
                            {(r.keywords || []).join('، ')}
                            {r.private_reply_enabled ? ' · خاص' : ''}
                          </p>
                          <p className="text-gray-500 line-clamp-2">
                            {r.public_reply_text || 'يستخدم رد المنشور'}
                          </p>
                        </div>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => handleEditRule(r)}
                            className="text-brand hover:text-brand-700 p-1"
                            title="تعديل القاعدة"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRule(r.id)}
                            className="text-red-500 hover:text-red-700 p-1"
                            title="حذف القاعدة"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SocialAutomationPanel;
