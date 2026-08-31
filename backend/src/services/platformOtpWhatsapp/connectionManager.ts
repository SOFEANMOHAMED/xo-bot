import makeWASocket, {
  Browsers,
  DEFAULT_CONNECTION_CONFIG,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type ConnectionState,
  type WAVersion
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { logger } from '../../utils/logger.js';
import { baileysLogger } from '../whatsappWeb/baileysLogger.js';
import {
  formatDisplayPhone,
  phoneDigitsFromJid,
  toOutboundJid
} from '../whatsappWeb/jid.js';
import { createPlatformPostgresAuthState } from './authState.js';
import { ensureSignupOtpSchema } from './schema.js';
import {
  clearPlatformWhatsAppAuth,
  deletePlatformWhatsAppSession,
  getPlatformWhatsAppSession,
  isPlatformSessionRestorable,
  updatePlatformWhatsAppStatus,
  upsertPlatformWhatsAppSession
} from './sessionStore.js';
import type { PlatformWaPairingEvent, PlatformWaRuntime, PlatformWaStatus } from './types.js';

const MAX_RECONNECT_ATTEMPTS = 8;
const BASE_RECONNECT_MS = 2000;
const PAIRING_IDLE_MS = 2 * 60 * 1000;

let runtime: PlatformWaRuntime | null = null;

function getOrCreateRuntime(): PlatformWaRuntime {
  if (!runtime) {
    runtime = {
      generation: 0,
      sock: null,
      status: 'disconnected',
      qrDataUrl: null,
      phoneNumber: null,
      pairingListeners: new Set(),
      reconnectAttempts: 0,
      reconnectTimer: null,
      starting: false
    };
  }
  return runtime;
}

function emit(event: PlatformWaPairingEvent): void {
  const rt = getOrCreateRuntime();
  for (const listener of rt.pairingListeners) {
    try {
      listener(event);
    } catch (error) {
      logger.error('Platform WA pairing listener failed', error as Error);
    }
  }
}

function emitStatus(message?: string): void {
  const rt = getOrCreateRuntime();
  emit({
    type: 'status',
    status: rt.status,
    phoneNumber: rt.phoneNumber,
    message
  });
}

function statusCodeOf(error: unknown): number | undefined {
  const boom = error as { output?: { statusCode?: number } };
  return boom?.output?.statusCode;
}

function isFatalDisconnect(code: number | undefined): boolean {
  return (
    code === DisconnectReason.loggedOut ||
    code === DisconnectReason.forbidden ||
    code === DisconnectReason.badSession ||
    code === DisconnectReason.multideviceMismatch
  );
}

async function endSocket(rt: PlatformWaRuntime): Promise<void> {
  const sock = rt.sock;
  rt.sock = null;
  if (!sock) return;
  try {
    await sock.end(undefined);
  } catch {
    /* already closed */
  }
}

async function applyStatus(
  rt: PlatformWaRuntime,
  status: PlatformWaStatus,
  extras?: { phoneNumber?: string | null; reason?: string }
): Promise<void> {
  rt.status = status;
  if (extras?.phoneNumber !== undefined) rt.phoneNumber = extras.phoneNumber;
  const digits = phoneDigitsFromJid(rt.phoneNumber || undefined) || null;
  try {
    await updatePlatformWhatsAppStatus({
      status,
      phoneNumber: rt.phoneNumber,
      phoneDigits: digits,
      disconnectReason: extras?.reason || null
    });
  } catch (error) {
    logger.error('Failed to persist platform WhatsApp status', error as Error, { status });
  }
  emitStatus(extras?.reason);
}

async function resolveWaVersion(): Promise<WAVersion> {
  try {
    const result = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('baileys_version_timeout')), 8000);
      })
    ]);
    return result.version;
  } catch (error) {
    logger.warn('Platform WA using bundled version', {
      error: error instanceof Error ? error.message : String(error)
    });
    return DEFAULT_CONNECTION_CONFIG.version;
  }
}

async function onConnectionUpdate(
  generation: number,
  allowQr: boolean,
  update: Partial<ConnectionState>
): Promise<void> {
  const rt = getOrCreateRuntime();
  if (rt.generation !== generation) return;

  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    if (!allowQr) {
      await applyStatus(rt, 'logged_out', { reason: 'session_expired' });
      await clearPlatformWhatsAppAuth('session_expired');
      await endSocket(rt);
      return;
    }
    try {
      rt.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      rt.status = 'qr';
      await applyStatus(rt, 'qr');
      emit({ type: 'qr', qrDataUrl: rt.qrDataUrl });
    } catch (error) {
      logger.error('Failed to render platform WhatsApp QR', error as Error);
    }
    return;
  }

  if (connection === 'open') {
    const meId = rt.sock?.user?.id || '';
    const phoneNumber = formatDisplayPhone(meId);
    rt.qrDataUrl = null;
    rt.reconnectAttempts = 0;
    await applyStatus(rt, 'connected', { phoneNumber });
    logger.info('Platform OTP WhatsApp connected', { phoneNumber });
    return;
  }

  if (connection === 'close') {
    const code = statusCodeOf(lastDisconnect?.error);
    rt.qrDataUrl = null;
    await endSocket(rt);

    if (isFatalDisconnect(code)) {
      await clearPlatformWhatsAppAuth(`disconnect:${code}`);
      await applyStatus(rt, 'logged_out', {
        reason: code === DisconnectReason.loggedOut ? 'logged_out' : `fatal:${code}`
      });
      emit({
        type: 'error',
        message: 'تم إلغاء ربط واتساب من الهاتف. امسح رمز QR مجدداً.'
      });
      return;
    }

    await applyStatus(rt, 'disconnected', { reason: `close:${code || 'unknown'}` });

    if (!allowQr && rt.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      return;
    }

    rt.reconnectAttempts += 1;
    const delay = Math.min(
      60_000,
      BASE_RECONNECT_MS * 2 ** Math.min(rt.reconnectAttempts - 1, 5)
    );
    rt.reconnectTimer = setTimeout(() => {
      void openSocket(allowQr);
    }, delay);
  }
}

async function openSocket(allowQr: boolean): Promise<void> {
  await ensureSignupOtpSchema();
  const rt = getOrCreateRuntime();
  if (rt.starting) return;
  rt.starting = true;
  rt.generation += 1;
  const generation = rt.generation;

  if (rt.reconnectTimer) {
    clearTimeout(rt.reconnectTimer);
    rt.reconnectTimer = null;
  }

  await upsertPlatformWhatsAppSession();
  await endSocket(rt);

  try {
    const { state, saveCreds } = await createPlatformPostgresAuthState();
    const version = await resolveWaVersion();
    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger)
      },
      logger: baileysLogger,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      qrTimeout: 60_000
    });

    if (generation !== rt.generation) {
      void sock.end(undefined);
      return;
    }

    rt.sock = sock;
    rt.status = 'connecting';

    sock.ev.on('creds.update', () => {
      void saveCreds();
    });

    sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      void onConnectionUpdate(generation, allowQr, update);
    });

    await applyStatus(rt, 'connecting');
  } catch (error) {
    logger.error('Failed to open platform WhatsApp socket', error as Error);
    await applyStatus(rt, 'disconnected', {
      reason: error instanceof Error ? error.message : 'socket_open_failed'
    });
    emit({
      type: 'error',
      message: 'تعذر بدء جلسة واتساب. حاول مرة أخرى.'
    });
  } finally {
    if (generation === rt.generation) {
      rt.starting = false;
    }
  }
}

export function subscribePlatformWhatsAppPairing(
  listener: (event: PlatformWaPairingEvent) => void
): () => void {
  const rt = getOrCreateRuntime();
  rt.pairingListeners.add(listener);
  if (rt.qrDataUrl && rt.status === 'qr') {
    listener({ type: 'qr', qrDataUrl: rt.qrDataUrl });
  } else {
    listener({
      type: 'status',
      status: rt.status,
      phoneNumber: rt.phoneNumber
    });
  }
  return () => {
    rt.pairingListeners.delete(listener);
  };
}

export function getPlatformWhatsAppLiveStatus(): {
  status: PlatformWaStatus;
  phoneNumber: string | null;
  qrDataUrl: string | null;
} {
  const rt = runtime;
  if (!rt) {
    return { status: 'disconnected', phoneNumber: null, qrDataUrl: null };
  }
  return {
    status: rt.status,
    phoneNumber: rt.phoneNumber,
    qrDataUrl: rt.qrDataUrl
  };
}

export async function startPlatformWhatsAppPairing(): Promise<void> {
  const rt = getOrCreateRuntime();
  if (rt.status === 'connected' && rt.sock) return;
  rt.reconnectAttempts = 0;
  await openSocket(true);

  const generation = rt.generation;
  setTimeout(() => {
    const current = getOrCreateRuntime();
    if (current.generation === generation && current.status === 'qr') {
      emit({
        type: 'error',
        message: 'انتهت صلاحية رمز QR. أعد المحاولة.'
      });
      void endSocket(current);
      void applyStatus(current, 'disconnected', { reason: 'qr_timeout' });
    }
  }, PAIRING_IDLE_MS);
}

export async function disconnectPlatformWhatsApp(): Promise<void> {
  const rt = getOrCreateRuntime();
  rt.generation += 1;
  if (rt.reconnectTimer) {
    clearTimeout(rt.reconnectTimer);
    rt.reconnectTimer = null;
  }
  try {
    await rt.sock?.logout();
  } catch {
    await endSocket(rt);
  }
  await deletePlatformWhatsAppSession();
  rt.qrDataUrl = null;
  rt.phoneNumber = null;
  rt.status = 'disconnected';
  emitStatus('disconnected_by_admin');
  runtime = null;
}

export async function restorePlatformWhatsAppSession(): Promise<void> {
  await ensureSignupOtpSchema();
  if (!(await isPlatformSessionRestorable())) return;
  const row = await getPlatformWhatsAppSession();
  const rt = getOrCreateRuntime();
  rt.phoneNumber = row?.phone_number || null;
  rt.reconnectAttempts = 0;
  await openSocket(false);
}

export async function shutdownPlatformWhatsApp(): Promise<void> {
  if (!runtime) return;
  runtime.generation += 1;
  if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
  await endSocket(runtime);
}

export function isPlatformWhatsAppConnected(): boolean {
  return getOrCreateRuntime().status === 'connected';
}

export async function sendPlatformWhatsAppText(phone: string, text: string): Promise<boolean> {
  const rt = getOrCreateRuntime();
  if (!rt.sock || rt.status !== 'connected') return false;
  const jid = toOutboundJid(phone);
  const body = (text || '').trim();
  if (!jid || !body) return false;

  try {
    await rt.sock.sendMessage(jid, { text: body });
    return true;
  } catch (error) {
    logger.error('Platform OTP WhatsApp send failed', error as Error, { jid });
    return false;
  }
}
