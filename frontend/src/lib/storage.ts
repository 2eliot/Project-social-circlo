/**
 * Native persistent storage using @capacitor/preferences (Android SharedPreferences).
 * Falls back to localStorage when Capacitor isn't available (dev/browser).
 *
 * This is the ONLY place that touches persistent storage.
 * The auth token and user session are stored here so they survive
 * Android process kills — unlike sessionStorage or in-memory state.
 *
 * ⚠️ All Capacitor Preferences calls race against a 3s timeout.
 * On Android, the native bridge may not be ready when the WebView first loads,
 * causing `prefs.get()` / `prefs.set()` to hang indefinitely and block hydration.
 * When a call times out, we fall back to localStorage (or return null for reads).
 */

const KEY_PREFIX = 'appchat.';
const PLUGIN_TIMEOUT_MS = 3000;

/** Detect if running inside Capacitor native (Android/iOS), not browser/PWA */
function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

/** Race a promise against a timeout — rejects with "timeout" if it takes too long */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ]);
}

let PreferencesModule: any = null;
let moduleLoaded = false;

async function getPreferences() {
  if (!moduleLoaded) {
    if (isCapacitorNative()) {
      try {
        const mod = await import('@capacitor/preferences');
        PreferencesModule = mod.Preferences;
      } catch {
        // Capacitor Preferences failed to load
      }
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
        const result: any = await withTimeout(
          prefs.get({ key: prefixed }),
          PLUGIN_TIMEOUT_MS,
        );
        const value = result?.value;
        if (value !== null && value !== undefined) return value;
      } catch (e: any) {
        console.warn('[storage] Capacitor Preferences get timed out or failed:', e?.message);
        // Fall through to localStorage
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
        await withTimeout(prefs.set({ key: prefixed, value }), PLUGIN_TIMEOUT_MS);
        return;
      } catch (e: any) {
        console.warn('[storage] Capacitor Preferences set timed out or failed:', e?.message);
        // Fall through to localStorage
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
        await withTimeout(prefs.remove({ key: prefixed }), PLUGIN_TIMEOUT_MS);
        return;
      } catch (e: any) {
        console.warn('[storage] Capacitor Preferences remove timed out or failed:', e?.message);
        // Fall through to localStorage
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
