// SPDX-License-Identifier: Apache-2.0
import { buildLoreSearchRequest, filterLoreSearchPayload } from "./lore-search.js";
import { buildLoreCatalogRequest, normalizeLoreCatalogPayload } from "./lore-catalog.js";

const files = new Set([
  "index.html",
  "style.css",
  "game.js",
  "webgpu.js",
  "engine.js",
  "gamepad.js",
  "avatar.js",
  "lore-catalog.js",
  "age1000-map.js",
  "dragon-pixel-wasm.js",
  "dragon-pixel-wasm_bg.wasm",
]);
const shenronBase = process.env.SHENRON_API_BASE || "https://bot.dragonballfr.com";
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT || 4317),
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    const name = pathname.slice(1) || "index.html";
    if (pathname === "/dragon-pixel-wasm.js" || pathname === "/dragon-pixel-wasm_bg.wasm") {
      const file = Bun.file(
        new URL(
          `../../../target/wasm-package-stage/aphrody-dragon-pixel-wasm/${pathname.slice(1)}`,
          import.meta.url,
        ),
      );
      return file.exists().then((exists) =>
        exists
          ? new Response(file, {
              headers: pathname.endsWith(".wasm") ? { "content-type": "application/wasm" } : {},
            })
          : new Response("WASM package not built", { status: 404 }),
      );
    }
    if (name === "api/lore/search" && request.method === "GET") {
      const params = new URL(request.url).searchParams;
      const sourceId = params.get("sourceId")?.trim() || "";
      const search = buildLoreSearchRequest(params.get("q"), sourceId);
      if (search.error) return Response.json({ error: search.error }, { status: 400 });
      const url = new URL("/api/public/rag/search", shenronBase);
      url.searchParams.set("q", search.query);
      url.searchParams.set("limit", String(search.limit));
      if (search.sourceId) url.searchParams.set("sourceId", search.sourceId);
      return fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      })
        .then(async (response) => {
          const body = await response.text();
          if (!sourceId || !search.titlePrefix)
            return new Response(body, {
              status: response.status,
              headers: {
                "content-type":
                  response.headers.get("content-type") || "application/json; charset=utf-8",
                "cache-control": "no-store",
              },
            });
          if (!response.ok)
            return new Response(body, {
              status: response.status,
              headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
              },
            });
          try {
            return Response.json(filterLoreSearchPayload(JSON.parse(body), sourceId), {
              status: response.status,
              headers: { "cache-control": "no-store" },
            });
          } catch {
            return Response.json(
              { error: "La réponse des archives est illisible." },
              { status: 502, headers: { "cache-control": "no-store" } },
            );
          }
        })
        .catch(() =>
          Response.json(
            { error: "Les archives Shenron sont momentanément indisponibles." },
            { status: 502 },
          ),
        );
    }
    if (name === "api/lore/catalog" && request.method === "GET") {
      const params = new URL(request.url).searchParams;
      const catalog = buildLoreCatalogRequest(params.get("series"));
      if (catalog.error) return Response.json({ error: catalog.error }, { status: 400 });
      const url = new URL("/api/public/manga/tomes", shenronBase);
      url.searchParams.set("series", catalog.series);
      return fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      })
        .then(async (response) => {
          const body = await response.text();
          if (!response.ok)
            return new Response(body, {
              status: response.status,
              headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
              },
            });
          try {
            return Response.json(normalizeLoreCatalogPayload(JSON.parse(body), catalog.series), {
              headers: { "cache-control": "no-store" },
            });
          } catch {
            return Response.json(
              { error: "La réponse du catalogue est illisible." },
              { status: 502, headers: { "cache-control": "no-store" } },
            );
          }
        })
        .catch(() =>
          Response.json(
            { error: "Le catalogue Shenron est momentanément indisponible." },
            { status: 502 },
          ),
        );
    }
    if (!files.has(name)) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(new URL(name, import.meta.url)));
  },
});
console.log(`Dragon Pixel: ${server.url}`);
