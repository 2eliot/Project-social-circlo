import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cloud.socialcircleinfo.app',
  appName: 'SocialCircle',
  webDir: 'out',
  server: {
    // En producción: HTTPS con dominio para que cookies HttpOnly funcionen
    url: 'https://socialcircleinfo.cloud/',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
