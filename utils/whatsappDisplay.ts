/**
 * Frontend mirror of WhatsApp PN JID → display phone.
 * Used when inbox rows still have placeholder userName.
 */

export function phoneDisplayFromWhatsAppUserId(
  userId: string | null | undefined
): string | null {
  const raw = String(userId || '').trim();
  if (!raw) return null;

  const jidMatch = raw.match(/^(\d{8,})@s\.whatsapp\.net$/i);
  if (jidMatch) return `+${jidMatch[1]}`;

  if (/^\+\d{8,}$/.test(raw)) return raw;
  if (/^\d{8,}$/.test(raw)) return `+${raw}`;

  return null;
}

export function isWhatsAppPhoneLabel(name: string | null | undefined): boolean {
  const n = String(name || '').trim();
  return /^\+?\d{8,}$/.test(n);
}

export function normalizeWhatsAppPhoneLabel(name: string): string {
  const digits = name.replace(/\D/g, '');
  return digits ? `+${digits}` : name.trim();
}
