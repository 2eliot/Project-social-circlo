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

  if (!hydrated) return (
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
  if (!user) return null;

  return (
    <>
      {children}
      {/* Global floating voice overlay — persists across navigation */}
      <VoiceOverlay />
    </>
  );
}

