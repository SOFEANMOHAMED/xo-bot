/**
 * PWA install prompt helpers (Chrome/Android + iOS guidance).
 */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  );
}

export function isIosDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const iPadOs13 =
    window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOs13;
}

export function isLikelyInstallableBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  // Safari iOS has no beforeinstallprompt — still show install guidance
  if (isIosDevice()) return true;
  return 'serviceWorker' in navigator;
}
