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

export const appStorage = {
  async get(key: string): Promise<string | null> {
    const prefixed = KEY_PREFIX + key;
    const prefs = await getPreferences();
    if (prefs) {
      try {
        const { value } = await prefs.get({ key: prefixed });
        if (value !== null && value !== undefined) return value;
      } catch {
        // Capacitor Preferences failed (e.g. "not implemented on web") — fall through to localStorage
      }
    }
    // Fallback for browser dev / safe fallback
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem(prefixed);
      } catch {
        // localStorage may throw in some environments
      }
    }
    return null;
  },

  async set(key: string, value: string): Promise<void> {
    const prefixed = KEY_PREFIX + key;
    const prefs = await getPreferences();
    if (prefs) {
      try {
        await prefs.set({ key: prefixed, value });
        return;
      } catch {
        // Capacitor Preferences failed — fall through to localStorage
      }
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(prefixed, value);
      } catch {
        // localStorage may throw (quota, privacy mode)
      }
    }
  },

  async remove(key: string): Promise<void> {
    const prefixed = KEY_PREFIX + key;
    const prefs = await getPreferences();
    if (prefs) {
      try {
        await prefs.remove({ key: prefixed });
        return;
      } catch {
        // Capacitor Preferences failed — fall through to localStorage
      }
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(prefixed);
      } catch {
        // localStorage may throw
      }
    }
  },
};
