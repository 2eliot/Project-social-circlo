'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/store/auth.store';
import { ApiError } from '@/lib/api-client';

export default function RegisterPage() {
  const router = useRouter();
  const { register, loading } = useAuth();
  const [form, setForm] = useState({
    invitationCode: '',
    email: '',
    password: '',
    displayName: '',
    legalName: '',
    dateOfBirth: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  function bind<K extends keyof typeof form>(key: K) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { invitationCode } = await register({
        ...form,
        invitationCode: form.invitationCode.trim().toUpperCase(),
      });
      setIssuedCode(invitationCode || null);
      // Give the user a moment to see their own invite code, then go in.
      setTimeout(() => router.push('/app'), 2500);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) setError('Código inválido, agotado o conflicto. Reintenta.');
        else if (err.status === 400) setError('Datos inválidos (revisa edad ≥ 18 y formato del código).');
        else setError('Error inesperado. Reintenta.');
      } else setError('Error de red.');
    }
  }

  if (issuedCode) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <h2 className="text-xl font-semibold">¡Bienvenido!</h2>
          <p className="opacity-70 mb-4">Este es tu código personal (máx. 3 usos):</p>
          <div className="text-3xl font-mono tracking-widest bg-black/30 rounded p-3">{issuedCode}</div>
          <p className="text-sm opacity-60 mt-4">Redirigiendo…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="max-w-sm w-full space-y-5">
        <h1 className="text-2xl font-semibold text-center">Crear cuenta</h1>
        <input
          placeholder="Código de invitación (6 chars)"
          maxLength={6}
          {...bind('invitationCode')}
          style={{ textTransform: 'uppercase', letterSpacing: '.2em', fontFamily: 'monospace' }}
          required
        />
        <input type="email" placeholder="Email" {...bind('email')} required autoComplete="email" />
        <input type="password" placeholder="Contraseña (mín. 10)" {...bind('password')} required minLength={10} autoComplete="new-password" />
        <input placeholder="Nombre público (display)" {...bind('displayName')} required />
        <input placeholder="Nombre legal (privado, encriptado)" {...bind('legalName')} required />
        <label className="text-sm opacity-70">Fecha de nacimiento (debes ser mayor de 18)</label>
        <input type="date" {...bind('dateOfBirth')} required />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button type="submit" className="primary w-full" disabled={loading}>
          {loading ? 'Creando…' : 'Crear cuenta'}
        </button>
        <p className="text-sm opacity-70 text-center">
          ¿Ya tienes cuenta? <Link href="/login" className="underline">Inicia sesión</Link>
        </p>
      </form>
    </main>
  );
}
