/**
 * Per-conversation ingress queue
 *
 * Serializes bot turns per conversation and merges consecutive user
 * messages that arrive within a short debounce window (default 5s, range 4–6s)
 * into a single messageText before processing.
 *
 * SaaS: conversationKey MUST include merchant/tenant scope
 * (e.g. `${merchantId}:whatsapp:${userId}` or `fb:${pageId}:${psid}`).
 */

import { logger } from '../utils/logger.js';

/** Default merge window — middle of the 4–6s product range */
export const DEFAULT_INGRESS_DEBOUNCE_MS = 5000;
export const MIN_INGRESS_DEBOUNCE_MS = 4000;
export const MAX_INGRESS_DEBOUNCE_MS = 6000;

export interface IngressPart<TPayload = unknown> {
  text: string;
  externalMessageId?: string;
  receivedAt: number;
  payload: TPayload;
}

export interface IngressBatch<TPayload = unknown> {
  conversationKey: string;
  merchantId?: string;
  platform: string;
  parts: IngressPart<TPayload>[];
  /** Non-empty texts joined with newline, arrival order */
  mergedText: string;
  externalMessageIds: string[];
  latestPayload: TPayload;
  payloads: TPayload[];
}

export interface IngressEnqueueParams<TPayload = unknown, TResult = void> {
  conversationKey: string;
  merchantId?: string;
  platform: string;
  text?: string;
  externalMessageId?: string;
  payload: TPayload;
  /**
   * Debounce window. Default 5000.
   * Pass 0 to flush on the next microtask (no merge wait) while still serializing.
   * Values in (0, 4000) or >6000 are allowed only when explicitly set (tests).
   */
  debounceMs?: number;
  process: (batch: IngressBatch<TPayload>) => Promise<TResult>;
}

export interface IngressEnqueueResult<TResult = void> {
  conversationKey: string;
  queued: true;
  /** How many parts are buffered for this conversation after this enqueue */
  bufferedCount: number;
  processed: true;
  batchSize: number;
  result: TResult;
}

type Waiter<TResult = void> = {
  resolve: (value: IngressEnqueueResult<TResult>) => void;
  reject: (err: unknown) => void;
};

interface ConversationBucket<TPayload = unknown, TResult = void> {
  parts: IngressPart<TPayload>[];
  process: (batch: IngressBatch<TPayload>) => Promise<TResult>;
  merchantId?: string;
  platform: string;
  debounceMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  waiters: Waiter<TResult>[];
  seenExternalIds: Set<string>;
}

function resolveDebounceMs(explicit?: number): number {
  if (explicit === 0) return 0;
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit);
  }
  const fromEnv = Number(process.env.INGRESS_DEBOUNCE_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.min(MAX_INGRESS_DEBOUNCE_MS, Math.max(MIN_INGRESS_DEBOUNCE_MS, Math.round(fromEnv)));
  }
  return DEFAULT_INGRESS_DEBOUNCE_MS;
}

export function mergeIngressTexts(texts: string[]): string {
  return texts
    .map((t) => (t || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Merge Messenger / Instagram DM-style events:
 * latest event as base, union attachments, merged text.
 */
export function mergeMessengerStylePayloads<T extends Record<string, any>>(
  parts: IngressPart<T>[]
): T {
  const latest = structuredClone(parts[parts.length - 1].payload) as T;
  const mergedText = mergeIngressTexts(parts.map((p) => p.text));

  if (!latest.message) {
    (latest as any).message = {};
  }
  (latest as any).message.text = mergedText;

  const attachments: any[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const atts = (part.payload as any)?.message?.attachments;
    if (!Array.isArray(atts)) continue;
    for (const att of atts) {
      const key = `${att?.type || ''}:${att?.payload?.url || att?.payload?.attachment_id || JSON.stringify(att)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      attachments.push(att);
    }
  }
  if (attachments.length > 0) {
    (latest as any).message.attachments = attachments;
  }

  // Prefer last mid for channel APIs that key off message id; keep all mids on a side field
  const mids = parts.map((p) => p.externalMessageId).filter(Boolean) as string[];
  if (mids.length > 0) {
    (latest as any)._ingressExternalIds = mids;
    if (!(latest as any).message.mid && mids[mids.length - 1]) {
      (latest as any).message.mid = mids[mids.length - 1];
    }
  }

  return latest;
}

/**
 * Merge Telegram updates: latest update as base, pull photo/voice from any part.
 */
export function mergeTelegramUpdates<T extends Record<string, any>>(parts: IngressPart<T>[]): T {
  const latest = structuredClone(parts[parts.length - 1].payload) as T;
  const mergedText = mergeIngressTexts(parts.map((p) => p.text));

  if (!(latest as any).message) {
    (latest as any).message = {};
  }
  const msg = (latest as any).message;
  msg.text = mergedText;

  const withPhoto = [...parts]
    .reverse()
    .find((p) => Array.isArray((p.payload as any)?.message?.photo) && (p.payload as any).message.photo.length > 0);
  if (withPhoto && !msg.photo) {
    msg.photo = structuredClone((withPhoto.payload as any).message.photo);
    if (mergedText) msg.caption = mergedText;
  } else if (mergedText && msg.photo) {
    msg.caption = mergedText;
  }

  const withVoice = [...parts]
    .reverse()
    .find(
      (p) =>
        (p.payload as any)?.message?.voice ||
        (p.payload as any)?.message?.audio ||
        (p.payload as any)?.message?.video_note
    );
  if (withVoice) {
    const src = (withVoice.payload as any).message;
    if (!msg.voice && src.voice) msg.voice = structuredClone(src.voice);
    if (!msg.audio && src.audio) msg.audio = structuredClone(src.audio);
    if (!msg.video_note && src.video_note) msg.video_note = structuredClone(src.video_note);
  }

  (latest as any)._ingressExternalIds = parts
    .map((p) => p.externalMessageId)
    .filter(Boolean);

  return latest;
}

class ConversationIngressQueueImpl {
  private buckets = new Map<string, ConversationBucket<any>>();

  /**
   * Enqueue a user message for a conversation.
   * Resolves after the batch containing this message has been processed
   * (webhooks may ignore the promise; playground/tests can await it).
   * When several requests merge into one batch, every waiter receives the same process result.
   */
  enqueue<TPayload, TResult = void>(
    params: IngressEnqueueParams<TPayload, TResult>
  ): Promise<IngressEnqueueResult<TResult>> {
    const conversationKey = (params.conversationKey || '').trim();
    if (!conversationKey) {
      return Promise.reject(new Error('conversationKey is required for ingress queue'));
    }

    const debounceMs = resolveDebounceMs(params.debounceMs);
    const text = (params.text || '').trim();
    const externalMessageId = params.externalMessageId?.trim() || undefined;

    let bucket = this.buckets.get(conversationKey) as
      | ConversationBucket<TPayload, TResult>
      | undefined;
    if (!bucket) {
      bucket = {
        parts: [],
        process: params.process,
        merchantId: params.merchantId,
        platform: params.platform,
        debounceMs,
        timer: null,
        running: false,
        waiters: [],
        seenExternalIds: new Set()
      };
      this.buckets.set(conversationKey, bucket as ConversationBucket<any, any>);
    } else {
      // Always use the latest process callback / debounce for this key
      bucket.process = params.process;
      bucket.debounceMs = debounceMs;
      if (params.merchantId) bucket.merchantId = params.merchantId;
      bucket.platform = params.platform;
    }

    // Deduplicate webhook redeliveries inside the buffer
    if (externalMessageId && bucket.seenExternalIds.has(externalMessageId)) {
      logger.debug('Ingress queue: duplicate externalMessageId ignored', {
        conversationKey,
        externalMessageId,
        platform: params.platform
      });
      return Promise.resolve({
        conversationKey,
        queued: true,
        bufferedCount: bucket.parts.length,
        processed: true,
        batchSize: 0,
        result: undefined as TResult
      });
    }
    if (externalMessageId) {
      bucket.seenExternalIds.add(externalMessageId);
    }

    bucket.parts.push({
      text,
      externalMessageId,
      receivedAt: Date.now(),
      payload: params.payload
    });

    logger.info('Ingress queue: message buffered', {
      conversationKey,
      merchantId: bucket.merchantId,
      platform: bucket.platform,
      bufferedCount: bucket.parts.length,
      debounceMs: bucket.debounceMs,
      textLength: text.length,
      running: bucket.running
    });

    return new Promise((resolve, reject) => {
      bucket!.waiters.push({ resolve, reject });

      if (bucket!.running) {
        // Worker will schedule another debounce pass after it finishes
        return;
      }

      this.armTimer(conversationKey);
    });
  }

  /** Test / admin helper */
  async flushNow(conversationKey: string): Promise<void> {
    const bucket = this.buckets.get(conversationKey);
    if (!bucket) return;
    if (bucket.timer) {
      clearTimeout(bucket.timer);
      bucket.timer = null;
    }
    await this.drain(conversationKey);
  }

  stats(): { activeKeys: number; bufferedParts: number; runningKeys: number } {
    let bufferedParts = 0;
    let runningKeys = 0;
    for (const b of this.buckets.values()) {
      bufferedParts += b.parts.length;
      if (b.running) runningKeys += 1;
    }
    return { activeKeys: this.buckets.size, bufferedParts, runningKeys };
  }

  private armTimer(conversationKey: string): void {
    const bucket = this.buckets.get(conversationKey);
    if (!bucket || bucket.running) return;

    if (bucket.timer) {
      clearTimeout(bucket.timer);
      bucket.timer = null;
    }

    const delay = bucket.debounceMs;
    if (delay <= 0) {
      // Serialize without merge wait
      setImmediate(() => {
        void this.drain(conversationKey);
      });
      return;
    }

    bucket.timer = setTimeout(() => {
      bucket.timer = null;
      void this.drain(conversationKey);
    }, delay);
  }

  private async drain(conversationKey: string): Promise<void> {
    const bucket = this.buckets.get(conversationKey);
    if (!bucket || bucket.running) return;
    if (bucket.parts.length === 0) {
      this.maybeGc(conversationKey);
      return;
    }

    bucket.running = true;
    if (bucket.timer) {
      clearTimeout(bucket.timer);
      bucket.timer = null;
    }

    // Take current buffer atomically
    const parts = bucket.parts.splice(0, bucket.parts.length);
    const waiters = bucket.waiters.splice(0, bucket.waiters.length);
    // Keep seenExternalIds until after process to cover in-flight redeliveries;
    // prune ids from this batch after success.
    const batchExternalIds = parts
      .map((p) => p.externalMessageId)
      .filter(Boolean) as string[];

    const batch: IngressBatch = {
      conversationKey,
      merchantId: bucket.merchantId,
      platform: bucket.platform,
      parts,
      mergedText: mergeIngressTexts(parts.map((p) => p.text)),
      externalMessageIds: batchExternalIds,
      latestPayload: parts[parts.length - 1].payload,
      payloads: parts.map((p) => p.payload)
    };

    logger.info('Ingress queue: flushing conversation batch', {
      conversationKey,
      merchantId: batch.merchantId,
      platform: batch.platform,
      batchSize: parts.length,
      mergedLength: batch.mergedText.length,
    });

    try {
      const processResult = await bucket.process(batch);
      for (const w of waiters) {
        w.resolve({
          conversationKey,
          queued: true,
          bufferedCount: bucket.parts.length,
          processed: true,
          batchSize: parts.length,
          result: processResult
        });
      }
    } catch (err) {
      logger.error('Ingress queue: process failed', err as Error, {
        conversationKey,
        merchantId: batch.merchantId,
        platform: batch.platform,
        batchSize: parts.length
      });
      for (const w of waiters) {
        w.reject(err);
      }
    } finally {
      for (const id of batchExternalIds) {
        bucket.seenExternalIds.delete(id);
      }
      bucket.running = false;

      if (bucket.parts.length > 0) {
        // Messages arrived during processing — start a fresh merge window
        this.armTimer(conversationKey);
      } else {
        this.maybeGc(conversationKey);
      }
    }
  }

  private maybeGc(conversationKey: string): void {
    const bucket = this.buckets.get(conversationKey);
    if (!bucket) return;
    if (!bucket.running && bucket.parts.length === 0 && bucket.waiters.length === 0 && !bucket.timer) {
      this.buckets.delete(conversationKey);
    }
  }
}

/** Process-wide singleton (single PM2 worker). Multi-instance would need Redis. */
export const conversationIngressQueue = new ConversationIngressQueueImpl();
