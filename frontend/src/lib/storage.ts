/**
 * Native persistent storage using @capacitor/preferences (Android SharedPreferences).
 * Falls back to localStorage when Capacitor isn't available (dev/browser).
 *
 * This is the ONLY place that touches persistent storage.
 * The auth token and user session are stored here so they survive
 * Android process kills — unlike sessionStorage or in-memory state.
 */

const KEY_PREFIX = 'appchat.';

let PreferencesModule: any = null;
let moduleLoaded = false;

async function getPreferences() {
  if (!moduleLoaded) {
    try {
      const mod = await import('@capacitor/preferences');
      PreferencesModule = mod.Preferences;
    } catch {
      // Capacitor not available (SSR or browser dev)
    }
    moduleLoaded = true;
  }
  return PreferencesModule;
}

function isCapacitor(): boolean {
  return typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
}

export const appStorage = {
  async get(key: string): Promise<string | null> {
    const prefixed = KEY_PREFIX + key;
    const prefs = await getPreferences();
    if (prefs) {
      const { value } = await prefs.get({ key: prefixed });
      return value ?? null;
    }
    // Fallback for browser dev
    if (typeof window !== 'undefined') {
      return localStorage.getItem(prefixed);
    }
    return null;
  },

  async set(key: string, value: string): Promise<void> {
    const prefixed = KEY_PREFIX + key;
    const prefs = await getPreferences();
    if (prefs) {
      await prefs.set({ key: prefixed, value });
    } else if (typeof window !== 'undefined') {
      localStorage.setItem(prefixed, value);
    }
  },

  async remove(key: string): Promise<void> {
    const prefixed = KEY_PREFIX + key;
    const prefs = await getPreferences();
    if (prefs) {
      await prefs.remove({ key: prefixed });
    } else if (typeof window !== 'undefined') {
      localStorage.removeItem(prefixed);
    }
  },
};
