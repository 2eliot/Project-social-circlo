'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth.store';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, hydrated, hydrate } = useAuth();

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  useEffect(() => {
    if (hydrated && !user) router.replace('/login');
  }, [hydrated, user, router]);

  if (!hydrated) return <main className="min-h-screen flex items-center justify-center">Cargando…</main>;
  if (!user) return null;

  return <>{children}</>;
}

