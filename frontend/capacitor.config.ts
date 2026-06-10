import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cloud.socialcircleinfo.app',
  appName: 'SocialCircle',
  webDir: 'out',
  server: {
    // En producción: carga directo desde el frontend container (sin dominio)
    url: 'http://74.208.253.67:3001/',
    cleartext: true,
    androidScheme: 'http',
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
