// Elysia variant of the HTTP surface (https://github.com/elysiajs/elysia), listed in templates/AWESOME.md.
import { Elysia } from "elysia";
import { system } from "runtime:system";

export const app = new Elysia()
  .get("/health", () => ({ ok: true }))
  .get("/api/stats", () => ({ runtime: system.info(), stats: system.stats() }));

if (import.meta.main) {
  app.listen(Number(Bun.env["PORT"] ?? 3002));
  console.log(`elysia listening on ${app.server?.url}`);
}
