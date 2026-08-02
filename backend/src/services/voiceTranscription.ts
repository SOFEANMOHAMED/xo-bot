/**
 * Voice Transcription Service
 *
 * Converts inbound customer voice/audio into text BEFORE the sales pipeline.
 * One shared ingress for Telegram / Messenger / Instagram / WhatsApp / web.
 *
 * Architecture:
 * - Managed OpenAI speech-to-text (default: gpt-transcribe, fallback: whisper-1)
 * - Local Whisper models are intentionally NOT used (RAM/CPU unfit for multi-tenant SaaS)
 * - Audio stays in-memory; never written to shared disk; always tagged with merchantId
 */

import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { logger } from '../utils/logger.js';

/** Preferred model; whisper-1 remains the automatic fallback. */
const PRIMARY_MODEL = process.env.WHISPER_MODEL || process.env.VOICE_STT_MODEL || 'gpt-transcribe';
const FALLBACK_MODEL = process.env.VOICE_STT_FALLBACK_MODEL || 'whisper-1';
/** OpenAI hard limit is 25MB; keep a safer ceiling for chat voice notes. */
const MAX_AUDIO_BYTES = Number(process.env.WHISPER_MAX_BYTES || 15 * 1024 * 1024);
const DOWNLOAD_TIMEOUT_MS = 20_000;
const TRANSCRIBE_TIMEOUT_MS = 45_000;

let client: OpenAI | null = null;

function readApiKey(): string {
  return (process.env.OPENAI_API_KEY || '').trim();
}

const getClient = (): OpenAI | null => {
  const apiKey = readApiKey();
  if (!apiKey) return null;
  if (!client) client = new OpenAI({ apiKey });
  return client;
};

export type VoicePlatform = 'telegram' | 'facebook_messenger' | 'instagram' | 'whatsapp' | 'web';

export interface TranscribeAudioParams {
  merchantId: string;
  platform: VoicePlatform;
  /** Remote media URL (Telegram file API, Meta CDN, …) */
  url?: string;
  /** Pre-fetched bytes (preferred when the caller already downloaded) */
  buffer?: Buffer;
  mimeType?: string;
  filename?: string;
  /**
   * Language hint — 'arabic' | 'english' | ISO-639-1.
   * Applied as languages[] for gpt-transcribe, or language= for whisper-1.
   */
  languageHint?: string;
  /** Extra vocabulary (product names, city names) — gpt-transcribe only */
  keywords?: string[];
  /** Auth / UA headers when the CDN requires them */
  downloadHeaders?: Record<string, string>;
}

export interface VoiceTranscriptionResult {
  text: string;
  language?: string;
  durationSec?: number;
  bytes: number;
  model: string;
}

export interface ResolveInboundVoiceParams extends TranscribeAudioParams {
  /** Existing caption / accompanying text, if any */
  existingText?: string;
}

export interface ResolveInboundVoiceResult {
  /** Text ready for the sales pipeline */
  messageText: string;
  transcribed: boolean;
  /** Caller should reply with fallback and stop the pipeline */
  shouldAbortWithFallback: boolean;
  transcript?: VoiceTranscriptionResult;
}

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  mp4: 'audio/mp4',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  webm: 'audio/webm',
  aac: 'audio/aac',
  flac: 'audio/flac'
};

function extensionFromMime(mime?: string): string {
  if (!mime) return 'ogg';
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base.includes('ogg') || base.includes('opus')) return 'ogg';
  if (base.includes('mpeg') || base.includes('mp3')) return 'mp3';
  if (base.includes('mp4') || base.includes('m4a')) return 'm4a';
  if (base.includes('wav')) return 'wav';
  if (base.includes('webm')) return 'webm';
  if (base.includes('aac')) return 'aac';
  if (base.includes('flac')) return 'flac';
  return 'ogg';
}

function guessMimeFromUrl(url: string): string | undefined {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const ext = path.split('.').pop() || '';
    return AUDIO_MIME_BY_EXT[ext];
  } catch {
    return undefined;
  }
}

function normalizeTranscript(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^["'«»]+|["'«»]+$/g, '')
    .trim();
}

function toIso6391(hint?: string): string | undefined {
  if (!hint) return undefined;
  const h = hint.trim().toLowerCase();
  if (h === 'arabic' || h === 'ar' || h.startsWith('ar-')) return 'ar';
  if (h === 'english' || h === 'en' || h.startsWith('en-')) return 'en';
  if (/^[a-z]{2}$/.test(h)) return h;
  return undefined;
}

/** E-commerce sales chat context — steers dialect/script without inventing words. */
function buildSalesVoicePrompt(platform: VoicePlatform, languageCode?: string): string {
  if (languageCode === 'en') {
    return (
      'Customer voice note to an online store sales assistant on ' +
      `${platform}. Short spoken order/product request. Prefer clear product names, ` +
      'colors, sizes, cities, phone numbers, and quantities.'
    );
  }
  return (
    'رسالة صوتية من عميل لمتجر إلكتروني على ' +
    `${platform}. طلب شراء أو استفسار عن منتج باللهجة المحكية. ` +
    'اكتب بالعربية الفصحى أو العامية كما نُطقت، مع أسماء المنتجات والألوان والمقاسات والمدن وأرقام الهاتف والكميات بوضوح.'
  );
}

function sanitizeKeywords(keywords?: string[]): string[] | undefined {
  if (!keywords?.length) return undefined;
  const cleaned = keywords
    .map(k => String(k || '').replace(/[<>\r\n]/g, ' ').trim())
    .filter(k => k.length >= 2 && k.length <= 64)
    .slice(0, 20);
  return cleaned.length ? cleaned : undefined;
}

function isModernSttModel(model: string): boolean {
  return model !== 'whisper-1' && !model.startsWith('whisper');
}

/**
 * Download audio bytes from a URL with size + timeout guards.
 */
export async function downloadAudioBuffer(
  url: string,
  opts?: {
    timeoutMs?: number;
    maxBytes?: number;
    headers?: Record<string, string>;
  }
): Promise<{ buffer: Buffer; mimeType?: string } | null> {
  const timeoutMs = opts?.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? MAX_AUDIO_BYTES;

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'XoBot-VoiceSTT/1.0',
        Accept: 'audio/*,*/*',
        ...(opts?.headers || {})
      }
    });
    if (!resp.ok) {
      logger.warn('voiceTranscription: audio download failed', {
        status: resp.status,
        urlPreview: url.substring(0, 120)
      });
      return null;
    }

    const contentLength = Number(resp.headers.get('content-length') || 0);
    if (contentLength > maxBytes) {
      logger.warn('voiceTranscription: audio too large (content-length)', {
        contentLength,
        maxBytes
      });
      return null;
    }

    const ab = await resp.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      logger.warn('voiceTranscription: audio too large (body)', {
        bytes: ab.byteLength,
        maxBytes
      });
      return null;
    }

    const mimeType = resp.headers.get('content-type') || guessMimeFromUrl(url);
    return { buffer: Buffer.from(ab), mimeType: mimeType || undefined };
  } catch (error) {
    logger.error('voiceTranscription: download error', error as Error, {
      urlPreview: url.substring(0, 120)
    });
    return null;
  }
}

async function callTranscriptionApi(
  ai: OpenAI,
  file: Awaited<ReturnType<typeof toFile>>,
  model: string,
  params: TranscribeAudioParams,
  languageCode?: string
): Promise<{ text: string; language?: string; duration?: number }> {
  const prompt = buildSalesVoicePrompt(params.platform, languageCode);
  const keywords = sanitizeKeywords(params.keywords);
  const modern = isModernSttModel(model);

  // Modern models: json + languages[]; whisper-1: verbose_json + language
  const body: Record<string, unknown> = {
    file,
    model,
    prompt,
    temperature: 0,
    response_format: modern ? 'json' : 'verbose_json'
  };

  if (modern) {
    body.languages = languageCode ? [languageCode, languageCode === 'ar' ? 'en' : 'ar'] : ['ar', 'en'];
    if (keywords) body.keywords = keywords;
  } else if (languageCode) {
    body.language = languageCode;
  }

  const transcription = await Promise.race([
    ai.audio.transcriptions.create(body as any),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Voice transcription timeout')), TRANSCRIBE_TIMEOUT_MS)
    )
  ]);

  const text = normalizeTranscript(
    typeof transcription === 'object' && transcription && 'text' in transcription
      ? String((transcription as { text?: string }).text || '')
      : String(transcription || '')
  );

  const verbose = transcription as {
    text?: string;
    language?: string;
    duration?: number;
    languages?: Array<{ code?: string } | string>;
  };

  let detected = verbose.language;
  if (!detected && Array.isArray(verbose.languages) && verbose.languages.length > 0) {
    const first = verbose.languages[0];
    detected = typeof first === 'string' ? first : first?.code;
  }

  return { text, language: detected, duration: verbose.duration };
}

/**
 * Transcribe customer audio with managed OpenAI STT.
 * Returns null when AI is unavailable or transcription fails.
 */
export async function transcribeAudio(
  params: TranscribeAudioParams
): Promise<VoiceTranscriptionResult | null> {
  const ai = getClient();
  if (!ai) {
    logger.warn('voiceTranscription: OPENAI_API_KEY not configured', {
      merchantId: params.merchantId,
      platform: params.platform
    });
    return null;
  }

  const start = Date.now();
  let buffer = params.buffer;
  let mimeType = params.mimeType;
  const languageCode = toIso6391(params.languageHint);

  if (!buffer) {
    if (!params.url) {
      logger.warn('voiceTranscription: missing url and buffer', {
        merchantId: params.merchantId
      });
      return null;
    }
    const downloaded = await downloadAudioBuffer(params.url, {
      headers: params.downloadHeaders
    });
    if (!downloaded) return null;
    buffer = downloaded.buffer;
    mimeType = mimeType || downloaded.mimeType;
  }

  if (!buffer.length) return null;

  const ext = extensionFromMime(mimeType);
  const filename =
    params.filename && params.filename.includes('.')
      ? params.filename
      : `voice-${params.merchantId.slice(0, 8)}.${ext}`;
  const fileType = mimeType || AUDIO_MIME_BY_EXT[ext] || 'audio/ogg';

  const modelsToTry = Array.from(
    new Set([PRIMARY_MODEL, FALLBACK_MODEL].filter(Boolean))
  );

  let lastError: unknown;
  for (const model of modelsToTry) {
    try {
      // Fresh File each attempt — previous upload may have consumed the stream.
      const file = await toFile(buffer, filename, { type: fileType });
      const result = await callTranscriptionApi(ai, file, model, params, languageCode);

      if (!result.text) {
        logger.warn('voiceTranscription: empty transcript', {
          merchantId: params.merchantId,
          platform: params.platform,
          model,
          bytes: buffer.length
        });
        continue;
      }

      logger.info('voiceTranscription: success', {
        merchantId: params.merchantId,
        platform: params.platform,
        model,
        bytes: buffer.length,
        language: result.language,
        durationSec: result.duration,
        latencyMs: Date.now() - start,
        textPreview: result.text.substring(0, 80)
      });

      return {
        text: result.text,
        language: result.language,
        durationSec: typeof result.duration === 'number' ? result.duration : undefined,
        bytes: buffer.length,
        model
      };
    } catch (error) {
      lastError = error;
      logger.warn('voiceTranscription: model failed, trying next', {
        merchantId: params.merchantId,
        platform: params.platform,
        model,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  logger.error('voiceTranscription: all STT models failed', lastError as Error, {
    merchantId: params.merchantId,
    platform: params.platform,
    bytes: buffer.length,
    latencyMs: Date.now() - start,
    tried: modelsToTry
  });
  return null;
}

/**
 * Unified ingress: voice/audio → pipeline-ready text (or abort signal for fallback reply).
 */
export async function resolveInboundVoice(
  params: ResolveInboundVoiceParams
): Promise<ResolveInboundVoiceResult> {
  const existing = (params.existingText || '').trim();
  const transcript = await transcribeAudio(params);

  if (transcript?.text) {
    return {
      messageText: existing ? `${transcript.text}\n${existing}` : transcript.text,
      transcribed: true,
      shouldAbortWithFallback: false,
      transcript
    };
  }

  if (!existing) {
    return {
      messageText: '',
      transcribed: false,
      shouldAbortWithFallback: true
    };
  }

  return {
    messageText: existing,
    transcribed: false,
    shouldAbortWithFallback: false
  };
}

/** User-facing fallback when voice cannot be understood. */
export function voiceTranscriptionFallbackMessage(
  language: 'arabic' | 'english' = 'arabic'
): string {
  return language === 'arabic'
    ? 'عذراً، ما قدرت أفهم الرسالة الصوتية بوضوح 🙏 ممكن تعيدها أو تكتبها نصاً؟'
    : "Sorry, I couldn't understand the voice message clearly 🙏 Please resend it or type it as text.";
}

export function isVoiceTranscriptionAvailable(): boolean {
  return !!readApiKey();
}
