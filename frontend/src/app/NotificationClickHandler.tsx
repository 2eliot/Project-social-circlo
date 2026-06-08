'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const REDIRECT_KEY = 'appchat.redirect_to';

/**
 * Escucha mensajes del Service Worker (postMessage) cuando el usuario
 * hace clic en una notificación push y el SW no pudo hacer navigate().
 * Hace router.push() client-side para navegar al chat/canal correcto.
 *
 * Antes de navegar, persiste la ruta en sessionStorage como redirect_to
 * para que si el guard de autenticación redirige al login, al volver
 * se restaure la navegación original.
 */
export function NotificationClickHandler() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK' && event.data?.url) {
        // Persistir la ruta destino antes de navegar
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
