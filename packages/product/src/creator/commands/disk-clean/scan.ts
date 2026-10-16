import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface BigFile {
  path: string;
  bytes: number;
  mtimeMs: number;
}

export interface WalkResult {
  files: BigFile[];
  /** Size of each direct child directory of the root. */
  topDirs: { path: string; bytes: number }[];
  totalBytes: number;
  totalFiles: number;
}

/** Walk `root` without following links; keep the `topFiles` largest files and `keepAll` files >= `minKeep` bytes. */
export async function walk(
  root: string,
  opts: {
    topFiles: number;
    minKeep?: number;
    onFile?: (file: BigFile) => void;
  },
): Promise<WalkResult> {
  const files: BigFile[] = [];
  const dirBytes = new Map<string, number>();
  let totalBytes = 0;
  let totalFiles = 0;

  async function visit(dir: string, bucket: string | undefined): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // oxlint-disable-next-line no-await-in-loop -- parcours récursif séquentiel : ordre stable et nombre de handles borné
        await visit(full, bucket ?? full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        // oxlint-disable-next-line no-await-in-loop -- les callbacks onFile et les totaux sont cumulés dans l'ordre du parcours
        const info = await lstat(full);
        totalBytes += info.size;
        totalFiles += 1;
        if (bucket)
          dirBytes.set(bucket, (dirBytes.get(bucket) ?? 0) + info.size);
        const file = { path: full, bytes: info.size, mtimeMs: info.mtimeMs };
        opts.onFile?.(file);
        if (opts.minKeep === undefined) {
          files.push(file);
          if (files.length > opts.topFiles * 4) {
            files.sort((a, b) => b.bytes - a.bytes);
            files.length = opts.topFiles;
          }
        }
      } catch {
        // locked or vanished
      }
    }
  }
  await visit(root, undefined);
  files.sort((a, b) => b.bytes - a.bytes);
  return {
    files: files.slice(0, opts.topFiles),
    topDirs: [...dirBytes]
      .map(([path, bytes]) => ({ path, bytes }))
      .toSorted((a, b) => b.bytes - a.bytes),
    totalBytes,
    totalFiles,
  };
}

async function partialHash(path: string, size: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const chunk = Math.min(65_536, size);
    const head = Buffer.alloc(chunk);
    await handle.read(head, 0, chunk, 0);
    const tail = Buffer.alloc(chunk);
    await handle.read(tail, 0, chunk, Math.max(0, size - chunk));
    return new Bun.CryptoHasher("sha1").update(head).update(tail).digest("hex");
  } finally {
    await handle.close();
  }
}

async function fullHash(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

export interface DuplicateGroup {
  bytes: number;
  hash: string;
  paths: string[];
  /** Bytes reclaimed by keeping a single copy. */
  wasted: number;
}

/** Same size -> same head/tail -> same full hash. Read-only. */
export async function findDuplicates(
  root: string,
  minBytes: number,
): Promise<DuplicateGroup[]> {
  const bySize = new Map<number, string[]>();
  await walk(root, {
    topFiles: 0,
    minKeep: minBytes,
    onFile(file) {
      if (file.bytes < minBytes || file.bytes === 0) return;
      const list = bySize.get(file.bytes);
      if (list) list.push(file.path);
      else bySize.set(file.bytes, [file.path]);
    },
  });
  const groups: DuplicateGroup[] = [];
  for (const [bytes, paths] of bySize) {
    if (paths.length < 2) continue;
    const byPartial = new Map<string, string[]>();
    for (const path of paths) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- un seul fichier ouvert à la fois : évite l'épuisement des descripteurs sur les grands lots de même taille
        const key = await partialHash(path, bytes);
        byPartial.set(key, [...(byPartial.get(key) ?? []), path]);
      } catch {
        // unreadable: ignore
      }
    }
    for (const candidates of byPartial.values()) {
      if (candidates.length < 2) continue;
      const byFull = new Map<string, string[]>();
      for (const path of candidates) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- un seul fichier lu à la fois : borne les I/O disque et la mémoire des flux
          const key = await fullHash(path);
          byFull.set(key, [...(byFull.get(key) ?? []), path]);
        } catch {
          // unreadable: ignore
        }
      }
      for (const [hash, same] of byFull) {
        if (same.length > 1)
          groups.push({
            bytes,
            hash,
            paths: same.toSorted(),
            wasted: bytes * (same.length - 1),
          });
      }
    }
  }
  return groups.toSorted((a, b) => b.wasted - a.wasted);
}
