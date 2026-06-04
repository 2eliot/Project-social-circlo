import type { Metadata, Viewport } from 'next';
import './globals.css';
import { DevServiceWorkerCleanup } from './DevServiceWorkerCleanup';
import { AuthSessionSync } from './AuthSessionSync';

export const metadata: Metadata = {
  title: 'Social Circle',
  description: 'Private invite-only social network',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Social Circle' },
};

export const viewport: Viewport = {
  themeColor: '#7c5cff',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <DevServiceWorkerCleanup />
        <AuthSessionSync />
        {children}
      </body>
    </html>
  );
}

