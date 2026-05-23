/*
 * Development-safe no-op service worker.
 * The previous precached worker served stale Next.js chunks and left the app
 * stuck on the loading screen. Keep this file as a self-cleaning stub until
 * PWA support is wired back intentionally.
 */
self.addEventListener('install', (event) => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.map((key) => caches.delete(key)));
			await self.clients.claim();
			const registrations = await self.registration.unregister();
			const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			await Promise.all(clients.map((client) => client.navigate(client.url)));
			return registrations;
		})(),
	);
});

self.addEventListener('fetch', () => {
	// Intentionally empty.
});
