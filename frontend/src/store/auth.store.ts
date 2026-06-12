'use client';

import { create } from 'zustand';
import { api, getAccessToken, setAccessToken, restoreAccessToken, setRefreshToken, restoreRefreshToken } from '@/lib/api-client';
import { appStorage } from '@/lib/storage';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  globalRole: 'SUPER_ADMIN' | 'GLOBAL_MODERATOR' | 'USER';
  isVerifiedModerator: boolean;
  badges: string[];
}

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<{ invitationCode: string }>;
  logout: () => Promise<void>;
  hydrate: (force?: boolean) => Promise<void>;
  updateUser: (patch: Partial<SessionUser>) => void;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  legalName: string;
  dateOfBirth: string;
  invitationCode: string;
}

let hydratePromise: Promise<void> | null = null;
const SESSION_USER_STORAGE_KEY = 'sessionUser';

async function persistSessionUser(user: SessionUser | null) {
  if (typeof window === 'undefined') return;
  if (user) await appStorage.set(SESSION_USER_STORAGE_KEY, JSON.stringify(user));
  else await appStorage.remove(SESSION_USER_STORAGE_KEY);
}

async function readSessionUser(): Promise<SessionUser | null> {
  if (typeof window === 'undefined') return null;
  const raw = await appStorage.get(SESSION_USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    await appStorage.remove(SESSION_USER_STORAGE_KEY);
    return null;
  }
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  hydrated: false,
  async updateUser(patch) {
    const user = get().user ? { ...get().user!, ...patch } : null;
    set({ user });
    await persistSessionUser(user);
  },
  async login(email, password) {
    set({ loading: true });
    try {
      const res = await api<{ user: SessionUser; accessToken: string; refreshToken: string }>('/auth/login', {
        method: 'POST',
        body: { email, password },
        skipAuth: true,
      });
      setAccessToken(res.accessToken);
      if (res.refreshToken) setRefreshToken(res.refreshToken);
      await persistSessionUser(res.user);
      set({ user: res.user });
    } finally {
      set({ loading: false });
    }
  },
  async register(input) {
    set({ loading: true });
    try {
      const res = await api<{ user: SessionUser & { invitationCode?: string }; accessToken: string; refreshToken: string }>(
        '/auth/register',
        { method: 'POST', body: input, skipAuth: true },
      );
      setAccessToken(res.accessToken);
      if (res.refreshToken) setRefreshToken(res.refreshToken);
      await persistSessionUser(res.user);
      set({ user: res.user });
      return { invitationCode: (res.user as any).invitationCode ?? '' };
    } finally {
      set({ loading: false });
    }
  },
  async logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    // Await BOTH storage removals before updating state.
    // Otherwise the Capacitor Preferences bridge may not finish
    // clearing before the redirect happens, and on next cold start
    // hydrate() reads stale tokens → auto-login with broken session.
    await Promise.all([
      setAccessToken(null),
      setRefreshToken(null),
      persistSessionUser(null),
    ]);
    set({ user: null });
  },
  async hydrate(force = false) {
    if (get().hydrated && !force) return;
    // If a previous hydrate attempt failed (rejected promise), reset so we retry.
    // ALSO: add a 7s safety timeout so we never wait on a stuck promise forever.
    if (hydratePromise) {
      try {
        await Promise.race([
          hydratePromise,
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('hydrate-stale')), 7000),
          ),
        ]);
        return;
      } catch {
        // Previous hydrate failed or timed out — reset and retry
        hydratePromise = null;
      }
    }
    hydratePromise = (async () => {
      try {
        // Restore token from native storage into memory FIRST.
        // Each Capacitor Preferences call races against a 3s timeout in storage.ts,
        // so these will throw instead of hanging indefinitely.
        const storedToken = await restoreAccessToken();
        const storedRefresh = await restoreRefreshToken();
        const storedUser = await readSessionUser();

        // If we have a stored user, set it immediately regardless of token state.
        // The token might be expired — API interceptor will refresh it on first 401.
        // NEVER clear the user here; only logout() does that.
        if (storedUser) {
          set({ user: storedUser, hydrated: true });
          // If token is missing, try to get one in background (no big deal if fails)
          if (!storedToken && storedRefresh) {
            try {
              const res = await api<{ user: SessionUser; accessToken: string; refreshToken: string }>('/auth/refresh', {
                method: 'POST',
                skipAuth: true,
              });
              setAccessToken(res.accessToken);
              if (res.refreshToken) setRefreshToken(res.refreshToken);
              await persistSessionUser(res.user);
            } catch {
              // Refresh failed, but user stays logged in.
              // Next API call will try refresh again transparently.
            }
          }
          return;
        }

        // No stored user at all — try refresh with stored token to see if session exists
        if (storedRefresh) {
          try {
            const res = await api<{ user: SessionUser; accessToken: string; refreshToken: string }>('/auth/refresh', {
              method: 'POST',
              skipAuth: true,
            });
            setAccessToken(res.accessToken);
            if (res.refreshToken) setRefreshToken(res.refreshToken);
            await persistSessionUser(res.user);
            set({ user: res.user });
          } catch {
            // No session — stay logged out
          }
        }
      } catch (err) {
        // Absolute last resort: something catastrophic happened (storage timeout, etc.)
        // Ensure the app doesn't stay stuck on splash
        console.error('[hydrate] Fatal error during hydrate:', err);
      } finally {
        set({ hydrated: true });
        hydratePromise = null;
      }
    })();
    return hydratePromise;
  },
}));
