import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cloud.socialcircleinfo.app',
  appName: 'SocialCircle',
  webDir: 'out',
  server: {
    // En producción: carga la app desde el VPS
    url: 'https://socialcircleinfo.cloud/',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
