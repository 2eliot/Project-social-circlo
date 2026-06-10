import { api } from './api-client';

const VAPID_PUBLIC_KEY = 'BHISlS7HQ-_rvtI5zYWsCIp1KDqc6n58_kcYiOcKEAZMPgiclv3lOW6VAoPdy5Vi4glWF-1QUo0iaEHV1MX5VEE';

// ── Detect if running inside Capacitor (native app) ──
function isCapacitor(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

// ═══════════════════════════════════════════════════════════════
// Web-Push helpers (browser / PWA)
// ═══════════════════════════════════════════════════════════════

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

async function subscribeWebPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('[Push] Web Push not supported');
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();

    if (existing) {
      const subJson = existing.toJSON();
      if (subJson.keys?.p256dh && subJson.keys?.auth) {
        await api('/push/subscribe', {
          method: 'POST',
          body: {
            endpoint: existing.endpoint,
            p256dh: subJson.keys.p256dh,
            auth: subJson.keys.auth,
            userAgent: navigator.userAgent,
          },
        });
        console.log('[Push] Web-push synced with server');
        return true;
      }
      await existing.unsubscribe();
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('[Push] Permission denied');
      return false;
    }

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

    console.log('[Push] Web-push subscribed');
    return true;
  } catch (err) {
    console.error('[Push] Web-push subscription error:', err);
    return false;
  }
}

async function unsubscribeWebPush(): Promise<boolean> {
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
    console.log('[Push] Web-push unsubscribed');
    return true;
  } catch (err) {
    console.error('[Push] Web-push unsubscribe error:', err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// FCM / Capacitor native push helpers
// ═══════════════════════════════════════════════════════════════

async function subscribeNativePush(): Promise<boolean> {
  try {
    // Dynamic import — won't fail if running in browser
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // Request permission
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') {
      console.log('[Push] Native permission denied');
      return false;
    }

    // ── Add listeners BEFORE register() ──
    // This ensures we catch the registration event even if it fires synchronously

    PushNotifications.addListener('registration', async (token) => {
      console.log('[Push] FCM token received:', token.value.substring(0, 20) + '...');
      try {
        await api('/push/fcm/subscribe', {
          method: 'POST',
          body: {
            fcmToken: token.value,
            platform: 'android',
          },
        });
        console.log('[Push] FCM token sent to server');
      } catch (err) {
        console.error('[Push] Failed to send FCM token to server:', err);
      }
    });

    PushNotifications.addListener('registrationError', (error) => {
      console.error('[Push] FCM registration error:', error);
    });

    // Handle incoming push when app is in foreground
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[Push] Foreground notification received:', notification);
      const url = notification.data?.url;
      if (url) {
        console.log('[Push] Navigating to:', url);
        // In foreground, use direct navigation — the app is alive
        window.location.replace(url);
      }
    });

    // Handle notification tap (app in background or killed)
    // IMPORTANT: When app is killed, the WebView may not be loaded yet,
    // so we store the URL in sessionStorage for NotificationClickHandler to pick up.
    // We ALSO try location.replace() as a fallback for when app is just backgrounded.
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[Push] Notification action performed:', JSON.stringify(action));
      const url = action.notification?.data?.url;
      console.log('[Push] URL from notification data:', url);
      if (url) {
        try {
          window.sessionStorage.setItem('appchat.redirect_to', url);
        } catch { /* ignore */ }
        // Direct navigation works when app is alive (backgrounded).
        // When killed, NotificationClickHandler will use the sessionStorage value.
        window.location.replace(url);
      }
    });

    // NOW register — listeners are already in place
    await PushNotifications.register();

    console.log('[Push] Native push registered');
    return true;
  } catch (err) {
    console.error('[Push] Native push error:', err);
    return false;
  }
}

async function unsubscribeNativePush(): Promise<boolean> {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // Get current token to unregister from backend
    // (Capacitor push-notifications doesn't expose the token directly,
    //  but we can unregister from the backend via the stored token later)
    // For now, just unregister from native
    await PushNotifications.removeAllListeners();
    console.log('[Push] Native push unregistered');
    return true;
  } catch (err) {
    console.error('[Push] Native unsubscribe error:', err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// Public API — auto-detects platform
// ═══════════════════════════════════════════════════════════════

export async function subscribeToPush(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (isCapacitor()) {
    console.log('[Push] Capacitor detected → using native FCM');
    return subscribeNativePush();
  }

  console.log('[Push] Browser detected → using web-push');
  return subscribeWebPush();
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (isCapacitor()) {
    return unsubscribeNativePush();
  }

  return unsubscribeWebPush();
}
