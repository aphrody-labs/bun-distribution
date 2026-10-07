// SPDX-License-Identifier: Apache-2.0
const files = new Set(["index.html", "style.css", "game.js", "engine.js"]);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT || 4317),
  fetch(request) {
    const name = new URL(request.url).pathname.slice(1) || "index.html";
    if (!files.has(name)) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(new URL(name, import.meta.url)));
  },
});
console.log(`Crystal Universe: ${server.url}`);
