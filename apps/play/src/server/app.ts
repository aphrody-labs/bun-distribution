// SPDX-License-Identifier: Apache-2.0
/**
 * play.aphrody.app server: Bun.serve routes for the public catalog, the signed-in Steam, LAN cache,
 * Bun Engine and NGINX engine surfaces, and one WebSocket (`/ws`) that carries both the realtime
 * pub/sub (`/ws?topics=...`) and the unchanged gamestream signalling (`/ws`).
 */
import type { Server, ServerWebSocket } from "bun";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { frontendRoutes } from "../../../../packages/bun-engine/src/frontend/api";
import { runningGames } from "../../../../packages/bun-engine/src/frontend/launch";
import { assertPublicRoot } from "../../../../packages/bun-engine/src/owned/guard";
import { ownedRoutes } from "../../../../packages/bun-engine/src/owned/http";
import { attachTransfers, platformRoutes } from "../../../../packages/bun-os-platform/src/server";
import { artRoutes } from "./art";
import { authRoutes, guarded, sessionOf, unauthorized } from "./auth";
import { config } from "./config";
import { engineState, reloadEngine } from "./nginx";
import { ContentLog, lancacheAudit, steamAudit, steamStatus } from "./steam";
import {
  closeRelay,
  gamestreamHealth,
  openRelay,
  relayMessage,
  type StreamEvent,
  type StreamSocket,
} from "./stream";

export const TOPICS = [
  "steam",
  "downloads",
  "lancache",
  "stream",
  "engine",
  "nginx",
  "transfers",
] as const;
export type Topic = (typeof TOPICS)[number];

interface SocketData {
  user: string;
  mode: "realtime" | "stream";
  topics: Topic[];
  stream: StreamSocket;
}

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });

/** Web emulation cores published as `<core>/manifest.json` by the emulation build owner. */
export function emulationCores(): unknown[] {
  // The owner's index.json lists every published core; per-core manifest.json is the fallback.
  try {
    const index = JSON.parse(
      readFileSync(join(config.emulationDir, "index.json"), "utf8"),
    ) as {
      cores: { id: string }[];
    };
    return index.cores.map((core) => ({
      ...core,
      base: `/emulation/${core.id}/`,
    }));
  } catch {
    /* no index: scan the core directories */
  }
  let entries: string[];
  try {
    entries = readdirSync(config.emulationDir);
  } catch {
    return [];
  }
  const cores = [];
  for (const core of entries) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(config.emulationDir, core, "manifest.json"), "utf8"),
      );
      cores.push({
        ...manifest,
        id: manifest.id ?? core,
        base: `/emulation/${core}/`,
      });
    } catch {
      /* not a core directory */
    }
  }
  return cores;
}

/** Bun Engine frontend API under /api/engine/*, signed-in only (it launches and installs). */
function engineRoutes() {
  const routes: Record<
    string,
    Record<
      string,
      (request: Bun.BunRequest, server: Server<SocketData>) => unknown
    >
  > = {};
  for (const [path, methods] of Object.entries(frontendRoutes())) {
    const wrapped: Record<
      string,
      (request: Bun.BunRequest, server: Server<SocketData>) => unknown
    > = {};
    for (const [method, handler] of Object.entries(
      methods as Record<string, (...args: never[]) => unknown>,
    ))
      wrapped[method] = guarded(
        handler as (
          request: Bun.BunRequest,
          server: Server<SocketData>,
        ) => Response,
      );
    routes[path.replace(/^\/api\//, "/api/engine/")] = wrapped;
  }
  return routes;
}

export function createServer(
  options: {
    staticRoutes?: Record<string, unknown>;
    development?: boolean;
  } = {},
) {
  const content = new ContentLog();
  const streamSessions = new Map<
    string,
    { user: string; since: string; ice: string }
  >();
  const last = new Map<Topic, string>();

  // The owner's private dump store is never part of what this server or the engine publishes.
  assertPublicRoot(config.publicDir, config.emulationDir);
  const server = Bun.serve<SocketData>({
    hostname: config.hostname,
    port: config.port,
    development: options.development ?? false,
    idleTimeout: 60,
    routes: {
      ...options.staticRoutes,
      "/healthz": () => json({ ok: true }),
      ...authRoutes(),
      ...Object.fromEntries(
        Object.entries(artRoutes()).map(([path, methods]) => [
          path,
          { GET: guarded(methods.GET) },
        ]),
      ),
      "/api/emulation": { GET: () => json(emulationCores()) },
      "/api/steam": { GET: guarded(() => json(steamStatus())) },
      "/api/steam/downloads": { GET: guarded(() => json(content.snapshot())) },
      "/api/steam/audit": {
        GET: guarded(() => json(steamAudit(false))),
        POST: guarded(() => json(steamAudit(true), 202)),
      },
      "/api/lancache": {
        GET: guarded(async () => {
          try {
            return json(await lancacheAudit());
          } catch (error) {
            return json({ error: String(error) }, 502);
          }
        }),
      },
      "/api/stream": {
        GET: guarded(async () =>
          json({
            ...(await gamestreamHealth()),
            sessions: [...streamSessions.values()],
          }),
        ),
      },
      "/api/nginx": {
        GET: guarded(async () => json(await engineState())),
      },
      "/api/nginx/reload": {
        POST: guarded(async () => {
          try {
            return json(await reloadEngine());
          } catch (error) {
            return json({ error: String(error) }, 500);
          }
        }),
      },
      ...engineRoutes(),
      // Platform layer (docs/bun-os/PLATFORM.md): catalogs, theme file and CSS, plugins, file
      // inspection, transfers. Host-acting routes go through the session guard.
      ...platformRoutes({ guard: guarded as never }),
      // Owned dumps (packages/bun-engine/src/owned/http.ts): signed-in only, never dump bytes.
      ...Object.fromEntries(
        Object.entries(ownedRoutes()).map(([path, methods]) => [
          path,
          Object.fromEntries(Object.entries(methods).map(([method, handler]) => [method, guarded(handler)])),
        ]),
      ),
      "/ws": (request: Request, srv: Server<SocketData>) => {
        const session = sessionOf(request);
        if (!session) return unauthorized();
        const url = new URL(request.url);
        const origin = request.headers.get("origin");
        if (origin && origin !== config.publicOrigin && origin !== url.origin)
          return json({ error: "cross-origin WebSocket" }, 403);
        const topics = (url.searchParams.get("topics") ?? "")
          .split(",")
          .filter((topic): topic is Topic =>
            (TOPICS as readonly string[]).includes(topic),
          );
        const ok = srv.upgrade(request, {
          data: {
            user: session.sub,
            mode: url.searchParams.has("topics") ? "realtime" : "stream",
            topics,
            stream: { upstream: null, queue: [] },
          },
        });
        return ok
          ? undefined
          : new Response("WebSocket upgrade expected", { status: 426 });
      },
    },
    fetch: () => json({ error: "not found" }, 404),
    websocket: {
      maxPayloadLength: 256 * 1024,
      idleTimeout: 120,
      sendPings: true,
      open(ws: ServerWebSocket<SocketData>) {
        if (ws.data.mode === "stream") {
          const id = crypto.randomUUID();
          (ws.data as SocketData & { id?: string }).id = id;
          streamSessions.set(id, {
            user: ws.data.user,
            since: new Date().toISOString(),
            ice: "new",
          });
          openRelay(ws, (event: StreamEvent) => {
            const session = streamSessions.get(id);
            if (session && event.kind === "state")
              session.ice = event.detail ?? session.ice;
            publish(
              "stream",
              { event, sessions: [...streamSessions.values()] },
              true,
            );
          });
          return;
        }
        for (const topic of ws.data.topics) {
          ws.subscribe(topic);
          const cached = last.get(topic);
          if (cached) ws.send(cached);
        }
      },
      message(ws: ServerWebSocket<SocketData>, message: string | Buffer) {
        if (ws.data.mode === "stream")
          relayMessage(ws.data.stream, String(message));
      },
      close(ws: ServerWebSocket<SocketData>) {
        if (ws.data.mode !== "stream") return;
        closeRelay(ws.data.stream);
        const id = (ws.data as SocketData & { id?: string }).id;
        if (id) streamSessions.delete(id);
        publish(
          "stream",
          {
            event: { kind: "close", user: ws.data.user },
            sessions: [...streamSessions.values()],
          },
          true,
        );
      },
    },
  });

  /** Publishes when the payload changed (or `force`), and caches it for new subscribers. */
  function publish(topic: Topic, data: unknown, force = false): void {
    const text = JSON.stringify({
      type: "event",
      topic,
      at: new Date().toISOString(),
      data,
    });
    const key = JSON.stringify(data);
    if (!force && last.get(topic)?.includes(key)) return;
    last.set(topic, text);
    server.publish(topic, text);
  }

  const every = (ms: number, task: () => unknown | Promise<unknown>) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await task();
      } catch {
        /* the next tick retries */
      } finally {
        running = false;
      }
    };
    void tick();
    return setInterval(tick, ms);
  };

  let games: { appId: number; name: string }[] = [];
  every(15_000, () => {
    const status = steamStatus();
    if (status.available) {
      games = status.games;
      content.names(games);
    }
    publish("steam", status);
  });
  every(2_000, () => {
    content.poll();
    publish("downloads", content.snapshot());
  });
  every(5_000, async () => publish("lancache", await lancacheAudit()));
  every(5_000, async () =>
    publish("stream", {
      ...(await gamestreamHealth()),
      sessions: [...streamSessions.values()],
    }),
  );
  every(3_000, () => publish("engine", { running: runningGames() }));
  every(15_000, async () => publish("nginx", await engineState()));
  void attachTransfers((event) => publish("transfers", event, true));

  return server;
}
