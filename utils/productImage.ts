/**
 * Resize/compress a data URL so JSON POSTs stay under typical nginx limits (avoids HTTP 413).
 * Suitable for AI vision calls (product description, marketing reference, etc.).
 */
export function compressImageDataUrlForAI(
  dataUrl: string,
  maxEdge = 1024,
  quality = 0.72
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!dataUrl?.startsWith('data:')) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxEdge || h > maxEdge) {
        if (w > h) {
          h = Math.round((h * maxEdge) / w);
          w = maxEdge;
        } else {
          w = Math.round((w * maxEdge) / h);
          h = maxEdge;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to compress image'));
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = dataUrl;
  });
}

/** Fingerprint a stored image URL so replacements bust browser cache. */
function fingerprintImageRef(storedImageUrl: string): string {
  let h = 0;
  const s = storedImageUrl.trim();
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return String(Math.abs(h));
}

function normalizeCacheVersion(
  cacheVersion?: string | number | Date | null,
  storedImageUrl?: string | null
): string {
  if (cacheVersion instanceof Date && !Number.isNaN(cacheVersion.getTime())) {
    return String(cacheVersion.getTime());
  }
  if (typeof cacheVersion === 'number' && Number.isFinite(cacheVersion)) {
    return String(cacheVersion);
  }
  if (typeof cacheVersion === 'string' && cacheVersion.trim()) {
    const asDate = Date.parse(cacheVersion);
    if (!Number.isNaN(asDate)) return String(asDate);
    return cacheVersion.trim();
  }
  if (storedImageUrl?.trim() && !storedImageUrl.startsWith('data:')) {
    return fingerprintImageRef(storedImageUrl);
  }
  return '';
}

/**
 * Build a stable <img src> for product thumbnails.
 * Uses GET /api/products/:id/image so base64, /uploads/*, and remote URLs in DB all work.
 * Pass updatedAt (or any version) so edits invalidate browser / CDN cache.
 */
export function getProductImageDisplaySrc(
  productId: string | undefined,
  storedImageUrl: string | null | undefined,
  cacheVersion?: string | number | Date | null
): string {
  if (!storedImageUrl?.trim()) return '';
  if (storedImageUrl.startsWith('data:')) return storedImageUrl;
  // New product in the modal: no DB id yet — show remote URLs directly
  if (!productId) {
    if (/^https?:\/\//i.test(storedImageUrl)) return storedImageUrl;
    return '';
  }

  const viteApi = import.meta.env.VITE_API_URL ?? '/api';
  let origin: string;
  if (/^https?:\/\//i.test(viteApi)) {
    origin = new URL(viteApi).origin;
  } else if (typeof window !== 'undefined') {
    origin = window.location.origin;
  } else {
    return '';
  }

  const base = `${origin}/api/products/${productId}/image`;
  const v = normalizeCacheVersion(cacheVersion, storedImageUrl);
  return v ? `${base}?v=${encodeURIComponent(v)}` : base;
}
