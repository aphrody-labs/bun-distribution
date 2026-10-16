// SPDX-License-Identifier: Apache-2.0
// Recursive scanner: Bun fs directory walk (bounded memory, junctions recorded but never followed), optional MFT
// attributes, analysis in the worker pool and ordered delivery of the records to the sinks.
import { readdirSync } from "node:fs";
import type { EntryRecord, Task } from "./analyze.ts";
import { hash52, pathKey, type HashMode } from "./config.ts";
import type { MftIndex } from "./ntfs.ts";
import type { Pool } from "./pool.ts";
import { recordOf } from "./usn.ts";

export type WalkEntry = { path: string; dir: boolean; link: boolean };

export function excluded(path: string, excludes: string[]): boolean {
  const p = pathKey(path);
  for (const e of excludes) {
    const k = pathKey(e);
    if (p === k || p.startsWith(k.endsWith("\\") ? k : `${k}\\`)) return true;
  }
  return false;
}

/** Depth-first walk of `root` (the root itself first); unreadable directories are reported through `onError`. */
export function* walk(
  root: string,
  excludes: string[] = [],
  onError: (path: string, code: string) => void = () => {},
): Generator<WalkEntry> {
  yield { path: root, dir: true, link: false };
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      onError(dir, (e as NodeJS.ErrnoException).code ?? String(e));
      continue;
    }
    for (const e of entries) {
      const path = dir.endsWith("\\") ? `${dir}${e.name}` : `${dir}\\${e.name}`;
      if (excludes.length && excluded(path, excludes)) continue;
      const link = e.isSymbolicLink();
      const isDir = e.isDirectory();
      yield { path, dir: isDir, link };
      if (isDir && !link) stack.push(path);
    }
  }
}

export type ScanStats = {
  root: string;
  entries: number;
  dirs: number;
  files: number;
  pe: number;
  hashed: number;
  unchanged: number;
  errors: number;
  walkErrors: number;
  ms: number;
};

export type ScanOptions = {
  root: string;
  hash: HashMode;
  maxHashBytes: number;
  excludes: string[];
  /** Per-path policy (a deeper registered root may hash more than the scanned one); defaults to `hash`. */
  hashFor?: (path: string) => HashMode;
  pool: Pool;
  mft?: MftIndex;
  /** `hash52(path_lc) -> stateValue(size, mtimeMs)` of the stored records (incremental skip). */
  prev?: Map<number, number>;
  /** Directories that could not be listed (their stored subtree must survive the sweep). */
  unreadable?: string[];
  batch?: number;
  /** Receives records in completion order; awaited sequentially (back-pressure). */
  sink: (records: EntryRecord[]) => Promise<void>;
  progress?: (s: ScanStats) => void;
};

export async function scanRoot(opts: ScanOptions): Promise<ScanStats> {
  const t0 = performance.now();
  const stats: ScanStats = {
    root: opts.root,
    entries: 0,
    dirs: 0,
    files: 0,
    pe: 0,
    hashed: 0,
    unchanged: 0,
    errors: 0,
    walkErrors: 0,
    ms: 0,
  };
  const size = opts.batch ?? 64;
  let sinkChain: Promise<void> = Promise.resolve();
  let sinkPending = 0;
  let sinkError: unknown;
  const inflight = new Set<Promise<void>>();
  let lastProgress = 0;

  const deliver = (records: EntryRecord[]) => {
    for (const r of records) {
      stats.entries++;
      if (r.dir) stats.dirs++;
      else stats.files++;
      if (r.pe) stats.pe++;
      if (r.sha256) stats.hashed++;
      if (r.unchanged) stats.unchanged++;
      if (r.error) stats.errors++;
      if (opts.mft && r.frn) {
        const a = opts.mft.attributes.get(recordOf(BigInt(r.frn)));
        if (a !== undefined) r.attrs = a;
      }
    }
    sinkPending++;
    sinkChain = sinkChain
      .then(() => opts.sink(records))
      .catch((e) => {
        sinkError ??= e;
      })
      .finally(() => {
        sinkPending--;
      });
    const now = performance.now();
    if (opts.progress && now - lastProgress > 2000) {
      lastProgress = now;
      opts.progress({ ...stats, ms: now - t0 });
    }
  };

  const dispatch = async (tasks: Task[]) => {
    const { done } = await opts.pool.submit(tasks);
    const p: Promise<void> = done
      .then(deliver)
      .finally(() => inflight.delete(p));
    inflight.add(p);
    // The sinks (PostgreSQL) bound the scan: never queue more than a few batches ahead of them.
    while (sinkPending > 16) await sinkChain;
    if (sinkError) throw sinkError;
  };

  let batch: Task[] = [];
  const onError = (path: string) => {
    stats.walkErrors++;
    opts.unreadable?.push(path);
  };
  for (const e of walk(opts.root, opts.excludes, onError)) {
    batch.push({
      path: e.path,
      dir: e.dir,
      hash: opts.hashFor ? opts.hashFor(e.path) : opts.hash,
      maxHashBytes: opts.maxHashBytes,
      prev:
        e.dir || !opts.prev?.size
          ? undefined
          : opts.prev.get(hash52(pathKey(e.path))),
      skipAttrs: opts.mft !== undefined,
    });
    if (batch.length >= size) {
      await dispatch(batch);
      batch = [];
    }
  }
  if (batch.length) await dispatch(batch);
  await Promise.all(inflight);
  await sinkChain;
  if (sinkError) throw sinkError;
  stats.ms = performance.now() - t0;
  return stats;
}
