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

/**
 * Build a stable <img src> for product thumbnails.
 * Uses GET /api/products/:id/image so base64, /uploads/*, and remote URLs in DB all work.
 */
export function getProductImageDisplaySrc(
  productId: string | undefined,
  storedImageUrl: string | null | undefined
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

  return `${origin}/api/products/${productId}/image`;
}
