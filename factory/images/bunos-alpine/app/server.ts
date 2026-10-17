// SPDX-License-Identifier: MIT
// Default bunos-alpine runtime: static files from /app/public plus /healthz. Replace /app to serve a site.
const root = process.env.PUBLIC_DIR ?? "/app/public";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 8080),
  hostname: "0.0.0.0",
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") return new Response("ok");
    const path = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    if (path.includes("..")) return new Response("Bad Request", { status: 400 });
    const file = Bun.file(`${root}${path}`);
    return (await file.exists()) ? new Response(file) : new Response("Not Found", { status: 404 });
  },
});

console.log(`bunos-alpine runtime on ${server.url}`);
