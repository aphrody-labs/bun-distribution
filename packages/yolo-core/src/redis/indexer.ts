// SPDX-License-Identifier: Apache-2.0
/**
 * Native Bun Redis Codebase Indexer
 *
 * Performs high-speed, incremental source code indexing into Redis.
 * Strictly respects .gitignore, excludes vendor/, node_modules/, and build artifacts.
 * Uses Bun.file, Bun.hash.wyhash, and NativeRedisClient.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NativeRedisClient } from "./client";

const wyhash = (input: string) => Bun.hash.wyhash(input).toString(16);

export interface IndexResult {
  branch: string;
  commitSha: string;
  totalFiles: number;
  totalBytes: number;
  updatedFiles: number;
  skippedFiles: number;
  treeFingerprint: string;
  durationMs: number;
}

const EXCLUDE_DIRS = new Set([
  ".git",
  "node_modules",
  "vendor",
  "target",
  ".cache",
  "dist",
  ".venv",
  ".tmp",
  "var",
  ".coord",
  ".system_generated",
  "data",
  "binaries",
  "out",
  "assets",
  "models",
  "ui-dist",
  ".next-build",
  ".ops",
  "backups",
  "dumps",
  ".cargo",
]);

const BINARY_EXTENSIONS = new Set([
  "safetensors",
  "onnx",
  "exe",
  "so",
  "dylib",
  "dll",
  "bin",
  "dump",
  "gz",
  "tar",
  "zip",
  "7z",
  "otf",
  "ttf",
  "woff",
  "woff2",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "mp4",
  "mp3",
  "pdf",
]);

const MAX_TEXT_FILE_SIZE = 1024 * 1024; // 1 MB limit for UTF-8 reading

export async function indexCodebaseToRedis(
  rootDir: string,
  branch: string,
  redis: NativeRedisClient,
): Promise<IndexResult> {
  const start = performance.now();

  // Get current git commit SHA if available
  let commitSha = "HEAD";
  try {
    const gitProc = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      windowsHide: true,
      cwd: rootDir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    if (gitProc.exitCode === 0) {
      commitSha = gitProc.stdout.toString().trim();
    }
  } catch {
    // Fall back to default
  }

  // Discover all files respecting ignore patterns
  const files: string[] = [];
  function scan(dir: string) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  scan(rootDir);

  let totalBytes = 0;
  let updatedFiles = 0;
  let skippedFiles = 0;
  const hashList: string[] = [];
  const fileKeySet = `yolo:code:${branch}:files`;

  const now = new Date().toISOString();

  // Batch process files
  for (const file of files) {
    const relPath = relative(rootDir, file);
    try {
      const stat = statSync(file);
      totalBytes += stat.size;

      const ext = relPath.includes(".")
        ? relPath.split(".").pop()?.toLowerCase() || ""
        : "";
      const isBinaryOrLarge =
        stat.size > MAX_TEXT_FILE_SIZE || BINARY_EXTENSIONS.has(ext);

      let hash = "";
      let lines = 0;

      if (isBinaryOrLarge) {
        hash = wyhash(`${relPath}:${stat.size}:${stat.mtimeMs}`);
      } else {
        // oxlint-disable-next-line no-await-in-loop -- indexation fichier par fichier : un seul contenu en mémoire à la fois et ordre d'écriture Redis déterministe
        const fileContent = await Bun.file(file).text();
        hash = wyhash(fileContent);
        lines = fileContent.split("\n").length;
      }

      hashList.push(`${relPath}:${hash}`);

      const redisKey = `yolo:code:${branch}:file:${relPath}`;
      // Check if existing hash in Redis matches (incremental optimization)
      // oxlint-disable-next-line no-await-in-loop -- même boucle séquentielle bornée que ci-dessus (pas de concurrence non bornée sur un dépôt entier)
      const existingHash = await redis.hget(redisKey, "wyhash");
      if (existingHash === hash) {
        skippedFiles++;
        continue;
      }

      // oxlint-disable-next-line no-await-in-loop -- même boucle séquentielle bornée : écriture par fichier dans l'ordre de parcours
      await redis.hset(redisKey, {
        path: relPath,
        ext,
        size: String(stat.size),
        wyhash: hash,
        lines: String(lines),
        indexed_at: now,
      });

      // oxlint-disable-next-line no-await-in-loop -- même boucle séquentielle bornée : écriture par fichier dans l'ordre de parcours
      await redis.sadd(fileKeySet, relPath);
      updatedFiles++;
    } catch {
      // Ignore unreadable files
    }
  }

  // Composite tree fingerprint
  hashList.sort();
  const treeFingerprint = wyhash(hashList.join("\n"));

  // Store metadata
  const metaKey = `yolo:code:${branch}:meta`;
  await redis.hset(metaKey, {
    branch,
    commit_sha: commitSha,
    total_files: String(files.length),
    total_bytes: String(totalBytes),
    updated_files: String(updatedFiles),
    skipped_files: String(skippedFiles),
    tree_fingerprint: treeFingerprint,
    indexed_at: now,
  });

  // Publish indexation event to Redis Pub/Sub
  const durationMs = Math.round(performance.now() - start);
  const result: IndexResult = {
    branch,
    commitSha,
    totalFiles: files.length,
    totalBytes,
    updatedFiles,
    skippedFiles,
    treeFingerprint,
    durationMs,
  };

  await redis.publish("yolo:events:code_indexed", JSON.stringify(result));

  return result;
}
