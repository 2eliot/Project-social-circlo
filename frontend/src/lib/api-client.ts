/**
 * Lightweight fetch wrapper:
 *  - Access token persists via @capacitor/preferences (SharedPreferences nativo).
 *  - Refresh token también persiste en Preferences (no confía en cookies HttpOnly,
 *    porque el WebView de la APK no las envía en peticiones cross-origin).
 *  - Transparent retry on 401: hits /auth/refresh once before failing.
 */

import { appStorage } from './storage';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';
const ACCESS_TOKEN_STORAGE_KEY = 'accessToken';
const REFRESH_TOKEN_STORAGE_KEY = 'refreshToken';

// Starts null; restored asynchronously by restoreAccessToken() during hydrate.
let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<(t: string | null) => void>();

/** Restore access token from native storage (call during hydrate). */
export async function restoreAccessToken(): Promise<string | null> {
  const raw = await appStorage.get(ACCESS_TOKEN_STORAGE_KEY);
  accessToken = raw;
  listeners.forEach((l) => l(raw));
  return raw;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
  // Persist to native SharedPreferences.
  // Must be awaited by callers that need the remove to complete before
  // the WebView process is killed (e.g. logout).  Fire-and-forget is
  // fine for set() during login because the token is also in memory.
  const persistPromise =
    typeof window !== 'undefined'
      ? token
        ? appStorage.set(ACCESS_TOKEN_STORAGE_KEY, token)
        : appStorage.remove(ACCESS_TOKEN_STORAGE_KEY)
      : Promise.resolve();
  listeners.forEach((l) => l(token));
  return persistPromise;
}
export function getAccessToken() {
  return accessToken;
}
export function onAccessTokenChange(cb: (t: string | null) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** ── Refresh token (Preferences-based, no cookie) ── */

/** Restore refresh token from native storage (call during hydrate). */
export async function restoreRefreshToken(): Promise<string | null> {
  const raw = await appStorage.get(REFRESH_TOKEN_STORAGE_KEY);
  refreshToken = raw;
  return raw;
}

export function setRefreshToken(token: string | null) {
  refreshToken = token;
  const persistPromise =
    typeof window !== 'undefined'
      ? token
        ? appStorage.set(REFRESH_TOKEN_STORAGE_KEY, token)
        : appStorage.remove(REFRESH_TOKEN_STORAGE_KEY)
      : Promise.resolve();
  return persistPromise;
}

export function getRefreshToken() {
  return refreshToken;
}

async function refresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const storedRefresh = refreshToken;
      if (!storedRefresh) {
        setAccessToken(null);
        return false;
      }
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: storedRefresh }),
      });
      if (!res.ok) {
        setAccessToken(null);
        setRefreshToken(null);
        return false;
      }
      const data = await res.json();
      setAccessToken(data.accessToken);
      if (data.refreshToken) setRefreshToken(data.refreshToken);
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  skipAuth?: boolean;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { body, skipAuth, headers, ...rest } = opts;
  const isFormData = body instanceof FormData;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  const doFetch = () =>
    fetch(`${API}${path}`, {
      ...rest,
      signal: controller.signal,
      credentials: 'include',
      headers: {
        ...(accessToken && !skipAuth ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(isFormData ? {} : { 'content-type': 'application/json' }),
        ...(headers ?? {}),
      },
      body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
    });

  let res;
  try {
    res = await doFetch();
  } catch (err: any) {
    clearTimeout(timeout);
    if (err?.name === 'AbortError') {
      throw new ApiError(0, 'Request timed out after 30s');
    }
    throw new ApiError(0, `Network error: ${err?.message ?? 'unknown'}`);
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 401 && !skipAuth) {
    const ok = await refresh();
    if (ok) res = await doFetch();
  }
  if (!res.ok) {
    const errBody = await res.text();
    throw new ApiError(res.status, errBody);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('application/json') ? ((await res.json()) as T) : ((await res.text()) as unknown as T);
}

export class ApiError extends Error {
  constructor(public status: number, public bodyText: string) {
    super(`API ${status}: ${bodyText}`);
  }
}
