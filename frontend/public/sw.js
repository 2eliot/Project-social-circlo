/* Service Worker — Social Circle PWA */
const CACHE_PREFIX = 'socialcircle';
const CACHE_VERSION = 'v1';
const NAV_CACHE = `${CACHE_PREFIX}-nav-${CACHE_VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_VERSION}`;
const UPLOADS_CACHE = `${CACHE_PREFIX}-uploads-${CACHE_VERSION}`;

/* ───── INSTALL ───── */
self.addEventListener('install', (event) => {
	self.skipWaiting();
});

/* ───── ACTIVATE ───── */
self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((k) => k.startsWith(CACHE_PREFIX) && k !== NAV_CACHE && k !== STATIC_CACHE && k !== UPLOADS_CACHE)
					.map((k) => caches.delete(k)),
			);
			await self.clients.claim();
		})(),
	);
});

/* ───── HELPERS ───── */
function isApi(url) {
	return url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/');
}
function isUpload(url) {
	return url.pathname.startsWith('/uploads/');
}
function isStatic(url) {
	return /\.(js|css|woff2?|svg|png|jpg|jpeg|gif|webp|ico)(\?|$)/.test(url.pathname);
}
function isNavigation(url) {
	return url.pathname.startsWith('/app') || url.pathname === '/' || url.pathname.startsWith('/notifications') || url.pathname.startsWith('/login') || url.pathname.startsWith('/register');
}

/* ───── FETCH ───── */
self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);

	// Only handle same-origin requests
	if (url.origin !== location.origin) return;

	// API calls — Network Only
	if (isApi(url)) return;

	// Navigation pages — Network First, fallback to cache
	if (isNavigation(url)) {
		event.respondWith(networkFirst(event.request, NAV_CACHE));
		return;
	}

	// Uploaded images — Cache First with background refresh
	if (isUpload(url)) {
		event.respondWith(cacheFirst(event.request, UPLOADS_CACHE));
		return;
	}

	// Static assets — Stale While Revalidate
	if (isStatic(url)) {
		event.respondWith(staleWhileRevalidate(event.request, STATIC_CACHE));
		return;
	}
});

/* ───── STRATEGIES ───── */
async function networkFirst(request, cacheName) {
	const cache = await caches.open(cacheName);
	try {
		const response = await fetch(request);
		if (response.ok) {
			await cache.put(request, response.clone());
		}
		return response;
	} catch {
		const cached = await cache.match(request);
		if (cached) return cached;
		return new Response('Sin conexión', { status: 503 });
	}
}

async function cacheFirst(request, cacheName) {
	const cache = await caches.open(cacheName);
	const cached = await cache.match(request);
	if (cached) return cached;
	try {
		const response = await fetch(request);
		if (response.ok) {
			await cache.put(request, response.clone());
		}
		return response;
	} catch {
		return new Response('', { status: 503 });
	}
}

/* ───── PUSH ───── */
self.addEventListener('push', (event) => {
	let payload = {};
	try {
		if (event.data) {
			payload = event.data.json();
		}
	} catch {
		// ignore parse errors
	}

	const title = payload.title || 'Social Circle';
	const options = {
		body: payload.body || '',
		icon: payload.icon || '/icons/icon.svg',
		badge: payload.badge || '/icons/icon.svg',
		image: payload.image || undefined,
		tag: payload.tag || 'default',
		vibrate: payload.vibrate || [200, 100, 200],
		data: {
			...payload.data,
			url: payload.data?.url || '/app',
		},
		requireInteraction: payload.requireInteraction !== false,
		timestamp: payload.timestamp || Date.now(),
	};

	event.waitUntil(self.registration.showNotification(title, options));
});

/* ───── NOTIFICATION CLICK ───── */
self.addEventListener('notificationclick', (event) => {
	event.notification.close();

	const urlToOpen = event.notification.data?.url || '/app';

	event.waitUntil(
		(async () => {
			const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			// Buscar una pestaña ya abierta y navegarla
			for (const client of clients) {
				if (client.url.includes(self.location.origin) && 'focus' in client) {
					await client.focus();
					await client.navigate(urlToOpen);
					return;
				}
			}
			// Si no hay pestaña abierta, abrir una nueva
			if (self.clients.openWindow) {
				await self.clients.openWindow(urlToOpen);
			}
		})(),
	);
});

async function staleWhileRevalidate(request, cacheName) {
	const cache = await caches.open(cacheName);
	const cached = await cache.match(request);
	const fetchPromise = fetch(request)
		.then((response) => {
			if (response.ok) {
				cache.put(request, response.clone());
			}
			return response;
		})
		.catch(() => cached || new Response('', { status: 503 }));
	return cached || fetchPromise;
}


