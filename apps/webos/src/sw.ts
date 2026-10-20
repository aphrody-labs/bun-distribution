// SPDX-License-Identifier: Apache-2.0
// Serves installed app packages from Cache Storage (offline) and falls back to the network.
declare const self: ServiceWorkerGlobalScope;

self.addEventListener("install", () => void self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith("/apps/")
  )
    return;
  // Package updates must reach the network to verify the newly published bytes.
  if (event.request.cache === "no-store" || event.request.cache === "reload")
    return;
  const id = url.pathname.split("/")[2];
  if (!id) return;
  event.respondWith(
    (async () => {
      // A staging cache contains an incomplete transaction and must never serve an app.
      const name = `pkg:${id}`;
      const hit = (await caches.has(name))
        ? await (
            await caches.open(name)
          ).match(url.pathname, { ignoreSearch: true })
        : undefined;
      return hit ?? fetch(event.request);
    })(),
  );
});
