/**
 * Web Push / PWA helpers for merchant notifications.
 */

export { isStandalonePwa } from './pwaInstall';
import { isStandalonePwa } from './pwaInstall';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return registration;
  } catch (err) {
    console.error('Service worker registration failed', err);
    return null;
  }
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription> {
  if (!isPushSupported()) {
    throw new Error('المتصفح لا يدعم إشعارات الدفع');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('تم رفض إذن الإشعارات. فعّله من إعدادات المتصفح أو الجهاز.');
  }

  const registration = (await registerServiceWorker()) || (await navigator.serviceWorker.ready);
  if (!registration) {
    throw new Error('تعذر تسجيل Service Worker');
  }

  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    return existing;
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
}

export async function unsubscribeFromPush(): Promise<string | null> {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}

export function subscriptionToJSON(subscription: PushSubscription): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime: number | null;
} {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('اشتراك الإشعارات غير صالح');
  }
  return {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    expirationTime: json.expirationTime ?? null,
  };
}
