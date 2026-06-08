'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth.store';

const REDIRECT_KEY = 'appchat.redirect_to';

export function AuthSessionSync() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, hydrated, hydrate } = useAuth();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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

  // Restaurar redirect_to pendiente cuando el usuario se autentica
  useEffect(() => {
    if (!hydrated || !user) return;

    let redirectTo: string | null = null;
    try {
      redirectTo = window.sessionStorage.getItem(REDIRECT_KEY);
    } catch { /* ignore */ }

    if (redirectTo && pathname !== redirectTo) {
      // Validar que sea una ruta interna válida (empieza con /)
      if (redirectTo.startsWith('/')) {
        window.sessionStorage.removeItem(REDIRECT_KEY);
        router.replace(redirectTo);
        return;
      }
      // Ruta inválida — limpiar y caer a fallback seguro
      window.sessionStorage.removeItem(REDIRECT_KEY);
    }

    if (pathname === '/' || pathname === '/login' || pathname === '/register') {
      router.replace('/app');
    }
  }, [hydrated, user, pathname, router]);

  return null;
}
