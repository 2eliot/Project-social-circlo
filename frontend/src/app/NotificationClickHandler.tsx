'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth.store';

const REDIRECT_KEY = 'appchat.redirect_to';

/**
 * Escucha mensajes del Service Worker (postMessage) cuando el usuario
 * hace clic en una notificación push y el SW no pudo hacer navigate().
 * También maneja redirects de Capacitor (FCM) almacenados en sessionStorage
 * cuando la app fue abierta desde estado "killed" por un tap en notificación.
 *
 * ⚠️ ESPERA a que hydrate() termine antes de navegar.  Sin esto la navegación
 * ocurría 100ms después de montar el componente, cuando el access token aún no
 * se había restaurado de Capacitor Preferences, y todas las llamadas API
 * fallaban con 401 → el usuario veía el feed vacío.
 */
export function NotificationClickHandler() {
  const router = useRouter();
  const { hydrated, user } = useAuth();
  // Counter that ticks every time Capacitor stores a notification URL in
  // sessionStorage (via appchat:redirect-available).  We add it to the
  // cold-start effect's dependency array so it re-runs when the URL is
  // stored *after* hydrate has already completed.
  const [redirectCheckCounter, setRedirectCheckCounter] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // ── Capacitor: listen for custom navigate event from push-subscription.ts ──
    // (foreground notifications — auth ya está listo en este punto)
    const onNavigate = (e: Event) => {
      const url = (e as CustomEvent).detail?.url;
      if (url) {
        try {
          window.sessionStorage.removeItem(REDIRECT_KEY);
        } catch { /* ignore */ }
        router.push(url);
      }
    };
    window.addEventListener('appchat:navigate', onNavigate);

    // ── Capacitor cold-start: listen for "URL stored" signal ──
    // pushNotificationActionPerformed stores the URL first, then fires
    // this event so the cold-start effect below re-checks sessionStorage.
    const onRedirectAvailable = () => {
      setRedirectCheckCounter((c) => c + 1);
    };
    window.addEventListener('appchat:redirect-available', onRedirectAvailable);

    if (!('serviceWorker' in navigator)) {
      return () => {
        window.removeEventListener('appchat:navigate', onNavigate);
        window.removeEventListener('appchat:redirect-available', onRedirectAvailable);
      };
    }

    // ── Web push: listen for postMessage from service worker ──
    const onMessage = (event: MessageEvent) => {
      if (
        (event.data?.type === 'NOTIFICATION_CLICK' || event.data?.type === 'NOTIFICATION_CLICKED') &&
        event.data?.url
      ) {
        try {
          window.sessionStorage.setItem(REDIRECT_KEY, event.data.url);
        } catch { /* ignore */ }
        router.push(event.data.url);
      }
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      window.removeEventListener('appchat:navigate', onNavigate);
      window.removeEventListener('appchat:redirect-available', onRedirectAvailable);
    };
  }, [router]);

  // ── Cold-start notification tap: wait for hydrate before navigating ──
  // Re-runs when hydrated, user, or redirectCheckCounter changes (the
  // latter ticks when Capacitor stores a URL AFTER hydrate is done).
  useEffect(() => {
    if (!hydrated) return;

    let pending: string | null = null;
    try {
      pending = window.sessionStorage.getItem(REDIRECT_KEY);
    } catch { /* ignore */ }

    if (!pending) return;

    if (user) {
      // Session is ready — consume the redirect and navigate immediately.
      // Use replace (not push) to win the race against AuthSessionSync's
      // feed redirect which runs in the same React render cycle.
      try {
        window.sessionStorage.removeItem(REDIRECT_KEY);
      } catch { /* ignore */ }
      router.replace(pending);
    }
    // If user is null, leave redirect_to in sessionStorage.
    // AuthSessionSync will redirect to /login, save the current URL,
    // and after login the redirect_to will be restored from sessionStorage.
  }, [hydrated, user, router, redirectCheckCounter]);

  return null;
}
