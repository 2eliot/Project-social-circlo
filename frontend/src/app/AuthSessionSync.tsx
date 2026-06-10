'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth.store';

const REDIRECT_KEY = 'appchat.redirect_to';

export function AuthSessionSync({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, hydrated, hydrate } = useAuth();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // ⏱ Safety timeout: force hydrated after 8s even if something hangs
  useEffect(() => {
    if (hydrated) return;
    const timer = setTimeout(() => {
      console.warn('[AuthSessionSync] Hydrate timeout — forcing hydrated=true');
      useAuth.setState({ hydrated: true });
    }, 8000);
    return () => clearTimeout(timer);
  }, [hydrated]);

  useEffect(() => {
    const syncSession = () => void hydrate(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncSession();
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

  // Guardia de autenticación + redirecciones
  useEffect(() => {
    if (!hydrated) return;

    // Páginas públicas que no requieren auth
    const publicPages = ['/login', '/register'];
    if (publicPages.includes(pathname)) {
      // Si ya está logueado en una página pública, ir al feed
      if (user) router.replace('/app');
      return;
    }

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

    // ✅ Ya logueado: si la URL trae un dm, NO redirigir — el chat lo leerá directo
    const params = new URLSearchParams(window.location.search);
    if (params.has('dm')) return;

    // Restaurar redirect_to pendiente
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

    // Si está en raíz (sin dm), ir al feed
    if (pathname === '/') {
      router.replace('/app');
    }
  }, [hydrated, user, pathname, router]);

  // Splash mientras hidrata
  if (!hydrated) {
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
