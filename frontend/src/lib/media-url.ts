const INTERNAL_UPLOAD_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0']);

export function normalizeMediaUrl(url: string | null | undefined) {
  if (!url) return url ?? null;
  if (!/^https?:\/\//i.test(url)) return url;

  try {
    const parsed = new URL(url);
    if (INTERNAL_UPLOAD_HOSTS.has(parsed.hostname) && parsed.pathname.startsWith('/uploads/')) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return url;
  }

  return url;
}

export function resolveMediaUrl(url: string | null | undefined) {
  const normalized = normalizeMediaUrl(url);
  if (!normalized) return '';
  if (/^https?:\/\//i.test(normalized)) return normalized;

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';
  const origin = apiBase.replace(/\/api\/v1\/?$/, '');
  return `${origin}${normalized.startsWith('/') ? '' : '/'}${normalized}`;
}