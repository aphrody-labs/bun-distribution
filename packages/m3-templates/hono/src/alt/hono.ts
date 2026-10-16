// Hono variant of the HTTP surface (https://github.com/honojs/hono), listed in templates/AWESOME.md.
import { Hono } from "hono";
import { system } from "runtime:system";

export const app = new Hono()
  .get("/health", (c) => c.json({ ok: true }))
  .get("/api/stats", (c) =>
    c.json({ runtime: system.info(), stats: system.stats() }),
  );

if (import.meta.main) {
  const server = Bun.serve({
    port: Number(Bun.env["PORT"] ?? 3001),
    fetch: app.fetch,
  });
  console.log(`hono listening on ${server.url}`);
}
