'use client';

import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Skip in development — DevServiceWorkerCleanup handles cleanup there
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return;

    void navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }, []);

  return null;
}
