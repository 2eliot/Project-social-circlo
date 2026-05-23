'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth.store';

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

  useEffect(() => {
    if (!hydrated || !user) return;
    if (pathname === '/' || pathname === '/login' || pathname === '/register') {
      router.replace('/app');
    }
  }, [hydrated, user, pathname, router]);

  return null;
}
