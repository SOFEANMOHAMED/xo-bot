import {
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  jidDecode,
  jidNormalizedUser
} from '@whiskeysockets/baileys';

/** Direct customer chats only (phone number or LID). */
export function isDirectCustomerJid(jid: string | undefined): boolean {
  if (!jid) return false;
  if (isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid) || isJidStatusBroadcast(jid)) {
    return false;
  }
  return Boolean(isPnUser(jid) || isLidUser(jid));
}

export function normalizeWhatsAppJid(jid: string | undefined): string {
  if (!jid) return '';
  try {
    return jidNormalizedUser(jid) || jid;
  } catch {
    return jid;
  }
}

export function phoneDigitsFromJid(jid: string | undefined): string {
  const decoded = jidDecode(jid);
  const user = decoded?.user || '';
  return user.replace(/\D/g, '');
}

export function formatDisplayPhone(jidOrDigits: string | undefined): string | null {
  const digits = (jidOrDigits || '').replace(/\D/g, '');
  if (!digits) return null;
  return `+${digits}`;
}

export function toOutboundJid(userId: string): string {
  const trimmed = (userId || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return `${digits}@s.whatsapp.net`;
}
