'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Escucha mensajes del Service Worker (postMessage) cuando el usuario
 * hace clic en una notificación push y el SW no pudo hacer navigate().
 * Hace router.push() client-side para navegar al chat/canal correcto.
 */
export function NotificationClickHandler() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK' && event.data?.url) {
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
