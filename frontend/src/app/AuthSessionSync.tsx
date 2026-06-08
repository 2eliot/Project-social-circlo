'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth.store';

const REDIRECT_KEY = 'appchat.redirect_to';

export function AuthSessionSync({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, hydrated, hydrate } = useAuth();

  const [isWaitingNotification, setIsWaitingNotification] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Detectar si venimos de un inicio en frío por notificación push
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('from_notification') === 'true') {
      setIsWaitingNotification(true);
    }
  }, []);

  useEffect(() => {
    const syncSession = () => {
      void hydrate(true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncSession();
      }
    };

    window.addEventListener('pageshow', syncSession);
    window.addEventListener('popstate', syncSession);
    window.addEventListener('focus', syncSession);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('pageshow', syncSession);
      window.removeEventListener('popstate', syncSession);
      window.removeEventListener('focus', syncSession);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [hydrate]);

  // Handshake con el SW cuando venimos de notificación push en frío
  useEffect(() => {
    if (!hydrated || !isWaitingNotification) return;

    if (!user) {
      // No hay sesión — soltamos el flag y dejamos que el flujo normal redirija al login
      setIsWaitingNotification(false);
      return;
    }

    if (!('serviceWorker' in navigator)) {
      setIsWaitingNotification(false);
      return;
    }

    navigator.serviceWorker.ready
      .then((reg) => {
        if (reg.active) {
          reg.active.postMessage({ type: 'READY_FOR_DM' });
        }
      })
      .catch(() => { setIsWaitingNotification(false); });

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NAVIGATE_TO_NOTIFICATION' && event.data?.url) {
        setIsWaitingNotification(false);
        router.replace(event.data.url);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [hydrated, user, isWaitingNotification, router]);

  // Restaurar redirect_to pendiente Y redirección normal
  useEffect(() => {
    if (!hydrated || isWaitingNotification) return;

    if (!user) {
      // Guardar ruta actual antes de redirigir al login
      try {
        const currentUrl = window.location.pathname + window.location.search;
        if (currentUrl && currentUrl !== '/login') {
          window.sessionStorage.setItem(REDIRECT_KEY, currentUrl);
        }
      } catch { /* ignore */ }
      router.replace('/login');
      return;
    }

    let redirectTo: string | null = null;
    try {
      redirectTo = window.sessionStorage.getItem(REDIRECT_KEY);
    } catch { /* ignore */ }

    if (redirectTo) {
      const currentFullUrl = pathname + window.location.search;
      if (currentFullUrl !== redirectTo) {
        if (redirectTo.startsWith('/')) {
          window.sessionStorage.removeItem(REDIRECT_KEY);
          router.replace(redirectTo);
          return;
        }
        window.sessionStorage.removeItem(REDIRECT_KEY);
      }
    }

    if (pathname === '/' || pathname === '/login' || pathname === '/register') {
      router.replace('/app');
    }
  }, [hydrated, user, pathname, router, isWaitingNotification]);

  // Splash screen mientras se hidrata la sesión o se espera la ruta del SW
  if (!hydrated || isWaitingNotification) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 bg-[#0f0f1a]">
        <div
          className="w-32 h-32 bg-no-repeat bg-center bg-contain animate-pulse"
          style={{ backgroundImage: 'url(/icons/icon.svg)' }}
        />
        <div className="flex gap-2">
          <div className="w-2 h-2 rounded-full bg-[#7c5cff] animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-[#7c5cff] animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-[#7c5cff] animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
