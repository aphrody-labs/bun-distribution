#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Real-Time Multi-Agent Interceptor, Auto-Sync & Unified Daemon
 *
 * Runs persistent background interception & auto-sync for AGY, Codex, and Claude.
 * - Monitors file system changes in ~/.gemini/, ~/.codex/, and ~/.claude/
 * - Probes agent HTTP endpoints (:8788, :8795, :8080, :3000)
 * - Auto-syncs Git state, Codebase Redis indexing, Context beacons and Docs cache
 * - Streams telemetry events to Redis (yolo:agents:events) and SQLite (/var/log/yolo/yolo-train.sqlite)
 * - Exposes a native Bun.serve HTTP API on 127.0.0.1:8799
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { initLedgerDatabase } from "../packages/core/src/ledger/index";
import { AgentWatcher } from "../packages/core/src/monitor/agent_watcher";
import { AutoSyncEngine } from "../packages/core/src/monitor/auto_sync";
import { NativeRedisClient } from "../packages/core/src/redis/client";
import { indexCodebaseToRedis } from "../packages/core/src/redis/indexer";
import { findRepoRoot } from "../packages/core/src/vfs/index";

const root = findRepoRoot();
const port = Number(process.env.YOLO_INTERCEPTOR_PORT || 8799);

console.log("[Interceptor Daemon] Initializing Multi-Agent Interceptor, Auto-Sync & Daemon...");

// Connect to SQLite Ledger
const varLogDb = "/var/log/yolo/yolo-train.sqlite";
const dbPath = existsSync("/var/log/yolo") ? varLogDb : join(root, "var", "yolo-train.sqlite");
const db = initLedgerDatabase(dbPath);
console.log(`[Interceptor Daemon] SQLite Ledger connected at ${dbPath}`);

// Connect to Redis
const redis = new NativeRedisClient({ hostname: "127.0.0.1", port: 6379 });
let redisConnected = false;
try {
  await redis.connect();
  const pong = await redis.ping();
  redisConnected = pong === "PONG";
  console.log(`[Interceptor Daemon] Native Redis connected at 127.0.0.1:6379 (ping: ${pong})`);
} catch (err) {
  console.warn(`[Interceptor Daemon] Redis connection warning: ${(err as Error).message}`);
}

// Start Agent Watcher
const watcher = new AgentWatcher({
  redisClient: redisConnected ? redis : undefined,
  sqliteDb: db,
  pollEndpointsIntervalMs: 10_000,
});

watcher.start();
console.log(`[Interceptor Daemon] AgentWatcher started across:`);
for (const dir of watcher.monitoredDirs) {
  console.log(`  - ${dir} (${existsSync(dir) ? "ACTIVE" : "PENDING"})`);
}

// Start Autonomous Full-Stack Synchronizer
const autoSync = new AutoSyncEngine({
  redisClient: redisConnected ? redis : undefined,
  sqliteDb: db,
});
autoSync.startPeriodic(60_000);
console.log("[Interceptor Daemon] AutoSyncEngine started (periodic 60s cycle active)");

// Start Bun.serve HTTP control server
const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch: async (req) => {
    const url = new URL(req.url);

    // GET /health
    if (url.pathname === "/health" && req.method === "GET") {
      return Response.json({
        status: "ok",
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        redisConnected: redis.isConnected,
        monitoredDirs: watcher.monitoredDirs,
        activeSessionsCount: watcher.getActiveSessions().length,
      });
    }

    // GET /status
    if (url.pathname === "/status" && req.method === "GET") {
      const activeSessions = watcher.getActiveSessions();
      let endpoints: any = [];
      if (redis.isConnected) {
        try {
          const raw = await redis.hgetall("yolo:agents:endpoints");
          endpoints = Object.entries(raw).map(([name, data]) => ({
            name,
            ...JSON.parse(data),
          }));
        } catch {
          // fallback
        }
      }
      return Response.json({
        daemon: "yolo-agent-interceptor",
        port,
        activeSessions,
        endpoints,
        database: dbPath,
      });
    }

    // GET /sessions
    if (url.pathname === "/sessions" && req.method === "GET") {
      return Response.json({
        sessions: watcher.getActiveSessions(),
      });
    }

    // POST /reindex
    if (url.pathname === "/reindex" && req.method === "POST") {
      if (!redis.isConnected) {
        return Response.json({ error: "Redis not connected" }, { status: 503 });
      }
      try {
        const result = await indexCodebaseToRedis(root, "manual-trigger", redis);
        return Response.json({ success: true, result });
      } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
      }
    }

    // POST /sync
    if (url.pathname === "/sync" && req.method === "POST") {
      try {
        const forceIndex = url.searchParams.get("forceIndex") === "true";
        const result = await autoSync.runSyncCycle(forceIndex);
        return Response.json({ success: true, result });
      } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
      }
    }

    // GET /sync/status
    if (url.pathname === "/sync/status" && req.method === "GET") {
      try {
        const yoloState = await autoSync.getGitState(root);
        const aphrodyState = existsSync("/home/aphro/aphrody")
          ? await autoSync.getGitState("/home/aphro/aphrody")
          : null;
        return Response.json({
          status: "synced",
          yolo: yoloState,
          aphrody: aphrodyState,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
      }
    }

    // GET /docs/search
    if (url.pathname === "/docs/search" && req.method === "GET") {
      const query = url.searchParams.get("q") || "";
      if (!query) {
        return Response.json({ error: "Missing query parameter 'q'" }, { status: 400 });
      }
      try {
        const result = await autoSync.cachedDocQuery(query, async () => {
          // Native fallback lookup via Bun.spawn
          const proc = Bun.spawn(["aphrody", "docs", query], {
            stdout: "pipe",
            stderr: "ignore",
          });
          return (await new Response(proc.stdout).text()).trim();
        });
        return Response.json({ query, result });
      } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[Interceptor Daemon] Bun.serve listening on http://127.0.0.1:${port}`);

// Signal handling
function shutdown() {
  console.log("\n[Interceptor Daemon] Gracefully shutting down...");
  autoSync.stop();
  watcher.stop();
  server.stop();
  try {
    redis.close();
    db.close();
  } catch {
    // Ignore
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
