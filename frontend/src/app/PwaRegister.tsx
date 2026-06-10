'use client';

import { useEffect } from 'react';
import { subscribeToPush } from '@/lib/push-subscription';

function isCapacitor(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // In Capacitor (native app), go straight to push subscription
    // FCM works via Capacitor plugin, not Service Worker
    if (isCapacitor()) {
      console.log('[PwaRegister] Capacitor detected → subscribing native push');
      void subscribeToPush();
      return;
    }

    // In browser/PWA, we need Service Worker for web-push
    if (!('serviceWorker' in navigator)) return;
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
