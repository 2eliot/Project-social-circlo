import type { Metadata, Viewport } from 'next';
import './globals.css';
import { DevServiceWorkerCleanup } from './DevServiceWorkerCleanup';

export const metadata: Metadata = {
  title: 'Appchat',
  description: 'Private invite-only social network',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Appchat' },
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
        {children}
      </body>
    </html>
  );
}
