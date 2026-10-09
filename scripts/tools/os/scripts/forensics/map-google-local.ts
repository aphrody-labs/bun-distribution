// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
/**
 * Cross-platform forensic map generator for desktop application directories.
 * Unified Bun implementation (map-google-local.sh delegates here).
 *
 * Usage:
 *   bun scripts/tools/os/scripts/forensics/map-google-local.ts [target-dir] [out-dir] [max-hash-bytes]
 * The target defaults to %LOCALAPPDATA%\Google\Google on Windows.
 */
import { createHash } from "node:crypto";
import { readdir, stat, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative, extname, resolve } from "node:path";

const args = process.argv.slice(2);
const [targetGiven, outArg, hashArg] = args;
const localAppData = process.platform === "win32" ? process.env.LOCALAPPDATA : undefined;
const targetArg =
  targetGiven || (localAppData === undefined ? undefined : join(localAppData, "Google", "Google"));
if (targetArg === undefined || args.includes("--help") || args.includes("-h")) {
  console.log(
    "Usage: bun scripts/tools/os/scripts/forensics/map-google-local.ts [target-dir] [out-dir] [max-hash-bytes]\n" +
      "The target defaults to %LOCALAPPDATA%\\Google\\Google on Windows.",
  );
  process.exit(targetArg === undefined ? 2 : 0);
}

const targetDir = resolve(targetArg);
const outDir = resolve(outArg || "var/data/google-local-map");
const maxHashBytes = parseInt(hashArg || "1048576", 10);

const SECRET_PATTERNS = [
  "cookies",
  "login data",
  "web data",
  "credential",
  "token",
  "local state",
  "leveldb",
  ".ldb",
  "manifest-",
  "session storage",
  "local storage",
  "indexeddb",
  "network",
  "autofill",
  "password",
  "user_history",
  "preferences.txtpb",
  "global_preferences",
];

function isSecret(fullPath: string): boolean {
  const lower = fullPath.toLowerCase();
  return SECRET_PATTERNS.some((pat) => lower.includes(pat));
}

interface FileEntry {
  path: string;
  rel: string;
  size: number;
  ext: string;
  sha256: string | null;
  modified: string;
  mtime_unix: number;
  secret_meta_only: boolean;
}

async function scanRecursive(dir: string, entries: FileEntry[]) {
  let dirEntries;
  try {
    dirEntries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    console.error(`Warning: failed to read directory ${dir}:`, error);
    return;
  }

  for (const entry of dirEntries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanRecursive(fullPath, entries);
    } else if (entry.isFile()) {
      try {
        const fileStat = await stat(fullPath);
        const secret = isSecret(fullPath);
        let sha256: string | null = null;

        if (!secret && fileStat.size <= maxHashBytes) {
          try {
            const buf = await readFile(fullPath);
            sha256 = createHash("sha256").update(buf).digest("hex");
          } catch {
            sha256 = null;
          }
        }

        const ext = extname(entry.name).replace(/^\./, "").toLowerCase();
        entries.push({
          path: fullPath,
          rel: relative(targetDir, fullPath).replace(/\\/g, "/"),
          size: fileStat.size,
          ext,
          sha256,
          modified: fileStat.mtime.toISOString(),
          mtime_unix: Math.floor(fileStat.mtimeMs / 1000),
          secret_meta_only: secret,
        });
      } catch (error) {
        console.error(`Warning: failed to stat file ${fullPath}:`, error);
      }
    }
  }
}

try {
  await stat(targetDir);
} catch {
  console.error(`Target not found: ${targetDir}`);
  process.exit(2);
}

await mkdir(outDir, { recursive: true });

console.log(`[forensics] Scanning ${targetDir}...`);
const fileEntries: FileEntry[] = [];
await scanRecursive(targetDir, fileEntries);

const hashedCount = fileEntries.filter((f) => f.sha256 !== null).length;
const secretCount = fileEntries.filter((f) => f.secret_meta_only).length;

const payload = {
  scanned_at: new Date().toISOString(),
  target: targetDir,
  stats: {
    total_files: fileEntries.length,
    hashed_files: hashedCount,
    secret_meta_only: secretCount,
  },
  files: fileEntries,
};

const outFile = join(outDir, "tree.json");
await writeFile(outFile, JSON.stringify(payload, null, 2), "utf8");
console.log(
  `[forensics] Mapped ${fileEntries.length} files (${hashedCount} hashed, ${secretCount} secret-metadata-only) to ${outFile}`,
);
