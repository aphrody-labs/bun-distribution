import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { achilleaModule } from "./modules/achillea";
import { wikiController } from "./modules/wiki";
import { communityController } from "./modules/community";
import { contentController } from "./modules/content";
import { billingController } from "./modules/billing";
import { inagleModule } from "./modules/inagle";
import { azaleeBridgeModule } from "./modules/azalee-bridge";
import { authController } from "./modules/auth";
import { dbPlugin } from "./plugins/db";
import { publicCache } from "./plugins/public-cache";
import { elysiaAuth } from "@rosegriffon/auth/elysia";
import { handleAnnounceHttp, handleCronHttp } from "@rosegriffon/cron";

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
  // CDN caching of the anonymous public reads (free-tier guardrail).
  .use(publicCache)
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
  // Tâches planifiées (appelées par pg_cron) et annonces Discord du site : Bearer, corps lu par le handler.
  .all("/v1/cron/*", ({ request }) => handleCronHttp(request), { parse: "none" })
  .post("/v1/discord/announce", ({ request }) => handleAnnounceHttp(request), { parse: "none" })
  .group("/v1", v1 =>
    v1
      .use(achilleaModule)
      .use(wikiController)
      .use(communityController)
      .use(contentController)
      .use(billingController)
      .use(inagleModule)
      .use(azaleeBridgeModule)
      .use(authController)
      // Discord HTTP interactions forwarded by crates/aphrody-rg-server. Lazy:
      // the executor reads the bot token and loads the command modules.
      .post(
        "/discord/interactions/execute",
        async ({ request }) => (await import("../interactions/executor")).executerInteractionDiscord(request),
        { parse: "none" },
      ),
  );

const PORT = Number(process.env.API_PORT ?? 8800);
const HOST = process.env.API_HOST ?? "0.0.0.0";

export function startApiServer(port = PORT, host = HOST) {
  return app.listen({ port, hostname: host }, () => {
    console.info(`[rg-api] Rose Griffon Unified API listening on http://${host}:${port}`);
    console.info(`[rg-api] OpenAPI documentation available on http://${host}:${port}/docs`);
  });
}

if (import.meta.main) {
  startApiServer();
}

export type App = typeof app;
