/**
 * In-memory image cache for Capacitor APK.
 *
 * Instead of relying on browser HTTP cache (which is unreliable in Android
 * WebView across SPA navigation), we fetch images, convert them to blobs,
 * and store blob: URLs. This guarantees that once an avatar URL is cached,
 * subsequent renders serve it synchronously — no flickering, no bouncing.
 *
 * All blob: URLs are revoked on logout via clearBlobCache().
 */

const blobCache = new Map<string, string>();
const inFlight = new Map<string, Promise<void>>();

/**
 * Return the cached blob: URL if available, otherwise the original URL.
 * Safe to call synchronously in render — returns immediately.
 */
export function getCachedUrl(url: string): string {
  return blobCache.get(url) ?? url;
}

/** Whether the URL has already been cached as a blob. */
export function isImageCached(url: string): boolean {
  return blobCache.has(url);
}

/**
 * Fetch an image and store it as a blob: URL.
 * Future calls with the same URL return the cached blob URL synchronously.
 * Idempotent: concurrent calls share the same in-flight promise.
 */
export async function preloadAsBlob(url: string): Promise<void> {
  if (blobCache.has(url)) return;
  if (inFlight.has(url)) { await inFlight.get(url); return; }

  const promise = (async () => {
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) return;
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      blobCache.set(url, objectUrl);
    } catch {
      // Fetch failed — render will use the original URL
    }
  })();

  inFlight.set(url, promise);
  await promise;
  inFlight.delete(url);
}

/** Preload multiple URLs in parallel. */
export function preloadAllAsBlob(urls: string[]): Promise<void[]> {
  return Promise.all(urls.map(preloadAsBlob));
}

/** Revoke all blob: URLs (call on logout). */
export function clearBlobCache(): void {
  for (const blobUrl of blobCache.values()) {
    URL.revokeObjectURL(blobUrl);
  }
  blobCache.clear();
  inFlight.clear();
}
