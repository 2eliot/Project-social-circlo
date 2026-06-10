'use client';

import { create } from 'zustand';
import { api, getAccessToken, setAccessToken } from '@/lib/api-client';

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
const SESSION_USER_STORAGE_KEY = 'appchat.sessionUser';

function persistSessionUser(user: SessionUser | null) {
  if (typeof window === 'undefined') return;
  if (user) window.localStorage.setItem(SESSION_USER_STORAGE_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(SESSION_USER_STORAGE_KEY);
}

function readSessionUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SESSION_USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    window.localStorage.removeItem(SESSION_USER_STORAGE_KEY);
    return null;
  }
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  hydrated: false,
  updateUser(patch) {
    set((state) => {
      const user = state.user ? { ...state.user, ...patch } : state.user;
      persistSessionUser(user);
      return { user };
    });
  },
  async login(email, password) {
    set({ loading: true });
    try {
      const res = await api<{ user: SessionUser; accessToken: string }>('/auth/login', {
        method: 'POST',
        body: { email, password },
        skipAuth: true,
      });
      setAccessToken(res.accessToken);
      persistSessionUser(res.user);
      set({ user: res.user });
    } finally {
      set({ loading: false });
    }
  },
  async register(input) {
    set({ loading: true });
    try {
      const res = await api<{ user: SessionUser & { invitationCode?: string }; accessToken: string }>(
        '/auth/register',
        { method: 'POST', body: input, skipAuth: true },
      );
      setAccessToken(res.accessToken);
      persistSessionUser(res.user);
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
    setAccessToken(null);
    persistSessionUser(null);
    set({ user: null });
  },
  async hydrate(force = false) {
    if (get().hydrated && !force) return;
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      const storedUser = readSessionUser();
      const storedToken = getAccessToken();

      // If we have a stored user, set it immediately regardless of token state.
      // The token might be expired — API interceptor will refresh it on first 401.
      // NEVER clear the user here; only logout() does that.
      if (storedUser) {
        set({ user: storedUser, hydrated: true });
        // If token is missing, try to get one in background (no big deal if fails)
        if (!storedToken) {
          try {
            const res = await api<{ user: SessionUser; accessToken: string }>('/auth/refresh', {
              method: 'POST',
              skipAuth: true,
            });
            setAccessToken(res.accessToken);
            persistSessionUser(res.user);
          } catch {
            // Refresh failed, but user stays logged in.
            // Next API call will try refresh again transparently.
          }
        }
        hydratePromise = null;
        return;
      }

      // No stored user at all — try refresh cookie to see if session exists
      try {
        const res = await api<{ user: SessionUser; accessToken: string }>('/auth/refresh', {
          method: 'POST',
          skipAuth: true,
        });
        setAccessToken(res.accessToken);
        persistSessionUser(res.user);
        set({ user: res.user });
      } catch {
        // No session — stay logged out
      } finally {
        set({ hydrated: true });
        hydratePromise = null;
      }
    })();
    return hydratePromise;
  },
}));
