'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const REDIRECT_KEY = 'appchat.redirect_to';

/**
 * Escucha mensajes del Service Worker (postMessage) cuando el usuario
 * hace clic en una notificación push y el SW no pudo hacer navigate().
 * También maneja redirects de Capacitor (FCM) almacenados en sessionStorage
 * cuando la app fue abierta desde estado "killed" por un tap en notificación.
 *
 * Antes de navegar, persiste la ruta en sessionStorage como redirect_to
 * para que si el guard de autenticación redirige al login, al volver
 * se restaure la navegación original.
 */
export function NotificationClickHandler() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // ── Capacitor: check for redirect stored by pushNotificationActionPerformed ──
    try {
      const pending = window.sessionStorage.getItem(REDIRECT_KEY);
      if (pending) {
        window.sessionStorage.removeItem(REDIRECT_KEY);
        // Small delay to let auth state settle
        setTimeout(() => router.push(pending), 100);
        return;
      }
    } catch { /* ignore */ }

    if (!('serviceWorker' in navigator)) return;

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
    };
  }, [router]);

  return null;
}
