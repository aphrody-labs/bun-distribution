import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../dist");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 1430),
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (!["/", "/index.html", "/main.js", "/main.js.map"].includes(path))
      return new Response("Not found", { status: 404 });
    const file = Bun.file(resolve(root, path === "/" ? "index.html" : path.slice(1)));
    return (await file.exists()) ? new Response(file) : new Response("Run bun run build first", { status: 404 });
  },
});
console.log(server.url.href);
