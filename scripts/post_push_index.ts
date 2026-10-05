#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Native Bun Redis Codebase Indexer Hook
 *
 * Triggered on git push or commit to incrementally index source files
 * into Redis across main and dev branches.
 */
import { existsSync } from "node:fs";
import { NativeRedisClient } from "../packages/core/src/redis/client";
import { indexCodebaseToRedis } from "../packages/core/src/redis/indexer";
import { findRepoRoot } from "../packages/core/src/vfs/index";

async function main() {
  const root = findRepoRoot();

  // Determine current branch
  let currentBranch = "dev";
  try {
    const gitBranch = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    if (gitBranch.exitCode === 0) {
      currentBranch = gitBranch.stdout.toString().trim() || "dev";
    }
  } catch {
    // fallback
  }

  const targetBranches = process.argv[2] ? [process.argv[2]] : [currentBranch, "dev", "main"];
  const uniqueBranches = Array.from(new Set(targetBranches));

  console.log(`[Redis Indexer] Connecting to native Redis at 127.0.0.1:6379...`);
  const redis = new NativeRedisClient({ hostname: "127.0.0.1", port: 6379 });

  try {
    await redis.connect();
    const pong = await redis.ping();
    if (pong !== "PONG") {
      console.warn("[Redis Indexer] Unexpected ping response:", pong);
      process.exit(0);
    }
  } catch (err) {
    console.warn(
      `[Redis Indexer] Redis unavailable (${(err as Error).message}), skipping indexation.`,
    );
    process.exit(0);
  }

  console.log(
    `[Redis Indexer] Indexing repositories across branches: ${uniqueBranches.join(", ")}`,
  );

  // By default, only index yolo repository to prevent unintended cross-repo pollution.
  // Multi-repository indexing (aphrody, aphrody-py) requires explicit --all or YOLO_INDEX_ALL=1.
  const includeAllRepos = process.argv.includes("--all") || process.env.YOLO_INDEX_ALL === "1";
  const repos = includeAllRepos
    ? [
        { name: "yolo", path: root },
        { name: "aphrody", path: "/home/aphro/aphrody" },
        { name: "aphrody-py", path: "/home/aphro/aphrody-py" },
      ]
    : [{ name: "yolo", path: root }];

  for (const repo of repos) {
    if (!existsSync(repo.path)) continue;

    for (const branch of uniqueBranches) {
      console.log(`[Redis Indexer] Indexing ${repo.name} [${branch}]...`);
      try {
        const result = await indexCodebaseToRedis(repo.path, `${repo.name}:${branch}`, redis);
        console.log(
          `[Redis Indexer] ${repo.name} [${branch}]: ${result.totalFiles} files (${result.updatedFiles} updated, ${result.skippedFiles} skipped, ${result.totalBytes} bytes) in ${result.durationMs}ms [hash: ${result.treeFingerprint}]`,
        );
      } catch (err) {
        console.warn(
          `[Redis Indexer] Failed indexing ${repo.name} [${branch}]: ${(err as Error).message}`,
        );
      }
    }
  }

  redis.close();
  console.log("[Redis Indexer] Incremental Redis codebase indexation complete.");
}

main().catch((err) => {
  console.error("[Redis Indexer] Fatal error:", err);
  process.exit(1);
});
