'use client';

import { create } from 'zustand';
import { api, setAccessToken } from '@/lib/api-client';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  globalRole: 'SUPER_ADMIN' | 'GLOBAL_MODERATOR' | 'USER';
}

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<{ invitationCode: string }>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
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

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  hydrated: false,
  updateUser(patch) {
    set((state) => ({ user: state.user ? { ...state.user, ...patch } : state.user }));
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
    set({ user: null });
  },
  async hydrate() {
    if (get().hydrated) return;
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      try {
        const res = await api<{ user: SessionUser; accessToken: string }>('/auth/refresh', {
          method: 'POST',
          skipAuth: true,
        });
        setAccessToken(res.accessToken);
        set({ user: res.user });
      } catch {
        set({ user: null });
      } finally {
        set({ hydrated: true });
        hydratePromise = null;
      }
    })();
    return hydratePromise;
  },
}));
