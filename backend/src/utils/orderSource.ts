/**
 * Canonical order-channel sources stored on orders.source.
 * Used when persisting bot orders and when rendering merchant-facing labels.
 */

export const ORDER_CHANNEL_SOURCES = [
  'facebook',
  'instagram',
  'telegram',
  'whatsapp',
  'shopify',
  'manual',
] as const;

export type OrderChannelSource = (typeof ORDER_CHANNEL_SOURCES)[number];

const CHANNEL_ALIASES: Record<string, OrderChannelSource> = {
  facebook: 'facebook',
  facebook_messenger: 'facebook',
  facebook_comment: 'facebook',
  messenger: 'facebook',
  instagram: 'instagram',
  telegram: 'telegram',
  whatsapp: 'whatsapp',
  shopify: 'shopify',
  manual: 'manual',
};

const SOURCE_LABELS_AR: Record<string, string> = {
  facebook: 'فيسبوك',
  instagram: 'إنستغرام',
  telegram: 'تيليجرام',
  whatsapp: 'واتساب',
  shopify: 'Shopify',
  manual: 'يدوي',
  playground: 'تجربة البوت',
  web: 'الموقع',
  bot: 'بوت',
};

function inferChannelFromNotes(notes?: string | null): OrderChannelSource | null {
  if (!notes) return null;
  const n = notes.toLowerCase();
  if (n.includes('instagram')) return 'instagram';
  if (n.includes('facebook') || n.includes('messenger')) return 'facebook';
  if (n.includes('telegram')) return 'telegram';
  if (n.includes('whatsapp')) return 'whatsapp';
  return null;
}

/**
 * Normalize a conversation/interaction platform into the value stored on orders.source.
 */
export function resolveOrderChannelSource(
  platform?: string | null,
  notes?: string | null
): string {
  const key = (platform || '').trim().toLowerCase();
  if (key && CHANNEL_ALIASES[key]) return CHANNEL_ALIASES[key];
  const inferred = inferChannelFromNotes(notes);
  if (inferred) return inferred;
  if (key && key !== 'bot') return key;
  return 'bot';
}

export function getOrderSourceLabel(source?: string | null, notes?: string | null): string {
  const key = (source || '').trim();
  if (!key && !notes) return SOURCE_LABELS_AR.manual;
  const resolved = resolveOrderChannelSource(source, notes);
  return SOURCE_LABELS_AR[resolved] || resolved || SOURCE_LABELS_AR.manual;
}
