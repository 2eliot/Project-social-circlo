import { api } from './api-client';

const VAPID_PUBLIC_KEY = 'BHISlS7HQ-_rvtI5zYWsCIp1KDqc6n58_kcYiOcKEAZMPgiclv3lOW6VAoPdy5Vi4glWF-1QUo0iaEHV1MX5VEE';

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

export async function subscribeToPush(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('[Push] Push not supported');
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();

    if (existing) {
      // Already subscribed — check if still valid
      const subJson = existing.toJSON();
      if (subJson.keys?.p256dh && subJson.keys?.auth) {
        // Re-sync with backend (idempotent)
        await api('/push/subscribe', {
          method: 'POST',
          body: {
            endpoint: existing.endpoint,
            p256dh: subJson.keys.p256dh,
            auth: subJson.keys.auth,
            userAgent: navigator.userAgent,
          },
        });
        console.log('[Push] Subscription already active, synced with server');
        return true;
      }
      // Invalid subscription, unsubscribe
      await existing.unsubscribe();
    }

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('[Push] Permission denied');
      return false;
    }

    // Subscribe
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
    });

    const subJson = subscription.toJSON();
    await api('/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: subscription.endpoint,
        p256dh: subJson.keys!.p256dh,
        auth: subJson.keys!.auth,
        userAgent: navigator.userAgent,
      },
    });

    console.log('[Push] Subscribed successfully');
    return true;
  } catch (err) {
    console.error('[Push] Subscription error:', err);
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;

    await api('/push/unsubscribe', {
      method: 'DELETE',
      body: { endpoint: subscription.endpoint },
    });

    await subscription.unsubscribe();
    console.log('[Push] Unsubscribed');
    return true;
  } catch (err) {
    console.error('[Push] Unsubscribe error:', err);
    return false;
  }
}
