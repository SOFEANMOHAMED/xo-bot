/**
 * Super-admin inbox for the official XO Bot Facebook Messenger page.
 * Mirrors merchant ConversationsInbox UX, but platform-scoped (no merchant data).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MessageSquare,
  Search,
  Send,
  Bot,
  UserRound,
  Loader2,
  RefreshCw,
  ArrowRight,
  ImagePlus,
  X,
  Check,
} from 'lucide-react';
import apiService from '../../services/api';
import { logger } from '../../utils/logger';
import {
  usePlatformInboxRealtime,
  type PlatformInboxStreamEvent,
} from '../../hooks/usePlatformInboxRealtime';
import { useAdminNotifications } from './AdminNotificationContext';
import { adminPath } from '../../routes/paths';
import { AdminView } from '../../types';
import EmojiPicker from '../EmojiPicker';

type InboxConversation = {
  id: string;
  platform: string;
  userId?: string | null;
  userName?: string | null;
  lastMessageAt: string;
  createdAt: string;
  botDisabled: boolean;
  status: string;
  lastHumanResponseAt?: string | null;
  lastMessagePreview?: string | null;
  lastSenderType?: string | null;
  messageCount: number;
  unreadCount?: number;
};

type InboxMessage = {
  id: string;
  role: string;
  content: string;
  senderType?: string;
  source?: string | null;
  imageUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  timestamp: string;
  createdAt: string;
};

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'needs_attention', label: 'يحتاج متابعة' },
  { value: 'human', label: 'رد بشري' },
  { value: 'bot', label: 'البوت نشط' },
];

function parseInboxDate(dateStr: string | Date | null | undefined): Date {
  if (dateStr instanceof Date) return dateStr;
  const raw = String(dateStr || '').trim();
  if (!raw) return new Date(NaN);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) {
    return new Date(`${raw.replace(' ', 'T')}Z`);
  }
  return new Date(raw);
}

function formatRelative(dateStr: string | Date): string {
  const date = parseInboxDate(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `منذ ${days} ي`;
  return date.toLocaleDateString('ar-SA-u-nu-latn');
}

function isPlaceholderInboxName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  if (n === 'unknown' || n === 'user' || n === 'عميل' || n === 'زائر' || n === 'visitor') return true;
  if (n.startsWith('عميل') || n.startsWith('زائر')) return true;
  if (/^\d{8,}$/.test(n)) return true;
  return false;
}

function displayName(c: Pick<InboxConversation, 'userName' | 'userId'>): string {
  const name = (c.userName || '').trim();
  if (name && !isPlaceholderInboxName(name)) return name;
  if (c.userId) return `زائر · ${String(c.userId).slice(-6)}`;
  return 'زائر';
}

function isCustomerMessage(m: InboxMessage): boolean {
  return m.role === 'user' || m.senderType === 'user';
}

function isHumanAgentMessage(m: InboxMessage): boolean {
  return m.senderType === 'human';
}

const AdminOfficialPageInbox: React.FC = () => {
  const { showError, showSuccess } = useAdminNotifications();

  const [linked, setLinked] = useState<boolean | null>(null);
  const [pageName, setPageName] = useState<string | null>(null);
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<(InboxConversation & { messages: InboxMessage[] }) | null>(
    null
  );
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [pendingImage, setPendingImage] = useState<{ url: string; preview: string } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const mobileShowThread = !!selectedId;

  selectedIdRef.current = selectedId;

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchList = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setListLoading(true);
      setListError(null);
      try {
        const data = await apiService.getOfficialInboxConversations({
          status: statusFilter === 'all' ? undefined : statusFilter,
          search: searchDebounced || undefined,
          limit: 80,
        });
        setLinked(!!data.linked);
        setPageName(data.page?.pageName || null);
        setConversations(Array.isArray(data.conversations) ? data.conversations : []);
        setTotal(data.total || 0);
      } catch (err: any) {
        logger.error('Failed to load official inbox', err);
        setListError(err?.message || 'فشل تحميل المحادثات');
        setConversations([]);
      } finally {
        if (!opts?.silent) setListLoading(false);
      }
    },
    [statusFilter, searchDebounced]
  );

  const fetchThread = useCallback(async (id: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setThreadLoading(true);
    setThreadError(null);
    try {
      const data = await apiService.getOfficialInboxConversation(id);
      const c = data.conversation;
      const msgs = (Array.isArray(c.messages) ? c.messages : []) as InboxMessage[];
      setThread({
        id: c.id,
        platform: c.platform || 'facebook_messenger',
        userId: c.userId,
        userName: c.userName,
        lastMessageAt: c.lastMessageAt,
        createdAt: c.createdAt,
        botDisabled: !!c.botDisabled,
        status: c.status || 'bot',
        lastHumanResponseAt: c.lastHumanResponseAt,
        lastMessagePreview: null,
        lastSenderType: null,
        messageCount: msgs.length,
        unreadCount: 0,
        messages: msgs,
      });
      if (!opts?.silent) {
        setPendingImage(null);
        void apiService.markOfficialInboxRead(id).catch(() => undefined);
        setConversations((prev) =>
          prev.map((row) => (row.id === id ? { ...row, unreadCount: 0 } : row))
        );
      }
    } catch (err: any) {
      logger.error('Failed to load official conversation', err);
      setThreadError(err?.message || 'فشل تحميل المحادثة');
      setThread(null);
    } finally {
      if (!opts?.silent) setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (!selectedId) {
      setThread(null);
      return;
    }
    void fetchThread(selectedId);
  }, [selectedId, fetchThread]);

  const handleRealtimeEvent = useCallback(
    (event: PlatformInboxStreamEvent) => {
      const convId = event.conversationId || event.conversation?.id;
      if (!convId) return;

      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === convId);
        const patch = event.conversation;
        const previewText =
          patch?.lastMessagePreview ||
          event.message?.content?.slice(0, 180) ||
          null;
        const isUserMsg = event.message?.senderType === 'user' || event.message?.role === 'user';

        if (idx === -1) {
          void fetchList({ silent: true });
          return prev;
        }

        const current = prev[idx];
        const updated: InboxConversation = {
          ...current,
          userName: patch?.userName ?? current.userName,
          userId: patch?.userId ?? current.userId,
          botDisabled:
            patch?.botDisabled !== undefined ? !!patch.botDisabled : current.botDisabled,
          status: String(patch?.status || current.status),
          lastMessageAt:
            patch?.lastMessageAt || event.message?.createdAt || current.lastMessageAt,
          lastMessagePreview: previewText || current.lastMessagePreview,
          lastSenderType:
            patch?.lastSenderType || event.message?.senderType || current.lastSenderType,
          unreadCount:
            selectedIdRef.current === convId
              ? 0
              : isUserMsg
                ? (current.unreadCount || 0) + 1
                : current.unreadCount || 0,
        };
        const rest = prev.filter((_, i) => i !== idx);
        return [updated, ...rest];
      });

      if (event.type === 'message' && event.message && selectedIdRef.current === convId) {
        setThread((prev) => {
          if (!prev || prev.id !== convId) return prev;
          const incomingId = String(event.message!.id);
          if (prev.messages.some((m) => String(m.id) === incomingId)) return prev;
          const content = (event.message.content || '').trim();
          const createdMs = parseInboxDate(event.message.createdAt).getTime();
          if (
            content &&
            event.message.senderType === 'human' &&
            prev.messages.some((m) => {
              if (m.senderType !== 'human') return false;
              if ((m.content || '').trim() !== content) return false;
              const otherMs = parseInboxDate(m.createdAt || m.timestamp).getTime();
              return Number.isFinite(createdMs) && Math.abs(createdMs - otherMs) < 15_000;
            })
          ) {
            return prev;
          }
          const msg: InboxMessage = {
            id: event.message.id,
            role: event.message.role === 'user' ? 'user' : 'assistant',
            content: event.message.content,
            senderType: event.message.senderType,
            createdAt: event.message.createdAt,
            timestamp: event.message.createdAt,
          };
          return {
            ...prev,
            botDisabled:
              event.conversation?.botDisabled !== undefined
                ? !!event.conversation.botDisabled
                : prev.botDisabled,
            status: String(event.conversation?.status || prev.status),
            lastMessageAt: event.message.createdAt,
            messages: [...prev.messages, msg],
            messageCount: prev.messageCount + 1,
          };
        });
        void apiService.markOfficialInboxRead(convId).catch(() => undefined);
      } else if (event.type === 'conversation' && selectedIdRef.current === convId) {
        setThread((prev) => {
          if (!prev || prev.id !== convId) return prev;
          return {
            ...prev,
            botDisabled:
              event.conversation?.botDisabled !== undefined
                ? !!event.conversation.botDisabled
                : prev.botDisabled,
            status: String(event.conversation?.status || prev.status),
            userName: event.conversation?.userName ?? prev.userName,
          };
        });
      }

      if (event.type === 'message' && event.message?.senderType === 'user') {
        if (selectedIdRef.current !== convId) {
          showSuccess(`رسالة جديدة من ${event.conversation?.userName || 'زائر'}`);
        }
      }
    },
    [fetchList, showSuccess]
  );

  const { connected: realtimeConnected } = usePlatformInboxRealtime({
    enabled: linked === true,
    onEvent: handleRealtimeEvent,
  });

  useEffect(() => {
    if (realtimeConnected || linked !== true) return;
    const interval = setInterval(() => {
      void fetchList({ silent: true });
      if (selectedId) void fetchThread(selectedId, { silent: true });
    }, 8000);
    return () => clearInterval(interval);
  }, [realtimeConnected, linked, fetchList, fetchThread, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.messages?.length, selectedId]);

  const needsAttentionCount = useMemo(
    () => conversations.filter((c) => c.botDisabled || c.status === 'human').length,
    [conversations]
  );

  const unreadTotal = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
    [conversations]
  );

  const onPickImage = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setThreadError('يُسمح برفع الصور فقط');
      return;
    }
    setUploadingImage(true);
    setThreadError(null);
    try {
      const preview = URL.createObjectURL(file);
      const res = await apiService.uploadFile(file);
      setPendingImage({ url: res.file.url, preview });
    } catch (err: any) {
      logger.error('Official inbox image upload failed', err);
      setThreadError(err?.message || 'فشل رفع الصورة');
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSend = async () => {
    if (!selectedId || sending) return;
    const text = draft.trim();
    if (!text && !pendingImage) return;
    setSending(true);
    setThreadError(null);
    try {
      const result = await apiService.sendOfficialInboxHumanMessage(
        selectedId,
        text,
        pendingImage?.url || undefined
      );
      setDraft('');
      setPendingImage(null);
      setThread((prev) => {
        if (!prev) return prev;
        const incoming = result.message as InboxMessage;
        const already = prev.messages.some((m) => String(m.id) === String(incoming.id));
        return {
          ...prev,
          botDisabled: true,
          status: 'human',
          messages: already ? prev.messages : [...prev.messages, incoming],
          messageCount: already ? prev.messageCount : prev.messageCount + 1,
          lastMessageAt: incoming.createdAt,
        };
      });
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? {
                ...c,
                botDisabled: true,
                status: 'human',
                lastMessagePreview: (text || '📷 صورة').slice(0, 180),
                lastSenderType: 'human',
                lastMessageAt: result.message.createdAt,
                unreadCount: 0,
              }
            : c
        )
      );
    } catch (err: any) {
      logger.error('Send official inbox message failed', err);
      setThreadError(err?.message || 'فشل إرسال الرسالة');
      showError(err?.message || 'فشل إرسال الرسالة');
    } finally {
      setSending(false);
    }
  };

  const handleTakeOver = async () => {
    if (!selectedId || actionBusy) return;
    setActionBusy(true);
    try {
      await apiService.disableOfficialInboxBot(selectedId);
      setThread((prev) => (prev ? { ...prev, botDisabled: true, status: 'human' } : prev));
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId ? { ...c, botDisabled: true, status: 'human' } : c
        )
      );
    } catch (err: any) {
      setThreadError(err?.message || 'فشل تحويل المحادثة');
    } finally {
      setActionBusy(false);
    }
  };

  const handleResumeBot = async () => {
    if (!selectedId || actionBusy) return;
    setActionBusy(true);
    try {
      await apiService.enableOfficialInboxBot(selectedId);
      setThread((prev) => (prev ? { ...prev, botDisabled: false, status: 'bot' } : prev));
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId ? { ...c, botDisabled: false, status: 'bot' } : c
        )
      );
    } catch (err: any) {
      setThreadError(err?.message || 'فشل إعادة تفعيل البوت');
    } finally {
      setActionBusy(false);
    }
  };

  if (linked === false) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-8 text-center max-w-xl mx-auto">
          <MessageSquare className="mx-auto mb-4 text-indigo-400" size={40} />
          <h2 className="text-xl font-bold text-white mb-2">صندوق وارد صفحة XO Bot</h2>
          <p className="text-slate-400 text-sm mb-6 leading-relaxed">
            اربط صفحة فيسبوك الرسمية أولاً من الإعدادات لعرض رسائل الماسنجر والرد عليها من هنا.
          </p>
          <Link
            to={adminPath(AdminView.SETTINGS)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm"
          >
            فتح الإعدادات وربط الصفحة
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] md:h-[calc(100vh-5rem)] min-h-[520px] flex flex-col animate-fade-in">
      <div className="mb-4 shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2.5 rounded-xl bg-indigo-600/20 border border-indigo-500/30">
            <MessageSquare className="text-indigo-300" size={22} />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white">
              صندوق وارد صفحة XO Bot
            </h1>
            <p className="text-sm text-slate-400">
              {pageName ? `${pageName} · ` : ''}
              رسائل ماسنجر الصفحة الرسمية
              {total > 0 ? ` · ${total} محادثة` : ''}
              {needsAttentionCount > 0 ? ` · ${needsAttentionCount} تحتاج متابعة` : ''}
              {unreadTotal > 0 ? ` · ${unreadTotal} غير مقروء` : ''}
              {' · '}
              <span className={realtimeConnected ? 'text-emerald-400' : 'text-amber-400'}>
                {realtimeConnected ? 'مباشر' : 'جارٍ الاتصال...'}
              </span>
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[360px_1fr] gap-0 rounded-2xl border border-slate-700 overflow-hidden bg-slate-900 shadow-sm">
        <aside
          className={`flex flex-col border-l border-slate-700 min-h-0 ${
            mobileShowThread ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="p-3 space-y-3 border-b border-slate-700/80 shrink-0">
            <div className="relative">
              <Search
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالاسم أو المعرف..."
                className="w-full pr-9 pl-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="flex-1 text-xs rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-slate-200"
              >
                {STATUS_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void fetchList()}
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-800"
                aria-label="تحديث"
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {listLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
                <Loader2 className="animate-spin" size={20} />
                <span className="text-sm">جاري التحميل...</span>
              </div>
            ) : listError ? (
              <div className="p-4 text-sm text-red-400">{listError}</div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                <MessageSquare size={36} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium">لا توجد محادثات بعد</p>
                <p className="text-xs mt-1 leading-relaxed">
                  تظهر هنا رسائل زوار صفحة XO Bot الرسمية تلقائياً.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-800">
                {conversations.map((c) => {
                  const active = c.id === selectedId;
                  const attention = c.botDisabled || c.status === 'human';
                  const unread = (c.unreadCount || 0) > 0;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        className={`w-full text-right px-3 py-3 transition-colors ${
                          active ? 'bg-indigo-600/20' : 'hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span
                            className={`font-bold text-sm truncate ${
                              unread ? 'text-white' : 'text-slate-200'
                            }`}
                          >
                            {displayName(c)}
                          </span>
                          <span className="text-[11px] text-slate-500 shrink-0">
                            {formatRelative(c.lastMessageAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border bg-blue-500/15 text-blue-300 border-blue-400/30">
                            فيسبوك ماسنجر
                          </span>
                          {attention && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-400/30">
                              متابعة بشرية
                            </span>
                          )}
                          {unread && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-red-500/20 text-red-300 border border-red-400/30">
                              {c.unreadCount}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                          {c.lastMessagePreview || 'بدون رسائل'}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section
          className={`flex flex-col min-h-0 min-w-0 ${
            mobileShowThread ? 'flex' : 'hidden md:flex'
          }`}
        >
          {!selectedId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-8">
              <MessageSquare size={48} className="mb-3 opacity-30" />
              <p className="text-sm">اختر محادثة من القائمة للرد على الزائر</p>
            </div>
          ) : threadLoading && !thread ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-slate-500">
              <Loader2 className="animate-spin" size={22} />
              <span className="text-sm">تحميل المحادثة...</span>
            </div>
          ) : thread ? (
            <>
              <header className="shrink-0 px-4 py-3 border-b border-slate-700/80 flex items-center gap-3">
                <button
                  type="button"
                  className="md:hidden p-2 rounded-lg hover:bg-slate-800 text-slate-300"
                  onClick={() => setSelectedId(null)}
                  aria-label="رجوع"
                >
                  <ArrowRight size={20} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-bold text-white truncate">{displayName(thread)}</h2>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border bg-blue-500/15 text-blue-300 border-blue-400/30">
                      فيسبوك ماسنجر
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {thread.botDisabled || thread.status === 'human'
                      ? 'الرد الآلي متوقف — أنت ترد يدوياً'
                      : 'البوت يرد تلقائياً — أرسل رسالة لتتولى المحادثة'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {thread.botDisabled || thread.status === 'human' ? (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={handleResumeBot}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50"
                    >
                      <Bot size={14} />
                      إعادة البوت
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={handleTakeOver}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-500/15 text-amber-200 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-50"
                    >
                      <UserRound size={14} />
                      تولي المحادثة
                    </button>
                  )}
                </div>
              </header>

              {threadError && (
                <div className="mx-4 mt-3 text-sm text-red-300 bg-red-900/20 border border-red-800 rounded-xl px-3 py-2">
                  {threadError}
                </div>
              )}

              <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-3">
                {thread.messages.length === 0 ? (
                  <p className="text-center text-sm text-slate-500 py-12">لا رسائل في هذه المحادثة</p>
                ) : (
                  thread.messages.map((m) => {
                    const customer = isCustomerMessage(m);
                    const human = isHumanAgentMessage(m);
                    const displayContent =
                      m.content && m.content !== '📷 صورة' ? m.content : '';
                    return (
                      <div
                        key={m.id}
                        className={`flex ${customer ? 'justify-start' : 'justify-end'}`}
                      >
                        <div
                          className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words ${
                            customer
                              ? 'bg-slate-800 text-slate-100 rounded-br-md'
                              : human
                                ? 'bg-indigo-600 text-white rounded-bl-md'
                                : 'bg-violet-700 text-white rounded-bl-md'
                          }`}
                        >
                          {!customer && (
                            <div className="text-[10px] font-bold mb-1 opacity-80 text-white/90">
                              {human ? 'أنت (رد بشري)' : 'البوت'}
                            </div>
                          )}
                          {m.imageUrl && (
                            <a
                              href={m.imageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block mb-2 overflow-hidden rounded-xl"
                            >
                              <img
                                src={m.imageUrl}
                                alt="مرفق"
                                className="max-h-64 w-auto max-w-full object-contain rounded-xl"
                                loading="lazy"
                              />
                            </a>
                          )}
                          {displayContent ? (
                            <div className="whitespace-pre-wrap">{displayContent}</div>
                          ) : null}
                          <div
                            className={`text-[10px] mt-1.5 flex items-center gap-1 ${
                              customer ? 'text-slate-500' : 'text-white/70'
                            } ${customer ? '' : 'justify-end'}`}
                          >
                            <span>{formatRelative(m.createdAt || m.timestamp)}</span>
                            {!customer && <Check size={12} className="opacity-70" />}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              <footer className="shrink-0 p-3 border-t border-slate-700/80 bg-slate-950/60">
                {pendingImage && (
                  <div className="mb-2 relative inline-block">
                    <img
                      src={pendingImage.preview}
                      alt="معاينة"
                      className="h-20 w-20 object-cover rounded-xl border border-slate-600"
                    />
                    <button
                      type="button"
                      onClick={() => setPendingImage(null)}
                      className="absolute -top-2 -left-2 p-1 rounded-full bg-slate-900 text-white shadow"
                      aria-label="إزالة الصورة"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="flex items-center gap-0.5 shrink-0 pb-1">
                    <EmojiPicker onEmojiSelect={(emoji) => setDraft((d) => d + emoji)} />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sending || uploadingImage}
                      className="p-2 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
                      aria-label="إرفاق صورة"
                    >
                      {uploadingImage ? (
                        <Loader2 size={20} className="animate-spin text-slate-400" />
                      ) : (
                        <ImagePlus size={20} className="text-slate-400" />
                      )}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => void onPickImage(e.target.files?.[0] || null)}
                    />
                  </div>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    rows={2}
                    placeholder="اكتب ردك للزائر... (Enter للإرسال)"
                    className="flex-1 resize-none rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    disabled={sending}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || uploadingImage || (!draft.trim() && !pendingImage)}
                    className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                  >
                    {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    <span className="hidden sm:inline">إرسال</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                  الإرسال يوقف بوت الصفحة لهذه المحادثة ويصل للزائر عبر ماسنجر فيسبوك.
                </p>
              </footer>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-red-400 p-6">
              {threadError || 'تعذر فتح المحادثة'}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminOfficialPageInbox;
