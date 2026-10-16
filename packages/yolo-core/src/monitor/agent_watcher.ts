// SPDX-License-Identifier: Apache-2.0
/**
 * Real-Time Multi-Agent Session Interceptor & File System Monitor
 *
 * Intercepts session IDs, writes, and activities from Codex, AGY, and Claude.
 * Monitors agent directories (.gemini/, .codex/, .claude/) via native inotify/fs.watch.
 * Probes HTTP endpoints and streams telemetry events to Redis and SQLite.
 */
import type { Database } from "bun:sqlite";
import { existsSync, type FSWatcher, watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { recordAgentTelemetry } from "../ledger/index";
import type { NativeRedisClient } from "../redis/client";

const positive = (value: number | undefined, fallback: number) => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1)
    throw new RangeError("Watcher limits must be positive integers");
  return result;
};

export interface AgentWatcherOptions {
  redisClient?: NativeRedisClient | undefined;
  sqliteDb?: Database | undefined;
  customDirs?: string[] | undefined;
  pollEndpointsIntervalMs?: number | undefined;
  endpoints?: Array<{ name: string; url: string }> | undefined;
  endpointTimeoutMs?: number | undefined;
  maxSessions?: number | undefined;
  sessionRetentionMs?: number | undefined;
}

export interface InterceptedEvent {
  agent: "agy" | "codex" | "claude" | "unknown";
  sessionId: string;
  eventType: string;
  targetPath: string;
  timestamp: string;
}

export interface EndpointStatus {
  name: string;
  url: string;
  online: boolean;
  latencyMs: number;
  lastChecked: string;
}

export class AgentWatcher {
  #redis: NativeRedisClient | null = null;
  #db: Database | null = null;
  #watchers: FSWatcher[] = [];
  #pollTimer: Timer | null = null;
  #activeSessions = new Map<
    string,
    { agent: string; sessionId: string; lastSeen: string; path: string }
  >();

  readonly monitoredDirs: string[];
  #running = false;
  #intervalMs: number;
  #timeoutMs: number;
  #maxSessions: number;
  #retentionMs: number;
  #poll: Promise<void> | null = null;
  #abort: AbortController | null = null;
  #pending = new Set<Promise<unknown>>();
  #statuses = new Map<string, EndpointStatus>();
  readonly endpoints: Array<{ name: string; url: string }>;
  static readonly defaultEndpoints = [
    { name: "aphrody_a2a", url: "http://127.0.0.1:8788/ping" },
    { name: "aphrody_gateway", url: "http://127.0.0.1:8795/health" },
    { name: "llama_server", url: "http://127.0.0.1:8080/health" },
    { name: "app_server", url: "http://127.0.0.1:3000" },
  ];

  constructor(options: AgentWatcherOptions = {}) {
    this.#redis = options.redisClient ?? null;
    this.#db = options.sqliteDb ?? null;

    this.#intervalMs = positive(options.pollEndpointsIntervalMs, 10000);
    this.#timeoutMs = positive(options.endpointTimeoutMs, 1500);
    this.#maxSessions = positive(options.maxSessions, 1024);
    this.#retentionMs = positive(options.sessionRetentionMs, 86400000);
    this.endpoints = (options.endpoints ?? AgentWatcher.defaultEndpoints).map(
      (endpoint) => Object.assign({}, endpoint),
    );
    const home = homedir();
    this.monitoredDirs = options.customDirs ?? [
      join(home, ".gemini", "antigravity-cli", "brain"),
      join(home, ".codex"),
      join(home, ".claude"),
    ];
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#startWatchers();
    this.#startEndpointPolling();
  }

  #startWatchers() {
    for (const dir of this.monitoredDirs) {
      if (!existsSync(dir)) continue;

      try {
        const watcher = watch(
          dir,
          { recursive: true },
          (eventType, filename) => {
            if (!this.#running || !filename) return;
            this.#handleFsEvent(dir, filename.toString(), eventType);
          },
        );
        this.#watchers.push(watcher);
      } catch {
        // Fall back if recursive watch is restricted
      }
    }
  }

  #handleFsEvent(baseDir: string, filename: string, eventType: string) {
    const fullPath = join(baseDir, filename);
    const now = new Date().toISOString();

    // Determine agent
    let agent: InterceptedEvent["agent"] = "unknown";
    if (baseDir.includes(".gemini")) agent = "agy";
    else if (baseDir.includes(".codex")) agent = "codex";
    else if (baseDir.includes(".claude")) agent = "claude";

    // Extract session ID
    let sessionId = "unknown";
    const uuidMatch = fullPath.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    if (uuidMatch) {
      sessionId = uuidMatch[0];
    } else {
      const parts = filename.split("/");
      sessionId = parts[0] || "global";
    }

    const event: InterceptedEvent = {
      agent,
      sessionId,
      eventType,
      targetPath: fullPath,
      timestamp: now,
    };

    // Update internal cache
    const sessionKey = `${agent}:${sessionId}`;
    this.#expireSessions();
    this.#activeSessions.delete(sessionKey);
    while (this.#activeSessions.size >= this.#maxSessions)
      this.#activeSessions.delete(this.#activeSessions.keys().next().value!);
    this.#activeSessions.set(sessionKey, {
      agent,
      sessionId,
      lastSeen: now,
      path: fullPath,
    });

    // Stream to Redis
    if (this.#redis?.isConnected) {
      this.#track(
        this.#redis.publish("yolo:agents:events", JSON.stringify(event)),
      );
      this.#track(
        this.#redis.hset(
          "yolo:agents:active_sessions",
          sessionKey,
          JSON.stringify({
            agent,
            sessionId,
            lastSeen: now,
            path: fullPath,
          }),
        ),
      );
    }

    // Persist to SQLite
    if (this.#db) {
      try {
        recordAgentTelemetry(this.#db, {
          agent: event.agent,
          sessionId: event.sessionId,
          eventType: event.eventType,
          targetPath: event.targetPath,
          timestamp: event.timestamp,
        });
      } catch {
        // Ignore DB transient errors
      }
    }
  }

  #track(request: Promise<unknown>): void {
    const pending = request
      .catch(() => {})
      .finally(() => this.#pending.delete(pending));
    this.#pending.add(pending);
  }

  #startEndpointPolling(): void {
    const poll = () => {
      if (!this.#running || this.#poll) return;
      const abort = new AbortController();
      this.#abort = abort;
      this.#poll = (async () => {
        for (const endpoint of this.endpoints) {
          if (abort.signal.aborted) break;
          const started = performance.now();
          let online = false;
          try {
            // oxlint-disable-next-line no-await-in-loop -- sondes séquentielles bornées par endpoint : charge locale minimale et arrêt propre via abort
            const response = await fetch(endpoint.url, {
              signal: AbortSignal.any([
                abort.signal,
                AbortSignal.timeout(this.#timeoutMs),
              ]),
            });
            online = response.ok;
            // oxlint-disable-next-line no-await-in-loop -- libère la connexion de la sonde avant la suivante (séquentiel)
            await response.body?.cancel();
          } catch {
            /* A failed probe is recorded as offline. */
          }
          if (abort.signal.aborted) break;
          const status: EndpointStatus = {
            ...endpoint,
            online,
            latencyMs: Math.round(performance.now() - started),
            lastChecked: new Date().toISOString(),
          };
          this.#statuses.set(endpoint.name, status);
          if (this.#redis?.isConnected) {
            try {
              // oxlint-disable-next-line no-await-in-loop -- écritures d'état séquentielles dans l'ordre des endpoints du cycle de sondage
              await this.#redis.hset(
                "yolo:agents:endpoints",
                endpoint.name,
                JSON.stringify(status),
              );
            } catch {
              /* The status remains available through getEndpointStatuses. */
            }
          }
        }
      })().finally(() => {
        this.#poll = null;
        this.#abort = null;
      });
    };
    poll();
    this.#pollTimer = setInterval(poll, this.#intervalMs);
  }

  #expireSessions(): void {
    const cutoff = Date.now() - this.#retentionMs;
    for (const [key, value] of this.#activeSessions) {
      if (Date.parse(value.lastSeen) < cutoff) this.#activeSessions.delete(key);
    }
  }

  getEndpointStatuses(): EndpointStatus[] {
    return Array.from(this.#statuses.values(), (status) =>
      Object.assign({}, status),
    );
  }

  getActiveSessions(): Array<{
    agent: string;
    sessionId: string;
    lastSeen: string;
    path: string;
  }> {
    this.#expireSessions();
    return Array.from(this.#activeSessions.values(), (session) => ({
      ...session,
    }));
  }

  async stop(): Promise<void> {
    this.#running = false;
    this.#abort?.abort();
    for (const w of this.#watchers) {
      try {
        w.close();
      } catch {
        // Ignore
      }
    }
    this.#watchers = [];

    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
    await this.#poll;
    await Promise.allSettled(this.#pending);
  }
}
