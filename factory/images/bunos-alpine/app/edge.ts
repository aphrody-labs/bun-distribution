// SPDX-License-Identifier: MIT
// bunos-edge: caching reverse proxy for CDN edges. ORIGIN=https://origin.example, CACHE_DIR, CACHE_TTL seconds.
import { mkdir } from "node:fs/promises";

const port = Number(process.env.PORT ?? 8080);

if (process.argv.includes("--health")) {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`).catch(
    () => undefined,
  );
  process.exit(response?.ok ? 0 : 1);
}

const origin = process.env.ORIGIN;
const cacheDir = process.env.CACHE_DIR ?? "/var/cache/bunos";
const ttl = Number(process.env.CACHE_TTL ?? 300) * 1000;
await mkdir(cacheDir, { recursive: true });

function key(url: URL) {
  return `${cacheDir}/${new Bun.CryptoHasher("sha256").update(url.pathname + url.search).digest("hex")}`;
}

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return new Response("ok");
    if (!origin) return new Response("ORIGIN not configured", { status: 503 });
    const upstream = new URL(url.pathname + url.search, origin);
    if (request.method !== "GET" && request.method !== "HEAD")
      return fetch(new Request(upstream, request));
    const body = Bun.file(key(url));
    const meta = Bun.file(`${key(url)}.json`);
    if ((await meta.exists()) && Date.now() - (await meta.json()).at < ttl) {
      const { headers } = await meta.json();
      return new Response(body, {
        headers: { ...headers, "x-bunos-cache": "HIT" },
      });
    }
    const response = await fetch(upstream, { headers: request.headers });
    if (
      !response.ok ||
      /no-store|private/.test(response.headers.get("cache-control") ?? "")
    )
      return response;
    const headers = Object.fromEntries(
      ["content-type", "cache-control", "etag", "last-modified"].flatMap(
        (name) => {
          const value = response.headers.get(name);
          return value ? [[name, value]] : [];
        },
      ),
    );
    const bytes = await response.arrayBuffer();
    await Bun.write(body, bytes);
    await Bun.write(meta, JSON.stringify({ at: Date.now(), headers }));
    return new Response(bytes, {
      headers: { ...headers, "x-bunos-cache": "MISS" },
    });
  },
});

console.log(`bunos-edge on ${server.url} -> ${origin ?? "(no origin)"}`);
