import makeWASocket, {
  Browsers,
  DEFAULT_CONNECTION_CONFIG,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type ConnectionState,
  type WAMessage,
  type WAVersion
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { logger } from '../../utils/logger.js';
import { createPostgresAuthState } from './authState.js';
import { baileysLogger } from './baileysLogger.js';
import {
  handleWhatsAppWebCustomerMessage,
  handleWhatsAppWebMerchantPhoneMessage
} from './inbound.js';
import {
  formatDisplayPhone,
  phoneDigitsFromJid
} from './jid.js';
import {
  deleteMerchantRuntime,
  getMerchantRuntime,
  listMerchantRuntimes,
  setMerchantRuntime
} from './runtimeRegistry.js';
import {
  clearWhatsAppWebAuth,
  deleteWhatsAppWebSession,
  findMerchantByConnectedPhone,
  getWhatsAppWebSession,
  listRestorableMerchantIds,
  updateWhatsAppWebStatus,
  upsertWhatsAppWebSession
} from './sessionStore.js';
import type { MerchantWaRuntime, WhatsAppWebPairingEvent, WhatsAppWebStatus } from './types.js';

const MAX_RECONNECT_ATTEMPTS = 8;
const BASE_RECONNECT_MS = 2000;
const PAIRING_IDLE_MS = 2 * 60 * 1000;

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

function emit(runtime: MerchantWaRuntime, event: WhatsAppWebPairingEvent): void {
  for (const listener of runtime.pairingListeners) {
    try {
      listener(event);
    } catch (error) {
      logger.error('WhatsApp pairing listener failed', error as Error, {
        merchantId: runtime.merchantId
      });
    }
  }
}

function emitStatus(runtime: MerchantWaRuntime, message?: string): void {
  emit(runtime, {
    type: 'status',
    status: runtime.status,
    phoneNumber: runtime.phoneNumber,
    message
  });
}

function getOrCreateRuntime(merchantId: string): MerchantWaRuntime {
  const existing = getMerchantRuntime(merchantId);
  if (existing) return existing;
  const created: MerchantWaRuntime = {
    merchantId,
    generation: 0,
    sock: null,
    status: 'disconnected',
    qrDataUrl: null,
    phoneNumber: null,
    pairingListeners: new Set(),
    reconnectAttempts: 0,
    reconnectTimer: null,
    starting: false,
    sentMessageIds: new Set()
  };
  setMerchantRuntime(created);
  return created;
}

async function endSocket(runtime: MerchantWaRuntime): Promise<void> {
  const sock = runtime.sock;
  runtime.sock = null;
  if (!sock) return;
  try {
    await sock.end(undefined);
  } catch {
    /* already closed */
  }
}

async function applyStatus(
  runtime: MerchantWaRuntime,
  status: WhatsAppWebStatus,
  extras?: { phoneNumber?: string | null; reason?: string }
): Promise<void> {
  runtime.status = status;
  if (extras?.phoneNumber !== undefined) runtime.phoneNumber = extras.phoneNumber;
  const digits = phoneDigitsFromJid(runtime.phoneNumber || undefined) || null;
  try {
    await updateWhatsAppWebStatus({
      merchantId: runtime.merchantId,
      status,
      phoneNumber: runtime.phoneNumber,
      phoneDigits: digits,
      disconnectReason: extras?.reason || null
    });
  } catch (error) {
    logger.error('Failed to persist WhatsApp Web status', error as Error, {
      merchantId: runtime.merchantId,
      status
    });
  }
  emitStatus(runtime, extras?.reason);
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
    logger.warn('Using bundled WhatsApp Web version', {
      error: error instanceof Error ? error.message : String(error)
    });
    return DEFAULT_CONNECTION_CONFIG.version;
  }
}

export function subscribeWhatsAppPairing(
  merchantId: string,
  listener: (event: WhatsAppWebPairingEvent) => void
): () => void {
  const runtime = getOrCreateRuntime(merchantId);
  runtime.pairingListeners.add(listener);
  if (runtime.qrDataUrl && runtime.status === 'qr') {
    listener({ type: 'qr', qrDataUrl: runtime.qrDataUrl });
  } else {
    listener({
      type: 'status',
      status: runtime.status,
      phoneNumber: runtime.phoneNumber
    });
  }
  return () => {
    runtime.pairingListeners.delete(listener);
  };
}

export function getWhatsAppWebLiveStatus(merchantId: string): {
  status: WhatsAppWebStatus;
  phoneNumber: string | null;
  qrDataUrl: string | null;
} {
  const runtime = getMerchantRuntime(merchantId);
  if (!runtime) {
    return { status: 'disconnected', phoneNumber: null, qrDataUrl: null };
  }
  return {
    status: runtime.status,
    phoneNumber: runtime.phoneNumber,
    qrDataUrl: runtime.qrDataUrl
  };
}

async function openSocket(merchantId: string, allowQr: boolean): Promise<void> {
  const runtime = getOrCreateRuntime(merchantId);
  if (runtime.starting) return;
  runtime.starting = true;
  runtime.generation += 1;
  const generation = runtime.generation;

  if (runtime.reconnectTimer) {
    clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
  }

  await upsertWhatsAppWebSession(merchantId);
  await endSocket(runtime);

  try {
    const { state, saveCreds } = await createPostgresAuthState(merchantId);
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

    if (generation !== runtime.generation) {
      void sock.end(undefined);
      return;
    }

    runtime.sock = sock;
    runtime.status = 'connecting';

    sock.ev.on('creds.update', () => {
      void saveCreds();
    });

    sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      void onConnectionUpdate(merchantId, generation, allowQr, update);
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (generation !== runtime.generation) return;
      // Live inbound only. `append` is history/sync and must not drive the bot.
      if (type !== 'notify') return;
      for (const message of messages) {
        void dispatchInbound(merchantId, message);
      }
    });

    await applyStatus(runtime, 'connecting');
  } catch (error) {
    logger.error('Failed to open WhatsApp Web socket', error as Error, { merchantId });
    await applyStatus(runtime, 'disconnected', {
      reason: error instanceof Error ? error.message : 'socket_open_failed'
    });
    emit(runtime, {
      type: 'error',
      message: 'تعذر بدء جلسة واتساب. حاول مرة أخرى.'
    });
  } finally {
    if (generation === runtime.generation) {
      runtime.starting = false;
    }
  }
}

async function dispatchInbound(merchantId: string, message: WAMessage): Promise<void> {
  try {
    if (message.key?.fromMe) {
      await handleWhatsAppWebMerchantPhoneMessage(merchantId, message);
      return;
    }
    await handleWhatsAppWebCustomerMessage(merchantId, message);
  } catch (error) {
    logger.error('WhatsApp Web inbound dispatch failed', error as Error, { merchantId });
  }
}

async function onConnectionUpdate(
  merchantId: string,
  generation: number,
  allowQr: boolean,
  update: Partial<ConnectionState>
): Promise<void> {
  const runtime = getMerchantRuntime(merchantId);
  if (!runtime || runtime.generation !== generation) return;

  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    if (!allowQr) {
      logger.warn('WhatsApp session requires QR but restore mode forbids pairing', { merchantId });
      await applyStatus(runtime, 'logged_out', { reason: 'session_expired' });
      await clearWhatsAppWebAuth(merchantId, 'session_expired');
      await endSocket(runtime);
      return;
    }
    try {
      runtime.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      runtime.status = 'qr';
      await applyStatus(runtime, 'qr');
      emit(runtime, { type: 'qr', qrDataUrl: runtime.qrDataUrl });
    } catch (error) {
      logger.error('Failed to render WhatsApp QR', error as Error, { merchantId });
    }
    return;
  }

  if (connection === 'open') {
    const meId = runtime.sock?.user?.id || '';
    const phoneNumber = formatDisplayPhone(meId);
    const digits = phoneDigitsFromJid(meId);

    if (digits) {
      const owner = await findMerchantByConnectedPhone(digits, merchantId);
      if (owner) {
        logger.warn('WhatsApp number already linked to another merchant', {
          merchantId,
          owner
        });
        emit(runtime, {
          type: 'error',
          message: 'هذا الرقم مربوط بحساب تاجر آخر.'
        });
        try {
          await runtime.sock?.logout();
        } catch {
          /* ignore */
        }
        await clearWhatsAppWebAuth(merchantId, 'phone_already_linked');
        await endSocket(runtime);
        await applyStatus(runtime, 'logged_out', { reason: 'phone_already_linked' });
        return;
      }
    }

    runtime.qrDataUrl = null;
    runtime.reconnectAttempts = 0;
    await applyStatus(runtime, 'connected', { phoneNumber });
    logger.info('WhatsApp Web connected', { merchantId, phoneNumber });
    return;
  }

  if (connection === 'close') {
    const code = statusCodeOf(lastDisconnect?.error);
    runtime.qrDataUrl = null;
    await endSocket(runtime);

    if (isFatalDisconnect(code)) {
      await clearWhatsAppWebAuth(merchantId, `disconnect:${code}`);
      await applyStatus(runtime, 'logged_out', {
        reason: code === DisconnectReason.loggedOut ? 'logged_out' : `fatal:${code}`
      });
      emit(runtime, {
        type: 'error',
        message: 'تم إلغاء ربط واتساب من الهاتف. امسح رمز QR مجدداً.'
      });
      return;
    }

    await applyStatus(runtime, 'disconnected', { reason: `close:${code || 'unknown'}` });

    if (!allowQr && runtime.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.warn('WhatsApp reconnect attempts exhausted', { merchantId, code });
      return;
    }

    runtime.reconnectAttempts += 1;
    const delay = Math.min(
      60_000,
      BASE_RECONNECT_MS * 2 ** Math.min(runtime.reconnectAttempts - 1, 5)
    );
    runtime.reconnectTimer = setTimeout(() => {
      void openSocket(merchantId, allowQr);
    }, delay);
  }
}

export async function startWhatsAppWebPairing(merchantId: string): Promise<void> {
  const runtime = getOrCreateRuntime(merchantId);
  if (runtime.status === 'connected' && runtime.sock) return;
  runtime.reconnectAttempts = 0;
  await openSocket(merchantId, true);

  const generation = getOrCreateRuntime(merchantId).generation;
  setTimeout(() => {
    const current = getMerchantRuntime(merchantId);
    if (current && current.generation === generation && current.status === 'qr') {
      emit(current, {
        type: 'error',
        message: 'انتهت صلاحية رمز QR. أعد المحاولة.'
      });
      void endSocket(current);
      void applyStatus(current, 'disconnected', { reason: 'qr_timeout' });
    }
  }, PAIRING_IDLE_MS);
}

export async function disconnectWhatsAppWeb(merchantId: string): Promise<void> {
  const runtime = getOrCreateRuntime(merchantId);
  runtime.generation += 1;
  if (runtime.reconnectTimer) {
    clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
  }
  try {
    await runtime.sock?.logout();
  } catch {
    await endSocket(runtime);
  }
  await deleteWhatsAppWebSession(merchantId);
  runtime.qrDataUrl = null;
  runtime.phoneNumber = null;
  runtime.status = 'disconnected';
  emitStatus(runtime, 'disconnected_by_merchant');
  deleteMerchantRuntime(merchantId);
}

export async function restoreConnectedWhatsAppSessions(): Promise<void> {
  const merchantIds = await listRestorableMerchantIds();
  logger.info('Restoring WhatsApp Web sessions', { count: merchantIds.length });
  for (const merchantId of merchantIds) {
    try {
      const row = await getWhatsAppWebSession(merchantId);
      const runtime = getOrCreateRuntime(merchantId);
      runtime.phoneNumber = row?.phone_number || null;
      runtime.reconnectAttempts = 0;
      await openSocket(merchantId, false);
    } catch (error) {
      logger.error('Failed to restore WhatsApp Web session', error as Error, { merchantId });
    }
  }
}

export async function shutdownWhatsAppWebSessions(): Promise<void> {
  for (const runtime of listMerchantRuntimes()) {
    runtime.generation += 1;
    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
    await endSocket(runtime);
  }
}
