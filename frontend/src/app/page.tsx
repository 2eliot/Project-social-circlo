'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function Home() {
  const [logoInfo, setLogoInfo] = useState<{ src: string; w: number; h: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogoInfo({ src: '/logo.png', w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setLogoInfo(null);
    img.src = '/logo.png';
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        {logoInfo ? (
          <div
            className="w-full mx-auto"
            style={{
              aspectRatio: `${logoInfo.w} / ${logoInfo.h}`,
              maxWidth: 'calc(100% - 1.5rem)',
              maxHeight: '35vh',
              backgroundImage: `url(${logoInfo.src})`,
              backgroundSize: '100% 100%',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
            }}
          />
        ) : (
          <h1 className="text-3xl font-bold mb-6">Social Circle</h1>
        )}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mt-6">
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
