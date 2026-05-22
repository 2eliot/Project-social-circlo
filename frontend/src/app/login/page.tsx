'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/store/auth.store';

export default function LoginPage() {
  const router = useRouter();
  const { login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

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
      <form onSubmit={onSubmit} className="card max-w-sm w-full space-y-4">
        <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <input type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
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
