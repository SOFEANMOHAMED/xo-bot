/**
 * Resolve product upload src (relative path or public HTTPS URL) to local bytes.
 * Shared by HTTP image serving fallbacks and WhatsApp Web outbound (Baileys).
 */

import fs from 'fs';
import path from 'path';

export type LocalUploadMedia = {
  buffer: Buffer;
  mimetype: string;
  localPath: string;
};

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const EXT_FALLBACKS = ['.webp', '.jpg', '.jpeg', '.png', '.gif', '.meta.jpg'] as const;

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' && filePath.toLowerCase().endsWith('.meta.jpg')) {
    return 'image/jpeg';
  }
  return MIME_BY_EXT[ext] || 'image/jpeg';
}

function uploadsRoot(): string {
  return path.resolve(process.cwd(), 'uploads');
}

function isUnderUploads(absolutePath: string): boolean {
  const root = uploadsRoot();
  return absolutePath === root || absolutePath.startsWith(root + path.sep);
}

/** Prefer an existing file; if missing, try common image extensions on the same stem. */
export function resolveExistingUploadFile(absolutePath: string): string | null {
  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
    return absolutePath;
  }
  const ext = path.extname(absolutePath);
  const stem = ext ? absolutePath.slice(0, -ext.length) : absolutePath;
  for (const candidateExt of EXT_FALLBACKS) {
    const candidate = stem + candidateExt;
    if (candidate === absolutePath) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/**
 * Map DB/public image src to candidate paths under ./uploads (tenant-safe).
 * Supports:
 * - /uploads/... and uploads/...
 * - https://host/uploads/{merchantId}/file.ext (full path, not basename-only)
 * - data:image/... (handled by readUploadSrcMedia)
 */
export function uploadSrcToLocalCandidates(
  imageSrc: string,
  merchantId?: string | null
): string[] {
  const trimmed = imageSrc.trim();
  if (!trimmed || trimmed.startsWith('data:image/')) return [];

  let relative: string | null = null;

  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/')) {
    relative = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  } else if (/^https?:\/\//i.test(trimmed)) {
    try {
      const urlPath = decodeURIComponent(new URL(trimmed).pathname);
      if (urlPath.startsWith('/uploads/')) {
        relative = urlPath.slice(1);
      }
    } catch {
      return [];
    }
  }

  if (!relative) return [];

  const candidates: string[] = [path.resolve(process.cwd(), relative)];
  if (merchantId) {
    const underMerchant = path.resolve(
      process.cwd(),
      'uploads',
      merchantId,
      path.basename(relative)
    );
    if (!candidates.includes(underMerchant)) candidates.push(underMerchant);
  }

  return candidates.filter(isUnderUploads);
}

/**
 * Read local bytes for an upload src. Never switches to a different gallery image —
 * only the same path stem (with optional extension repair).
 */
export function readUploadSrcMedia(
  imageSrc: string,
  merchantId?: string | null
): LocalUploadMedia | null {
  const trimmed = imageSrc.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:image/')) {
    const match = trimmed.match(/^data:image\/([^;]+);base64,(.+)$/);
    if (!match?.[2]) return null;
    return {
      buffer: Buffer.from(match[2], 'base64'),
      mimetype: `image/${match[1]}`,
      localPath: 'data-url',
    };
  }

  for (const candidate of uploadSrcToLocalCandidates(trimmed, merchantId)) {
    const existing = resolveExistingUploadFile(candidate);
    if (!existing) continue;
    return {
      buffer: fs.readFileSync(existing),
      mimetype: mimeFromPath(existing),
      localPath: existing,
    };
  }

  return null;
}
