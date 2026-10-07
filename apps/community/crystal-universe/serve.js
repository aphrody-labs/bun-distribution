// SPDX-License-Identifier: Apache-2.0
const files = new Set([
  "index.html",
  "style.css",
  "game.js",
  "engine.js",
  "gamepad.js",
  "age1000-map.js",
]);
const shenronBase = process.env.SHENRON_API_BASE || "https://bot.dragonballfr.com";
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT || 4317),
  fetch(request) {
    const name = new URL(request.url).pathname.slice(1) || "index.html";
    if (name === "api/lore/search" && request.method === "GET") {
      const query = new URL(request.url).searchParams.get("q")?.trim() || "";
      if (query.length < 2 || query.length > 120)
        return Response.json(
          { error: "La recherche doit contenir entre 2 et 120 caractères." },
          { status: 400 },
        );
      const url = new URL("/api/public/rag/search", shenronBase);
      url.searchParams.set("q", query);
      url.searchParams.set("limit", "8");
      return fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      })
        .then(
          async (response) =>
            new Response(await response.text(), {
              status: response.status,
              headers: {
                "content-type":
                  response.headers.get("content-type") || "application/json; charset=utf-8",
                "cache-control": "no-store",
              },
            }),
        )
        .catch(() =>
          Response.json(
            { error: "Les archives Shenron sont momentanément indisponibles." },
            { status: 502 },
          ),
        );
    }
    if (!files.has(name)) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(new URL(name, import.meta.url)));
  },
});
console.log(`Dragon Pixel: ${server.url}`);
