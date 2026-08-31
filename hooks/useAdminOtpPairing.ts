import { useEffect, useRef, useState } from 'react';

export type AdminOtpPairingEvent =
  | { type: 'qr'; qrDataUrl: string }
  | {
      type: 'status';
      status: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out';
      phoneNumber?: string | null;
      message?: string;
    }
  | { type: 'error'; message: string }
  | { type: 'connected' }
  | { type: 'heartbeat' };

type Options = {
  enabled?: boolean;
  onEvent: (event: AdminOtpPairingEvent) => void;
};

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'https://xo-bot.com/api';

/** Super-admin platform WhatsApp QR pairing via SSE (cookie auth + admin gate). */
export function useAdminOtpPairing({ enabled = true, onEvent }: Options) {
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
      abort = new AbortController();
      try {
        const response = await fetch(`${API_BASE}/admin/otp/whatsapp/events`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'text/event-stream' },
          signal: abort.signal,
          cache: 'no-store'
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
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            if (dataLines.length === 0) continue;
            try {
              const payload = JSON.parse(dataLines.join('\n')) as AdminOtpPairingEvent;
              if (eventName === 'heartbeat' || payload.type === 'heartbeat') continue;
              if (
                payload.type === 'connected' &&
                eventName === 'connected' &&
                !('qrDataUrl' in payload) &&
                !('status' in payload)
              ) {
                continue;
              }
              onEventRef.current({
                ...payload,
                type: (payload.type || eventName) as AdminOtpPairingEvent['type']
              });
            } catch {
              /* ignore malformed */
            }
          }
        }
      } catch (err: unknown) {
        if (cancelled || (err as { name?: string })?.name === 'AbortError') return;
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
