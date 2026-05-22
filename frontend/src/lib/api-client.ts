/**
 * Lightweight fetch wrapper:
 *  - Access token in memory (never touches localStorage).
 *  - Refresh token rides HttpOnly cookie issued by the API.
 *  - Transparent retry on 401: hits /auth/refresh once before failing.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<(t: string | null) => void>();

export function setAccessToken(token: string | null) {
  accessToken = token;
  listeners.forEach((l) => l(token));
}
export function getAccessToken() {
  return accessToken;
}
export function onAccessTokenChange(cb: (t: string | null) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function refresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        setAccessToken(null);
        return false;
      }
      const data = await res.json();
      setAccessToken(data.accessToken);
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
  const doFetch = () =>
    fetch(`${API}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(accessToken && !skipAuth ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(isFormData ? {} : { 'content-type': 'application/json' }),
        ...(headers ?? {}),
      },
      body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
    });

  let res = await doFetch();
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
