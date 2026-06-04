import type { Metadata, Viewport } from 'next';
import './globals.css';
import { DevServiceWorkerCleanup } from './DevServiceWorkerCleanup';
import { PwaRegister } from './PwaRegister';
import { AuthSessionSync } from './AuthSessionSync';

export const metadata: Metadata = {
  title: 'Social Circle',
  description: 'Red social privada exclusiva — solo por invitación',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Social Circle' },
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/icon.svg',
    shortcut: '/icons/icon.svg',
  },
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
        <PwaRegister />
        <AuthSessionSync />
        {children}
      </body>
    </html>
  );
}

