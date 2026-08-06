import { useCallback, useSyncExternalStore } from 'react';
import {
  getPwaInstallSnapshot,
  promptPwaInstall,
  subscribePwaInstall,
} from '../utils/pwaInstallStore';

/**
 * Shared PWA install state (Chrome prompt + iOS guidance).
 */
export function usePwaInstall() {
  const state = useSyncExternalStore(
    subscribePwaInstall,
    getPwaInstallSnapshot,
    () => ({
      installed: false,
      canPrompt: false,
      isIos: false,
      showInstall: true,
    })
  );

  const promptInstall = useCallback(() => promptPwaInstall(), []);

  return { ...state, promptInstall };
}
