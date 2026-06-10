'use client';

import { useEffect, useRef } from 'react';
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
  const processedRef = useRef(false);

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

    if (!('serviceWorker' in navigator)) {
      return () => window.removeEventListener('appchat:navigate', onNavigate);
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
    };
  }, [router]);

  // ── Cold-start notification tap: wait for hydrate before navigating ──
  useEffect(() => {
    if (!hydrated || processedRef.current) return;

    try {
      const pending = window.sessionStorage.getItem(REDIRECT_KEY);
      if (!pending) return;

      processedRef.current = true;

      if (user) {
        // Session is ready — consume the redirect and navigate immediately
        window.sessionStorage.removeItem(REDIRECT_KEY);
        router.push(pending);
      }
      // If user is null, leave redirect_to in sessionStorage.
      // AuthSessionSync will redirect to /login, save the current URL,
      // and after login the redirect_to will be restored from sessionStorage.
    } catch { /* ignore */ }
  }, [hydrated, user, router]);

  return null;
}
