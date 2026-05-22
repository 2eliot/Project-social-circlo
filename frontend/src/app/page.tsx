import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card max-w-md w-full text-center">
        <h1 className="text-3xl font-bold mb-2">Appchat</h1>
        <p className="text-sm opacity-70 mb-6">Red social privada por invitación.</p>
        <div className="flex gap-3 justify-center">
          <Link href="/login" className="primary inline-block" style={{ background: '#7c5cff', color: 'white', padding: '.55rem 1rem', borderRadius: '.55rem' }}>
            Iniciar sesión
          </Link>
          <Link href="/register" className="inline-block" style={{ border: '1px solid #2a3142', padding: '.55rem 1rem', borderRadius: '.55rem' }}>
            Tengo un código
          </Link>
        </div>
      </div>
    </main>
  );
}
