/**
 * Meta Pixel helpers for SPA navigation (initial PageView fires from /meta-pixel.js).
 */

export const META_PIXEL_ID = '2652720098511687';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: (...args: unknown[]) => void;
  }
}

export function trackMetaPageView(): void {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
  window.fbq('track', 'PageView');
}

/** Standard Meta event, e.g. Lead / CompleteRegistration / Purchase */
export function trackMetaEvent(
  eventName: string,
  params?: Record<string, unknown>
): void {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
  if (params) {
    window.fbq('track', eventName, params);
  } else {
    window.fbq('track', eventName);
  }
}
