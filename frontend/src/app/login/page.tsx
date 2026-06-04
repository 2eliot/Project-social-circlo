'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/store/auth.store';

export default function LoginPage() {
  const router = useRouter();
  const { login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [logoInfo, setLogoInfo] = useState<{ src: string; w: number; h: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogoInfo({ src: '/logo.png', w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setLogoInfo(null);
    img.src = '/logo.png';
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      router.push('/app');
    } catch (err: any) {
      setError('Credenciales inválidas');
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="max-w-sm w-full space-y-5">
        <div className="flex flex-col items-center w-full">
          {logoInfo ? (
            <div
              className="w-full max-w-[calc(100%-1.5rem)]"
              style={{
                aspectRatio: `${logoInfo.w} / ${logoInfo.h}`,
                maxHeight: '35vh',
                backgroundImage: `url(${logoInfo.src})`,
                backgroundSize: '100% 100%',
                backgroundRepeat: 'no-repeat',
              }}
            />
          ) : (
            <h1 className="text-2xl font-semibold text-center">Social Circle</h1>
          )}
        </div>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className="w-full" />
        <input type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" className="w-full" />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button type="submit" className="primary w-full" disabled={loading}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="text-sm opacity-70 text-center">
          ¿Tienes un código? <Link href="/register" className="underline">Regístrate</Link>
        </p>
      </form>
    </main>
  );
}
