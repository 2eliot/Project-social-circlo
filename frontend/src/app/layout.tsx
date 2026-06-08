import type { Metadata } from 'next';
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

import { NotificationClickHandler } from './NotificationClickHandler';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
        <meta name="theme-color" content="#7c5cff" />
      </head>
      <body>
        <DevServiceWorkerCleanup />
        <PwaRegister />
        <AuthSessionSync>
          <NotificationClickHandler />
          {children}
        </AuthSessionSync>
      </body>
    </html>
  );
}

