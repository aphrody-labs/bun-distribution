// SPDX-License-Identifier: Apache-2.0
// Serves installed app packages from Cache Storage (offline) and falls back to the network.
declare const self: ServiceWorkerGlobalScope;

self.addEventListener("install", () => void self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith("/apps/"))
    return;
  event.respondWith(
    (async () => {
      const hit = await caches.match(url.pathname, { ignoreSearch: true });
      return hit ?? fetch(event.request);
    })(),
  );
});
