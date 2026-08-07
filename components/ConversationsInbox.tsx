import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  CheckCheck,
  ExternalLink,
  Megaphone,
} from 'lucide-react';
import apiService from '../services/api';
import { logger } from '../utils/logger';
import { useInboxRealtime, type InboxStreamEvent } from '../hooks/useInboxRealtime';
import EmojiPicker from './EmojiPicker';

type ConversationSourcePost = {
  source: string;
  sourceLabel: string;
  platform: string | null;
  externalPostId: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  productId: string | null;
  productName: string | null;
  commentId: string | null;
  adId: string | null;
  capturedAt: string | null;
};

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
  sourcePost?: ConversationSourcePost | null;
};

type InboxMessage = {
  id: string;
  role: string;
  content: string;
  senderType?: string;
  source?: string | null;
  imageUrl?: string | null;
  readAt?: string | null;
  deliveredAt?: string | null;
  metadata?: Record<string, unknown> | null;
  timestamp: string;
  createdAt: string;
};

const PLATFORM_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'الكل' },
  { value: 'facebook_messenger', label: 'فيسبوك' },
  { value: 'instagram', label: 'إنستغرام' },
  { value: 'telegram', label: 'تيليجرام' },
  { value: 'whatsapp', label: 'واتساب' },
];

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'needs_attention', label: 'يحتاج متابعة' },
  { value: 'human', label: 'رد بشري' },
  { value: 'bot', label: 'البوت نشط' },
];

function platformLabel(platform: string): string {
  switch ((platform || '').toLowerCase()) {
    case 'facebook_messenger':
    case 'facebook':
      return 'فيسبوك ماسنجر';
    case 'instagram':
      return 'إنستغرام';
    case 'telegram':
      return 'تيليجرام';
    case 'whatsapp':
      return 'واتساب';
    case 'web':
      return 'تجربة البوت';
    default:
      return platform || 'قناة';
  }
}

function platformAccent(platform: string): string {
  switch ((platform || '').toLowerCase()) {
    case 'instagram':
      return 'bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-300/40';
    case 'telegram':
      return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-300/40';
    case 'whatsapp':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300/40';
    case 'facebook_messenger':
    case 'facebook':
      return 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-300/40';
    default:
      return 'bg-gray-500/10 text-gray-700 dark:text-gray-300 border-gray-300/40';
  }
}

function parseInboxDate(dateStr: string | Date | null | undefined): Date {
  if (dateStr instanceof Date) return dateStr;
  const raw = String(dateStr || '').trim();
  if (!raw) return new Date(NaN);
  // Postgres `timestamp without time zone` often arrives as "YYYY-MM-DD HH:mm:ss"
  // or "YYYY-MM-DDTHH:mm:ss" with no offset — treat as UTC (DB session is UTC).
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
  if (n === 'unknown' || n === 'user' || n === 'عميل') return true;
  // Placeholders like «عميل فيسبوك» / «عميل إنستغرام» / «عميل غير معروف»
  if (n.startsWith('عميل')) return true;
  if (n === 'facebook user' || n === 'instagram user') return true;
  if (/^\d{8,}$/.test(n)) return true;
  return false;
}

function displayName(c: Pick<InboxConversation, 'userName' | 'userId'>): string {
  const name = (c.userName || '').trim();
  if (name && !isPlaceholderInboxName(name)) return name;
  if (c.userId) return `عميل · ${String(c.userId).slice(-6)}`;
  return 'عميل';
}

function isCustomerMessage(m: InboxMessage): boolean {
  return m.role === 'user' || m.senderType === 'user';
}

function isHumanAgentMessage(m: InboxMessage): boolean {
  return m.senderType === 'human';
}

const ConversationsInbox: React.FC = () => {
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [platformFilter, setPlatformFilter] = useState('all');
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
  const [customerTyping, setCustomerTyping] = useState(false);
  const [outboundReadAt, setOutboundReadAt] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const mobileShowThread = !!selectedId;

  selectedIdRef.current = selectedId;

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchList = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setListLoading(true);
    setListError(null);
    try {
      const data = await apiService.getConversations({
        platform: platformFilter === 'all' ? undefined : platformFilter,
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: searchDebounced || undefined,
        limit: 80,
      });
      setConversations(Array.isArray(data.conversations) ? data.conversations : []);
      setTotal(data.total || 0);
    } catch (err: any) {
      logger.error('Failed to load inbox', err);
      setListError(err?.message || 'فشل تحميل المحادثات');
      setConversations([]);
    } finally {
      if (!opts?.silent) setListLoading(false);
    }
  }, [platformFilter, statusFilter, searchDebounced]);

  const fetchThread = useCallback(async (id: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setThreadLoading(true);
    setThreadError(null);
    try {
      const data = await apiService.getConversation(id);
      const c = data.conversation;
      const msgs = (Array.isArray(c.messages) ? c.messages : []) as InboxMessage[];
      setThread({
        id: c.id,
        platform: c.platform,
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
        sourcePost: c.sourcePost ?? null,
        messages: msgs,
      });
      const lastOutboundRead =
        [...msgs].reverse().find((m) => !isCustomerMessage(m) && m.readAt)?.readAt || null;
      setOutboundReadAt(lastOutboundRead);
      if (!opts?.silent) {
        setCustomerTyping(false);
        setPendingImage(null);
        void apiService.markInboxRead(id).catch(() => undefined);
      }
    } catch (err: any) {
      logger.error('Failed to load conversation', err);
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
    (event: InboxStreamEvent) => {
      if (event.type === 'typing') {
        const typing = event.typing;
        const convId = typing?.conversationId || event.conversationId;
        if (!convId || convId !== selectedIdRef.current) return;
        // Ignore echo of our own merchant typing; show customer typing when available
        if (typing?.from === 'merchant') return;
        setCustomerTyping(!!typing?.isTyping);
        if (typing?.isTyping) {
          window.setTimeout(() => setCustomerTyping(false), 6000);
        }
        return;
      }

      if (event.type === 'read') {
        const read = event.read;
        const convId = read?.conversationId || event.conversationId;
        if (!convId || convId !== selectedIdRef.current) return;
        if (read?.reader === 'customer') {
          const at = read.readAt || new Date().toISOString();
          setOutboundReadAt(at);
          setThread((prev) => {
            if (!prev || prev.id !== convId) return prev;
            return {
              ...prev,
              messages: prev.messages.map((m) =>
                !isCustomerMessage(m) && !m.readAt ? { ...m, readAt: at } : m
              ),
            };
          });
        }
        return;
      }

      const convId = event.conversationId || event.conversation?.id;
      if (!convId) return;

      // Update / upsert list row
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === convId);
        const patch = event.conversation;
        const previewText =
          patch?.lastMessagePreview ||
          event.message?.content?.slice(0, 180) ||
          (event.message?.imageUrl ? '📷 صورة' : null);
        if (idx === -1) {
          // Unknown conversation — soft-insert stub then rely on next silent refresh for full fields
          if (!patch?.platform && !event.platform) {
            void fetchList({ silent: true });
            return prev;
          }
          const stub: InboxConversation = {
            id: convId,
            platform: String(patch?.platform || event.platform || 'unknown'),
            userId: patch?.userId ?? null,
            userName: patch?.userName ?? null,
            lastMessageAt: patch?.lastMessageAt || event.message?.createdAt || new Date().toISOString(),
            createdAt: new Date().toISOString(),
            botDisabled: !!patch?.botDisabled,
            status: String(patch?.status || 'bot'),
            lastMessagePreview: previewText,
            lastSenderType: patch?.lastSenderType || event.message?.senderType || null,
            messageCount: event.message ? 1 : 0,
          };
          return [stub, ...prev];
        }

        const current = prev[idx];
        const updated: InboxConversation = {
          ...current,
          userName: patch?.userName ?? current.userName,
          userId: patch?.userId ?? current.userId,
          platform: String(patch?.platform || current.platform),
          botDisabled:
            patch?.botDisabled !== undefined ? !!patch.botDisabled : current.botDisabled,
          status: String(patch?.status || current.status),
          lastMessageAt:
            patch?.lastMessageAt || event.message?.createdAt || current.lastMessageAt,
          lastMessagePreview: previewText || current.lastMessagePreview,
          lastSenderType:
            patch?.lastSenderType || event.message?.senderType || current.lastSenderType,
          messageCount: current.messageCount,
        };
        const rest = prev.filter((_, i) => i !== idx);
        return [updated, ...rest];
      });

      // Append to open thread
      if (event.type === 'message' && event.message && selectedIdRef.current === convId) {
        setCustomerTyping(false);
        setThread((prev) => {
          if (!prev || prev.id !== convId) return prev;
          const incomingId = String(event.message!.id);
          if (prev.messages.some((m) => String(m.id) === incomingId)) return prev;
          // Soft dedupe: same human text within 15s (e.g. Meta echo + inbox send)
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
            role: event.message.role,
            content: event.message.content,
            senderType: event.message.senderType,
            source: event.message.source,
            imageUrl: event.message.imageUrl || null,
            metadata: event.message.metadata || null,
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
        void apiService.markInboxRead(convId).catch(() => undefined);
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
    },
    [fetchList]
  );

  const { connected: realtimeConnected } = useInboxRealtime({
    enabled: true,
    onEvent: handleRealtimeEvent,
  });

  // Fallback polling only when realtime is disconnected
  useEffect(() => {
    if (realtimeConnected) return;
    const interval = setInterval(() => {
      void fetchList({ silent: true });
      if (selectedId) void fetchThread(selectedId, { silent: true });
    }, 8000);
    return () => clearInterval(interval);
  }, [realtimeConnected, fetchList, fetchThread, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.messages?.length, selectedId, customerTyping]);

  useEffect(() => {
    return () => {
      if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
      if (typingActiveRef.current && selectedIdRef.current) {
        void apiService.setInboxTyping(selectedIdRef.current, false).catch(() => undefined);
      }
    };
  }, []);

  const needsAttentionCount = useMemo(
    () => conversations.filter((c) => c.botDisabled || c.status === 'human').length,
    [conversations]
  );

  const pushTyping = useCallback((isTyping: boolean) => {
    const id = selectedIdRef.current;
    if (!id) return;
    if (typingActiveRef.current === isTyping) return;
    typingActiveRef.current = isTyping;
    void apiService.setInboxTyping(id, isTyping).catch(() => undefined);
  }, []);

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (!selectedIdRef.current) return;
    pushTyping(true);
    if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    typingIdleRef.current = setTimeout(() => pushTyping(false), 1800);
  };

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
      logger.error('Inbox image upload failed', err);
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
    pushTyping(false);
    try {
      const result = await apiService.sendHumanMessage(
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
              }
            : c
        )
      );
    } catch (err: any) {
      logger.error('Send human message failed', err);
      setThreadError(err?.message || 'فشل إرسال الرسالة');
    } finally {
      setSending(false);
    }
  };

  const handleTakeOver = async () => {
    if (!selectedId || actionBusy) return;
    setActionBusy(true);
    try {
      await apiService.disableBotForConversation(selectedId);
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
      await apiService.enableBotForConversation(selectedId);
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

  return (
    <div className="h-[calc(100vh-8rem)] md:h-[calc(100vh-5rem)] min-h-[520px] flex flex-col animate-fade-in">
      <div className="mb-4 shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2.5 rounded-xl bg-brand/10 border border-brand/20">
            <MessageSquare className="text-brand" size={22} />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
              صندوق الوارد
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              محادثات فيسبوك وإنستغرام والقنوات — رد مباشرة من لوحة Xo Bot
              {total > 0 ? ` · ${total} محادثة` : ''}
              {needsAttentionCount > 0 ? ` · ${needsAttentionCount} تحتاج متابعة` : ''}
              {' · '}
              <span className={realtimeConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                {realtimeConnected ? 'مباشر' : 'جارٍ الاتصال...'}
              </span>
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[360px_1fr] gap-0 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800 shadow-sm">
        {/* List pane */}
        <aside
          className={`flex flex-col border-l border-gray-200 dark:border-gray-700 min-h-0 ${
            mobileShowThread ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="p-3 space-y-3 border-b border-gray-100 dark:border-gray-700/80 shrink-0">
            <div className="relative">
              <Search
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالاسم أو المعرف..."
                className="w-full pr-9 pl-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-600 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {PLATFORM_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setPlatformFilter(f.value)}
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                    platformFilter === f.value
                      ? 'bg-brand text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="flex-1 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-2 text-gray-700 dark:text-gray-200"
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
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="تحديث"
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {listLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
                <Loader2 className="animate-spin" size={20} />
                <span className="text-sm">جاري التحميل...</span>
              </div>
            ) : listError ? (
              <div className="p-4 text-sm text-red-600 dark:text-red-400">{listError}</div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                <MessageSquare size={36} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium">لا توجد محادثات بعد</p>
                <p className="text-xs mt-1 leading-relaxed">
                  تظهر هنا رسائل العملاء من القنوات المربوطة تلقائياً.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700/60">
                {conversations.map((c) => {
                  const active = c.id === selectedId;
                  const attention = c.botDisabled || c.status === 'human';
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        className={`w-full text-right px-3 py-3 transition-colors ${
                          active
                            ? 'bg-brand-50 dark:bg-brand-900/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-900/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="font-bold text-sm text-gray-900 dark:text-white truncate">
                            {displayName(c)}
                          </span>
                          <span className="text-[11px] text-gray-400 shrink-0">
                            {formatRelative(c.lastMessageAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${platformAccent(
                              c.platform
                            )}`}
                          >
                            {platformLabel(c.platform)}
                          </span>
                          {attention && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-300/40">
                              متابعة بشرية
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">
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

        {/* Thread pane */}
        <section
          className={`flex flex-col min-h-0 min-w-0 ${
            mobileShowThread ? 'flex' : 'hidden md:flex'
          }`}
        >
          {!selectedId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
              <MessageSquare size={48} className="mb-3 opacity-30" />
              <p className="text-sm">اختر محادثة من القائمة للرد على العميل</p>
            </div>
          ) : threadLoading && !thread ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-gray-400">
              <Loader2 className="animate-spin" size={22} />
              <span className="text-sm">تحميل المحادثة...</span>
            </div>
          ) : thread ? (
            <>
              <header className="shrink-0 px-4 py-3 border-b border-gray-100 dark:border-gray-700/80 flex items-center gap-3">
                <button
                  type="button"
                  className="md:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                  onClick={() => setSelectedId(null)}
                  aria-label="رجوع"
                >
                  <ArrowRight size={20} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-bold text-gray-900 dark:text-white truncate">
                      {displayName(thread)}
                    </h2>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${platformAccent(
                        thread.platform
                      )}`}
                    >
                      {platformLabel(thread.platform)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
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
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      <Bot size={14} />
                      إعادة البوت
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={handleTakeOver}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      <UserRound size={14} />
                      تولي المحادثة
                    </button>
                  )}
                </div>
              </header>

              {thread.sourcePost && (
                <div className="shrink-0 mx-3 mt-2 mb-1 rounded-xl border border-brand/20 bg-brand-50/70 dark:bg-brand-900/20 dark:border-brand/30 px-3 py-2.5 flex items-start gap-3">
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700 flex-shrink-0 flex items-center justify-center text-brand">
                    {thread.sourcePost.thumbnailUrl ? (
                      <img
                        src={thread.sourcePost.thumbnailUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Megaphone size={18} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold text-brand">
                        {thread.sourcePost.sourceLabel}
                      </span>
                      {thread.sourcePost.productName && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/80 dark:bg-gray-900/60 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700">
                          منتج: {thread.sourcePost.productName}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-700 dark:text-gray-200 mt-0.5 line-clamp-2">
                      {thread.sourcePost.caption?.trim() ||
                        (thread.sourcePost.externalPostId
                          ? `منشور ${thread.sourcePost.externalPostId}`
                          : thread.sourcePost.adId
                            ? `إعلان ${thread.sourcePost.adId}`
                            : 'منشور مرتبط بهذه المحادثة')}
                    </p>
                  </div>
                  {thread.sourcePost.permalink && (
                    <a
                      href={thread.sourcePost.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline px-2 py-1"
                      title="فتح المنشور"
                    >
                      <ExternalLink size={13} />
                      فتح
                    </a>
                  )}
                </div>
              )}

              {threadError && (
                <div className="mx-4 mt-3 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">
                  {threadError}
                </div>
              )}

              <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-3">
                {thread.messages.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-12">لا رسائل في هذه المحادثة</p>
                ) : (
                  thread.messages.map((m, idx) => {
                    const customer = isCustomerMessage(m);
                    const human = isHumanAgentMessage(m);
                    const isLastOutbound =
                      !customer &&
                      idx ===
                        thread.messages
                          .map((x, i) => (!isCustomerMessage(x) ? i : -1))
                          .filter((i) => i >= 0)
                          .pop();
                    const read =
                      !!m.readAt || (!!outboundReadAt && isLastOutbound && !customer);
                    const displayContent =
                      m.content && m.content !== '📷 صورة' && m.content !== 'أرسل العميل صورة'
                        ? m.content
                        : '';
                    return (
                      <div
                        key={m.id}
                        className={`flex ${customer ? 'justify-start' : 'justify-end'}`}
                      >
                        <div
                          className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words ${
                            customer
                              ? 'bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-br-md'
                              : human
                                ? 'bg-brand text-white rounded-bl-md'
                                : 'bg-indigo-600 text-white rounded-bl-md'
                          }`}
                        >
                          {!customer && (
                            <div
                              className={`text-[10px] font-bold mb-1 opacity-80 ${
                                human ? 'text-white/90' : 'text-white/80'
                              }`}
                            >
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
                              customer ? 'text-gray-400' : 'text-white/70'
                            } ${customer ? '' : 'justify-end'}`}
                          >
                            <span>{formatRelative(m.createdAt || m.timestamp)}</span>
                            {!customer &&
                              (read ? (
                                <CheckCheck size={12} className="opacity-90" aria-label="مقروءة" />
                              ) : (
                                <Check size={12} className="opacity-70" aria-label="أُرسلت" />
                              ))}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                {customerTyping && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-br-md bg-gray-100 dark:bg-gray-900 px-3.5 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                      جاري الكتابة
                      <span className="inline-flex gap-0.5 ms-1">
                        <span className="animate-pulse">.</span>
                        <span className="animate-pulse [animation-delay:150ms]">.</span>
                        <span className="animate-pulse [animation-delay:300ms]">.</span>
                      </span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <footer className="shrink-0 p-3 border-t border-gray-100 dark:border-gray-700/80 bg-gray-50/80 dark:bg-gray-900/40">
                {pendingImage && (
                  <div className="mb-2 relative inline-block">
                    <img
                      src={pendingImage.preview}
                      alt="معاينة"
                      className="h-20 w-20 object-cover rounded-xl border border-gray-200 dark:border-gray-600"
                    />
                    <button
                      type="button"
                      onClick={() => setPendingImage(null)}
                      className="absolute -top-2 -left-2 p-1 rounded-full bg-gray-900 text-white shadow"
                      aria-label="إزالة الصورة"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="flex items-center gap-0.5 shrink-0 pb-1">
                    <EmojiPicker
                      onEmojiSelect={(emoji) => onDraftChange(draft + emoji)}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sending || uploadingImage}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                      aria-label="إرفاق صورة"
                    >
                      {uploadingImage ? (
                        <Loader2 size={20} className="animate-spin text-gray-500" />
                      ) : (
                        <ImagePlus size={20} className="text-gray-600 dark:text-gray-400" />
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
                    onChange={(e) => onDraftChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    rows={2}
                    placeholder="اكتب ردك للعميل... (Enter للإرسال)"
                    className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand"
                    disabled={sending}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || uploadingImage || (!draft.trim() && !pendingImage)}
                    className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand text-white font-bold text-sm hover:bg-brand-600 disabled:opacity-50 transition-colors"
                  >
                    {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    <span className="hidden sm:inline">إرسال</span>
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                  الإرسال يوقف البوت تلقائياً لهذه المحادثة ويصل للعميل على نفس القناة. الصور والإيموجي مدعومة على كل القنوات.
                </p>
              </footer>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-red-500 p-6">
              {threadError || 'تعذر فتح المحادثة'}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ConversationsInbox;
