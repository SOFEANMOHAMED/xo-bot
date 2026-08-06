/**
 * Shared helpers for inbox message media + public URLs (SaaS-safe).
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export type InboxMessageMetadata = {
  type?: 'text' | 'image';
  imageUrl?: string | null;
  mimeType?: string | null;
  readAt?: string | null;
  deliveredAt?: string | null;
  [key: string]: unknown;
};

export function publicSiteOrigin(): string {
  const raw =
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_URL ||
    (process.env.CORS_ORIGIN || 'https://xo-bot.com').split(',')[0] ||
    'https://xo-bot.com';
  return raw.trim().replace(/\/$/, '').replace(/\/api$/i, '');
}

/** Ensure Meta/Telegram can fetch media (absolute https URL on public host). */
export function toPublicMediaUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  const value = String(pathOrUrl).trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    // Fix accidental /api/uploads paths
    return value.replace(/^(https?:\/\/[^/]+)\/api\/uploads\//i, '$1/uploads/');
  }
  const origin = publicSiteOrigin();
  const path = value.startsWith('/') ? value : `/${value}`;
  return `${origin}${path}`;
}

export function buildInboxMetadata(
  base: Record<string, unknown> | null | undefined,
  extras: InboxMessageMetadata
): InboxMessageMetadata {
  return {
    ...(base || {}),
    ...extras,
  };
}

export function extractImageUrlFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const url = m.imageUrl || m.image_url;
  return typeof url === 'string' && url.startsWith('http') ? url : null;
}

function extensionFromMime(mimeType?: string | null): string {
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'jpg';
}

/**
 * Persist inbound channel image under merchant-scoped uploads (no cross-tenant paths).
 * Returns a public absolute URL safe to store in message metadata / show in inbox.
 */
export async function persistInboundImageBuffer(params: {
  merchantId: string;
  buffer: Buffer;
  mimeType?: string | null;
  source?: string;
}): Promise<string | null> {
  const merchantId = String(params.merchantId || '').trim();
  if (!merchantId || !params.buffer?.length) return null;

  const uploadRoot = process.env.UPLOAD_DIR || 'uploads';
  const source = (params.source || 'inbox').replace(/[^a-z0-9_-]/gi, '') || 'inbox';
  const dir = path.join(uploadRoot, merchantId, 'inbox-inbound', source);
  await fs.mkdir(dir, { recursive: true });

  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${extensionFromMime(params.mimeType)}`;
  await fs.writeFile(path.join(dir, filename), params.buffer);

  const relativePath = `/uploads/${merchantId}/inbox-inbound/${source}/${filename}`;
  return toPublicMediaUrl(relativePath);
}
