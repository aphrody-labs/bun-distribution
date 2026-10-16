import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { achilleaModule } from "./modules/achillea";
import { wikiController } from "./modules/wiki";
import { communityController } from "./modules/community";
import { contentController } from "./modules/content";
import { billingController } from "./modules/billing";
import { storageController } from "./modules/storage";
import { realtimeController } from "./modules/realtime";
import { inagleModule } from "./modules/inagle";
import { azaleeBridgeModule } from "./modules/azalee-bridge";
import { authController } from "./modules/auth";
import { dbPlugin } from "./plugins/db";
import { elysiaAuth } from "@rosegriffon/auth/elysia";

import { handleStorage } from "@rosegriffon/storage/server";
import { handleRealtime, startRealtimeListener } from "@rosegriffon/realtime/server";
import { handleCdn } from "@rosegriffon/cdn/server";

const allowedOrigins = new Set(
  [
    process.env.WEBSITE_URL,
    "https://rosegriffon.fr",
    "https://www.rosegriffon.fr",
    ...(process.env.WEB_ALLOWED_ORIGINS ?? "").split(","),
  ]
    .map(origin => origin?.trim().replace(/\/$/, ""))
    .filter((origin): origin is string => Boolean(origin)),
);

export const app = new Elysia()
  .use(dbPlugin)
  .use(
    cors({
      // Credentials and wildcard origins are incompatible. Reflect only the
      // explicitly configured first-party origins.
      origin: request => {
        const origin = request.headers.get("origin");
        return !origin || allowedOrigins.has(origin);
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Api-Key", "X-Internal-Secret"],
      credentials: true,
    }),
  )
  .use(
    swagger({
      path: "/docs",
      documentation: {
        info: {
          title: "Rose Griffon Unified API",
          version: "3.0.0",
          description: "API unique du monorepo Rose Griffon (ElysiaJS + Kysely + Bun)",
        },
      },
    }),
  )
  .mount(elysiaAuth.handler)
  .get("/.well-known/agent-configuration", ({ request }) =>
    (
      elysiaAuth.api as unknown as {
        getAgentConfiguration: (input: { headers: Headers }) => Promise<Response>;
      }
    ).getAgentConfiguration({ headers: request.headers }),
  )
  .get("/health", () => ({
    status: "ok",
    service: "rg-api",
    uptime: process.uptime(),
    timestamp: Date.now(),
  }))
  // Surface Supabase Storage unifiée (remplace rg-storage:8810)
  .all("/storage/v1/*", ({ request }) => handleStorage(request))
  .all("/storage/v1", ({ request }) => handleStorage(request))

  // Surface Supabase Realtime SSE unifiée (remplace rg-realtime:8812)
  .all("/realtime/v1/*", ({ request }) => handleRealtime(request))
  .all("/realtime/v1", ({ request }) => handleRealtime(request))

  // Surface CDN unifiée (remplace rg-cdn:8801)
  .all("/upload", ({ request }) => handleCdn(request))
  .all("/images/*", ({ request }) => handleCdn(request))
  .all("/api/assets/*", ({ request }) => handleCdn(request))
  .all("/cdn/health", ({ request }) => handleCdn(request))
  .group("/v1", v1 =>
    v1
      .use(achilleaModule)
      .use(wikiController)
      .use(communityController)
      .use(contentController)
      .use(billingController)
      .use(storageController)
      .use(realtimeController)
      .use(inagleModule)
      .use(azaleeBridgeModule)
      .use(authController),
  );

const PORT = Number(process.env.API_PORT ?? 8800);
const HOST = process.env.API_HOST ?? "0.0.0.0";

export function startApiServer(port = PORT, host = HOST) {
  void startRealtimeListener();
  return app.listen({ port, hostname: host }, () => {
    console.info(`[rg-api] Rose Griffon Unified API listening on http://${host}:${port}`);
    console.info(
      `[rg-api] Unified services active: API (:${port}), Storage (/storage/v1), Realtime (/realtime/v1), CDN (/upload, /images)`,
    );
    console.info(`[rg-api] OpenAPI documentation available on http://${host}:${port}/docs`);
  });
}

if (import.meta.main) {
  startApiServer();
}

export type App = typeof app;
