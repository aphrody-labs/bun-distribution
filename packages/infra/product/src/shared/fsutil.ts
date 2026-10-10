import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

export interface TreeStats {
  bytes: number;
  files: number;
}

/** Total size of a tree without following symlinks. Missing paths count as empty. */
export async function treeStats(path: string): Promise<TreeStats> {
  const stats: TreeStats = { bytes: 0, files: 0 };
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        try {
          const info = await lstat(full);
          stats.bytes += info.size;
          stats.files += 1;
        } catch {
          // vanished or locked: ignore
        }
      }),
    );
  }
  try {
    const info = await lstat(path);
    if (info.isDirectory()) await walk(path);
    else return { bytes: info.size, files: 1 };
  } catch {
    // missing
  }
  return stats;
}

export interface ClearResult extends TreeStats {
  skipped: number;
}

/**
 * Remove the CONTENT of `dir` (never `dir` itself), entries older than `olderThanMs` only when given.
 * Locked entries are skipped, not fatal. Nothing is touched unless `apply` is true.
 */
export async function clearDir(dir: string, apply: boolean, olderThanMs = 0): Promise<ClearResult> {
  const result: ClearResult = { bytes: 0, files: 0, skipped: 0 };
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  const limit = Date.now() - olderThanMs;
  for (const entry of entries) {
    const full = join(dir, entry.name);
    try {
      // oxlint-disable-next-line no-await-in-loop -- entries are measured and pruned one at a time in directory order (bounded I/O on large trees; deterministic removal)
      const info = await lstat(full);
      if (olderThanMs > 0 && info.mtimeMs > limit) continue;
      // oxlint-disable-next-line no-await-in-loop -- entries are measured and pruned one at a time in directory order (bounded I/O on large trees; deterministic removal)
      const stats = entry.isDirectory() ? await treeStats(full) : { bytes: info.size, files: 1 };
      // oxlint-disable-next-line no-await-in-loop -- entries are measured and pruned one at a time in directory order (bounded I/O on large trees; deterministic removal)
      if (apply) await rm(full, { recursive: true, force: true, maxRetries: 1 });
      result.bytes += stats.bytes;
      result.files += stats.files;
    } catch {
      result.skipped += 1;
    }
  }
  return result;
}

// Expand a pattern containing `*` (e.g. `Profiles\\*\\cache2`); a pattern without `*` is returned as is.
export async function expandStar(pattern: string): Promise<string[]> {
  const normalized = pattern.replaceAll("\\", "/");
  const star = normalized.indexOf("*");
  if (star === -1) return [pattern];
  const rootEnd = normalized.lastIndexOf("/", star);
  const root = normalized.slice(0, rootEnd);
  const rest = normalized.slice(rootEnd + 1);
  const out: string[] = [];
  try {
    for await (const match of new Bun.Glob(rest).scan({ cwd: root, onlyFiles: false, dot: true })) {
      out.push(join(root, match));
    }
  } catch {
    // root missing
  }
  return out;
}
