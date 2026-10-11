// SPDX-License-Identifier: Apache-2.0
/**
 * Autonomous Full-Stack Synchronizer & Context Optimizer
 *
 * Links Codebase indexing, Git state, Web search / Context7 doc cache,
 * and Multi-Agent active consumer coordination under Bun & systemd.
 */
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { recordTrainingSample } from "../ledger/index";
import type { NativeRedisClient } from "../redis/client";
import { indexCodebaseToRedis } from "../redis/indexer";
import { findRepoRoot } from "../vfs/index";

export interface GitRepoState {
  repo: string;
  branch: string;
  commit: string;
  dirty: boolean;
  uncommittedCount: number;
  error?: string;
}

export interface SyncCycleResult {
  timestamp: string;
  repos: Record<string, GitRepoState>;
  indexedFilesCount: number;
  beaconWritten: boolean;
  docCacheHits: number;
}

export interface AutoSyncOptions {
  redisClient?: NativeRedisClient | undefined;
  sqliteDb?: Database | undefined;
  syncIntervalMs?: number | undefined;
  trackedRepos?: string[] | undefined;
  beaconPaths?: string[] | undefined;
  gitTimeoutMs?: number | undefined;
  docCacheTtlMs?: number | undefined;
  docCacheMaxEntries?: number | undefined;
}

const positiveLimit = (value: number | undefined, fallback: number): number => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1)
    throw new RangeError("Monitor limits must be positive integers");
  return result;
};

export class AutoSyncEngine {
  #redis: NativeRedisClient | null = null;
  #db: Database | null = null;
  #timer: Timer | null = null;
  #lastCommits = new Map<string, string>();
  #trackedRepos: string[];
  #docCacheHits = 0;
  #intervalMs: number;
  #gitTimeoutMs: number;
  #beaconPaths: string[];
  #cycle: Promise<SyncCycleResult> | null = null;
  #cache = new Map<string, { value: string; expires: number }>();
  #docRequests = new Map<string, Promise<string>>();
  #cacheTtlMs: number;
  #cacheMaxEntries: number;

  constructor(options: AutoSyncOptions = {}) {
    this.#redis = options.redisClient ?? null;
    this.#db = options.sqliteDb ?? null;

    this.#intervalMs = positiveLimit(options.syncIntervalMs, 60000);
    this.#gitTimeoutMs = positiveLimit(options.gitTimeoutMs, 10000);
    this.#cacheTtlMs = positiveLimit(options.docCacheTtlMs, 3600000);
    this.#cacheMaxEntries = positiveLimit(options.docCacheMaxEntries, 128);
    this.#beaconPaths = options.beaconPaths ?? [
      join(homedir(), "src", "aphrody", ".coord", "shared", "YOLO-DAEMON-SYNC.json"),
      join(homedir(), ".aphrody", "ai", "yolo-sync.json"),
      join(findRepoRoot(), "var", "yolo-sync.json"),
    ];
    const yoloRoot = findRepoRoot();
    const aphrodyRoot = join(homedir(), "src", "aphrody");
    this.#trackedRepos = options.trackedRepos ?? [
      yoloRoot,
      ...(existsSync(aphrodyRoot) ? [aphrodyRoot] : []),
    ];
  }

  async getGitState(repoPath: string): Promise<GitRepoState> {
    const canonical = resolve(repoPath);
    const name = basename(canonical);
    const repoName =
      this.#trackedRepos.filter((path) => basename(resolve(path)) === name).length > 1
        ? canonical
        : name;
    const run = async (args: string[]) => {
      const proc = Bun.spawn(["git", "-C", canonical, ...args], {
        windowsHide: true,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        stdout: "pipe",
        stderr: "ignore",
      });
      const timer = setTimeout(() => proc.kill(), this.#gitTimeoutMs);
      try {
        const [output, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        if (code !== 0) throw new Error(`git ${args[0]} failed (${code})`);
        return output.trim();
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      // One spawn: porcelain v2 carries the head commit and branch in its `# branch.*` headers.
      const statusText = await run(["status", "--porcelain=v2", "--branch"]);
      const header = (key: string) =>
        statusText.match(new RegExp(`^# branch\\.${key} (.+)$`, "m"))?.[1]?.trim();
      const lines = statusText.split("\n").filter((line) => line && !line.startsWith("#"));
      const commit = header("oid");
      if (!commit || commit === "(initial)") throw new Error("git rev-parse failed (no commit)");
      const head = header("head");
      return {
        repo: repoName,
        branch: head && head !== "(detached)" ? head : "(detached)",
        commit,
        dirty: lines.length > 0,
        uncommittedCount: lines.length,
      };
    } catch (error) {
      return {
        repo: repoName,
        branch: "unknown",
        commit: "unknown",
        dirty: false,
        uncommittedCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  runSyncCycle(forceIndex = false): Promise<SyncCycleResult> {
    if (this.#cycle) return this.#cycle;
    this.#cycle = this.#runCycle(forceIndex).finally(() => {
      this.#cycle = null;
    });
    return this.#cycle;
  }

  async #runCycle(forceIndex: boolean): Promise<SyncCycleResult> {
    const now = new Date().toISOString();
    const reposState: Record<string, GitRepoState> = {};
    let totalIndexed = 0;

    // 1. Inspect Git state across tracked repositories
    for (const repoPath of this.#trackedRepos) {
      // oxlint-disable-next-line no-await-in-loop -- repos are processed one at a time: each repo's Redis write and index run must finish before the next repo's git state is read
      const state = await this.getGitState(repoPath);
      reposState[state.repo] = state;

      const prevCommit = this.#lastCommits.get(resolve(repoPath));
      const commitChanged = prevCommit !== state.commit;

      // Stream to Redis
      if (this.#redis?.isConnected) {
        // oxlint-disable-next-line no-await-in-loop -- sequential per repo: the Redis hash write is ordered before the next repo is processed
        await this.#redis
          .hset(`yolo:sync:git:${state.repo}`, {
            branch: state.branch,
            commit: state.commit,
            dirty: state.dirty ? "1" : "0",
            uncommitted: String(state.uncommittedCount),
            syncedAt: now,
          })
          .catch(() => {});
      }

      // 2. Incremental codebase indexer if commit changed or forced
      if (!state.error && (commitChanged || forceIndex) && this.#redis?.isConnected) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- indexing is sequential per repo: it updates shared Redis keys and the lastCommits cache in order
          const indexRes = await indexCodebaseToRedis(repoPath, state.commit, this.#redis);
          totalIndexed += indexRes.updatedFiles;
          this.#lastCommits.set(resolve(repoPath), state.commit);
        } catch {
          // Continue on indexing warning
        }
      }
    }

    // 3. Emit factual Context Beacon for all agent consumers (AGY, Codex, Claude)
    const beaconWritten = this.writeContextBeacon(reposState, now);

    // 4. Record factual training sample for autonomous self-training loop
    if (this.#db) {
      try {
        recordTrainingSample(this.#db, {
          sampleId: `sync-${Date.now()}`,
          profile: "yolo",
          domain: "auto-sync-engine",
          instruction: "Synchronize repositories, Git status, and context beacon",
          inputContext: JSON.stringify(this.#trackedRepos),
          action: "runSyncCycle",
          outcome: JSON.stringify({
            repos: reposState,
            totalIndexed,
            timestamp: now,
          }),
          rewardScore: 1.0,
          createdAt: now,
        });
      } catch {
        // Ignore DB transient
      }
    }

    return {
      timestamp: now,
      repos: reposState,
      indexedFilesCount: totalIndexed,
      beaconWritten,
      docCacheHits: this.#docCacheHits,
    };
  }

  writeContextBeacon(repos: Record<string, GitRepoState>, timestamp: string): boolean {
    const beacon = {
      schema: "yolo.sync.beacon/1",
      generated_at: timestamp,
      repositories: repos,
      context_optimizations: {
        max_context_tokens: 4000,
        mcp_servers: ["yolo", "aphrody"],
        caching_layer: this.#redis?.isConnected ? "redis+memory" : "memory",
        doc_routing: "bun-docs-router+context7",
      },
    };

    let written = false;
    for (const target of this.#beaconPaths) {
      try {
        const dir = dirname(target);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        const temporary = `${target}.${crypto.randomUUID()}.tmp`;
        try {
          writeFileSync(temporary, JSON.stringify(beacon, null, 2), { mode: 0o600 });
          renameSync(temporary, target);
        } finally {
          rmSync(temporary, { force: true });
        }
        written = true;
      } catch {
        // Best-effort write
      }
    }
    return written;
  }

  cachedDocQuery(query: string, fetcher: () => Promise<string>): Promise<string> {
    const cacheKey = `yolo:cache:docs:${query.trim().toLowerCase()}`;
    const existing = this.#cache.get(cacheKey);
    if (existing && existing.expires > Date.now()) {
      this.#docCacheHits++;
      return Promise.resolve(existing.value);
    }
    if (this.#docRequests.has(cacheKey)) return this.#docRequests.get(cacheKey)!;
    const request = this.#fetchDoc(cacheKey, fetcher).finally(() =>
      this.#docRequests.delete(cacheKey),
    );
    this.#docRequests.set(cacheKey, request);
    return request;
  }

  async #fetchDoc(cacheKey: string, fetcher: () => Promise<string>): Promise<string> {
    let value: string | null = null;
    if (this.#redis?.isConnected) {
      try {
        value = await this.#redis.get(cacheKey);
        if (value !== null) this.#docCacheHits++;
      } catch {
        /* Fetch from the source when Redis is unavailable. */
      }
    }
    if (value === null) {
      value = await fetcher();
      if (this.#redis?.isConnected) {
        try {
          await this.#redis.set(cacheKey, value, Math.ceil(this.#cacheTtlMs / 1000));
        } catch {
          /* Retain the bounded memory cache. */
        }
      }
    }
    this.#cache.delete(cacheKey);
    while (this.#cache.size >= this.#cacheMaxEntries)
      this.#cache.delete(this.#cache.keys().next().value!);
    this.#cache.set(cacheKey, { value, expires: Date.now() + this.#cacheTtlMs });
    return value;
  }

  startPeriodic(intervalMs = this.#intervalMs): void {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1)
      throw new RangeError("Invalid sync interval");
    if (this.#timer) return;
    void this.runSyncCycle().catch(() => {});
    this.#timer = setInterval(() => {
      void this.runSyncCycle().catch(() => {});
    }, intervalMs);
  }

  async stop(): Promise<void> {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    await this.#cycle;
  }
}
