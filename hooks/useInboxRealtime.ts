import { useEffect, useRef, useState } from 'react';

export type InboxStreamMessage = {
  id: string;
  role: string;
  content: string;
  senderType: string;
  source?: string | null;
  createdAt: string;
  imageUrl?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type InboxStreamConversation = {
  id: string;
  platform?: string | null;
  userId?: string | null;
  userName?: string | null;
  botDisabled?: boolean;
  status?: string | null;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  lastSenderType?: string | null;
};

export type InboxStreamEvent = {
  type: 'message' | 'conversation' | 'heartbeat' | 'connected' | 'typing' | 'read';
  merchantId: string;
  conversationId?: string;
  platform?: string | null;
  message?: InboxStreamMessage;
  conversation?: InboxStreamConversation;
  typing?: {
    conversationId: string;
    isTyping: boolean;
    from: 'merchant' | 'customer';
  };
  read?: {
    conversationId: string;
    reader: 'merchant' | 'customer';
    readAt: string;
    watermark?: number | null;
  };
  at?: string;
};

type Options = {
  enabled?: boolean;
  onEvent: (event: InboxStreamEvent) => void;
};

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'https://xo-bot.com/api';

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

/**
 * Merchant inbox realtime via SSE (fetch + stream).
 * Uses Authorization header (SaaS-safe; no token in URL).
 */
export function useInboxRealtime({ enabled = true, onEvent }: Options) {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let abort: AbortController | null = null;
    let attempt = 0;

    const connect = async () => {
      if (cancelled) return;
      const token = getAuthToken();
      if (!token) {
        setConnected(false);
        retryTimer = setTimeout(connect, 4000);
        return;
      }

      abort = new AbortController();
      try {
        const response = await fetch(`${API_BASE}/conversations/stream`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
          signal: abort.signal,
          cache: 'no-store',
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE HTTP ${response.status}`);
        }

        setConnected(true);
        attempt = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() || '';

          for (const chunk of chunks) {
            const lines = chunk.split('\n');
            let eventName = 'message';
            const dataLines: string[] = [];
            for (const line of lines) {
              if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim());
              }
            }
            if (dataLines.length === 0) continue;
            try {
              const payload = JSON.parse(dataLines.join('\n')) as InboxStreamEvent;
              if (eventName === 'heartbeat' || payload.type === 'heartbeat') continue;
              if (eventName === 'connected' || payload.type === 'connected') continue;
              onEventRef.current({ ...payload, type: (payload.type || eventName) as InboxStreamEvent['type'] });
            } catch {
              /* ignore malformed */
            }
          }
        }
      } catch (err: any) {
        if (cancelled || err?.name === 'AbortError') return;
        setConnected(false);
      } finally {
        setConnected(false);
        if (!cancelled) {
          attempt += 1;
          const delay = Math.min(1000 * 2 ** Math.min(attempt, 4), 15000);
          retryTimer = setTimeout(connect, delay);
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      abort?.abort();
      setConnected(false);
    };
  }, [enabled]);

  return { connected };
}
