import { createDatabase, createRoutes } from "./app.ts";
import { homeRoutes } from "./home.ts";

export interface ServerOptions {
  port?: number;
  hostname?: string;
  dbPath?: string;
}

export function startServer(options: ServerOptions = {}) {
  const db = createDatabase(options.dbPath);
  const server = Bun.serve({
    port: options.port ?? Number(Bun.env["PORT"] ?? 3000),
    hostname: options.hostname ?? "127.0.0.1",
    idleTimeout: 30,
    routes: { ...homeRoutes, ...createRoutes(db) },
    fetch: () => new Response("Not found", { status: 404 }),
  });
  return { server, db };
}

if (import.meta.main) {
  const { server } = startServer({ dbPath: Bun.env["DB_PATH"] ?? "data/app.sqlite" });
  console.log(`__NAME__ listening on ${server.url}`);
}
