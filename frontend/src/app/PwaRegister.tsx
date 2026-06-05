'use client';

import { useEffect } from 'react';
import { subscribeToPush } from '@/lib/push-subscription';

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Skip in development — DevServiceWorkerCleanup handles cleanup there
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return;

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('[PwaRegister] SW registered');

        // Wait for the SW to be ready, then subscribe to push
        await navigator.serviceWorker.ready;
        await subscribeToPush();
      } catch (err) {
        console.error('[PwaRegister] SW registration or push subscribe failed:', err);
      }
    })();
  }, []);

  return null;
}
