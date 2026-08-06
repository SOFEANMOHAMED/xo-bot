/**
 * Shared PWA install prompt state so all InstallAppButton instances stay in sync.
 */

import {
  isIosDevice,
  isStandalonePwa,
  type BeforeInstallPromptEvent,
} from './pwaInstall';

export type PwaInstallSnapshot = {
  installed: boolean;
  canPrompt: boolean;
  isIos: boolean;
  showInstall: boolean;
};

type Listener = () => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<Listener>();
let listening = false;
let cachedSnapshot: PwaInstallSnapshot | null = null;

function buildSnapshot(): PwaInstallSnapshot {
  const isIos = typeof window !== 'undefined' ? isIosDevice() : false;
  if (typeof window !== 'undefined' && isStandalonePwa()) {
    installed = true;
  }
  return {
    installed,
    canPrompt: !!deferredPrompt,
    isIos,
    showInstall: !installed,
  };
}

function getOrUpdateSnapshot(): PwaInstallSnapshot {
  const next = buildSnapshot();
  if (
    cachedSnapshot &&
    cachedSnapshot.installed === next.installed &&
    cachedSnapshot.canPrompt === next.canPrompt &&
    cachedSnapshot.isIos === next.isIos &&
    cachedSnapshot.showInstall === next.showInstall
  ) {
    return cachedSnapshot;
  }
  cachedSnapshot = next;
  return cachedSnapshot;
}

function notify() {
  cachedSnapshot = null;
  listeners.forEach((fn) => fn());
}

function ensureWindowListeners() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  installed = isStandalonePwa();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

export function getPwaInstallSnapshot(): PwaInstallSnapshot {
  ensureWindowListeners();
  return getOrUpdateSnapshot();
}

export function subscribePwaInstall(listener: Listener): () => void {
  ensureWindowListeners();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function promptPwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  ensureWindowListeners();
  if (!deferredPrompt) return 'unavailable';
  try {
    const promptEvent = deferredPrompt;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    deferredPrompt = null;
    if (choice.outcome === 'accepted') {
      installed = true;
    }
    notify();
    return choice.outcome;
  } catch {
    deferredPrompt = null;
    notify();
    return 'unavailable';
  }
}
