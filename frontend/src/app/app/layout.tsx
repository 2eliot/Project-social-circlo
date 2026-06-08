'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth.store';
import { VoiceOverlay } from '@/features/channels/VoiceOverlay';

const REDIRECT_KEY = 'appchat.redirect_to';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, hydrated, hydrate } = useAuth();

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  useEffect(() => {
    if (hydrated && !user) {
      // Guardar la ruta actual (con query params) antes de redirigir al login
      try {
        const currentUrl = window.location.pathname + window.location.search;
        if (currentUrl && currentUrl !== '/login') {
          window.sessionStorage.setItem(REDIRECT_KEY, currentUrl);
        }
      } catch { /* ignore */ }
      router.replace('/login');
    }
  }, [hydrated, user, router, pathname]);

  if (!hydrated) return <main className="min-h-screen flex items-center justify-center">Cargando…</main>;
  if (!user) return null;

  return (
    <>
      {children}
      {/* Global floating voice overlay — persists across navigation */}
      <VoiceOverlay />
    </>
  );
}

