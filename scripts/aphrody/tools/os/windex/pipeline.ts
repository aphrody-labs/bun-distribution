// SPDX-License-Identifier: Apache-2.0
// The single windex pipeline: walk + worker analysis -> PostgreSQL (the one base) -> deferred catalog pass ->
// ApiSet/services -> graph edges -> cache invalidation -> NDJSON projection. The scan command, the watcher's
// subtree rescans and the tests all go through these functions.
import type { RedisClient, SQL } from "bun";
import type { EntryRecord } from "./analyze.ts";
import { invalidatePrefix } from "./cache.ts";
import { defaultExcludes, normalizeRoot, pathKey, underRoot, type Config, type HashMode } from "./config.ts";
import { driveDir, exportSnapshot, type ExportResult } from "./ndjson.ts";
import { readMft, Volume, type MftIndex } from "./ntfs.ts";
import {
  dbNow,
  getVolume,
  linkParents,
  pendingCatalog,
  previousState,
  refreshImporters,
  refreshPeEdges,
  roots,
  setCatalogs,
  setVolume,
  sweep,
  touchSubtree,
  upsertEntries,
  upsertRoot,
  type Root,
} from "./pg.ts";
import type { Pool } from "./pool.ts";
import { scanRoot, type ScanStats } from "./scan.ts";
import { loadApiSet, loadServices } from "./system.ts";
import { volumeSerial } from "./win32.ts";

export type Log = (msg: string) => void;

export type ScanRequest = {
  root: string;
  hash: HashMode;
  graph: boolean;
  maxHashBytes: number;
  /** Ignore the stored state: re-read every file. */
  full?: boolean;
  /** Run the deferred catalog-signature pass after the primary indexing (default true). */
  catalog?: boolean;
  /** Write the NDJSON snapshot of the root (default: volume roots only). */
  export?: boolean;
  excludes?: string[];
};

export type ScanReport = ScanStats & {
  peWritten: number;
  swept: number;
  catalog: CatalogStats | null;
  apiset: number;
  services: number;
  invalidated: number | null;
  snapshot: ExportResult | null;
  checkpoint: string | null;
};

/** Hash policy of a path: the deepest registered root containing it wins, else the request's own. */
export function hashPolicy(registered: Root[], fallback: HashMode): (path: string) => HashMode {
  const sorted = registered.toSorted((a, b) => b.path.length - a.path.length);
  return path => sorted.find(r => underRoot(path, r.path))?.hashMode ?? fallback;
}

/** Records the journal position before a walk so the watcher replays whatever changes during it. */
function journalCheckpoint(drive: string): { journalId: bigint; nextUsn: bigint } | null {
  try {
    const vol = Volume.open(drive);
    try {
      const j = vol.queryOrCreate();
      return { journalId: j.journalId, nextUsn: j.nextUsn };
    } finally {
      vol.close();
    }
  } catch {
    // Not elevated: no checkpoint, the watcher falls back to its own start position.
    return null;
  }
}

export async function scan(
  cfg: Config,
  sql: SQL,
  pool: Pool,
  req: ScanRequest,
  redis: RedisClient | null,
  log: Log,
): Promise<ScanReport> {
  const root = normalizeRoot(req.root);
  const drive = root.slice(0, 1);
  const isVolume = /^[A-Z]:\\$/.test(root);
  await upsertRoot(sql, { path: root, hashMode: req.hash, graph: req.graph });
  const since = await dbNow(sql);
  const checkpoint = journalCheckpoint(drive);
  if (checkpoint) {
    const stored = await getVolume(sql, drive);
    // Keep an older watcher checkpoint (it replays more); seed one when there is none or the journal changed.
    if (!stored || stored.journalId !== checkpoint.journalId) {
      await setVolume(sql, {
        letter: drive,
        serial: volumeSerial(`${drive}:\\`),
        ...checkpoint,
      });
    }
  }
  let mft: MftIndex | undefined;
  if (isVolume && checkpoint) {
    log(`lecture de la MFT ${drive}: ...`);
    mft = readMft(drive);
    log(`MFT ${drive}: ${mft.records} enregistrements en ${Math.round(mft.ms)} ms`);
  }
  const prev = req.full ? undefined : await previousState(sql, root);
  if (prev) log(`état précédent : ${prev.size} fichiers`);
  const registered = await roots(sql);
  const peIds: number[] = [];
  const peNames = new Set<string>();
  let buffer: EntryRecord[] = [];
  const flush = async () => {
    if (!buffer.length) return;
    const part = buffer;
    buffer = [];
    const r = await upsertEntries(sql, part);
    peIds.push(...r.pe);
    for (const rec of part)
      if (rec.pe && rec.pe.kind !== "exe") peNames.add(pathKey(rec.path.slice(rec.path.lastIndexOf("\\") + 1)));
  };
  const unreadable: string[] = [];
  const stats = await scanRoot({
    root,
    hash: req.hash,
    hashFor: hashPolicy(registered, req.hash),
    maxHashBytes: req.maxHashBytes,
    excludes: req.excludes ?? defaultExcludes(cfg.home),
    pool,
    mft,
    prev,
    unreadable,
    sink: async records => {
      buffer.push(...records);
      if (buffer.length >= 2000) await flush();
    },
    progress: s =>
      log(
        `${s.entries} entrées (${s.files} fichiers, ${s.pe} PE, ${s.unchanged} inchangés, ${s.errors} erreurs) en ${Math.round(s.ms / 1000)} s`,
      ),
  });
  await flush();
  mft = undefined;
  log(`parcours terminé : ${stats.entries} entrées en ${Math.round(stats.ms)} ms ; liaison des parents`);
  await linkParents(sql);
  for (const dir of unreadable) await touchSubtree(sql, dir);
  const swept = await sweep(sql, root, since);
  if (swept) log(`${swept} entrées disparues supprimées`);

  let apiset = 0;
  let services = 0;
  if (underRoot(`${root.slice(0, 2)}\\Windows\\System32`, root) || underRoot(root, `${root.slice(0, 2)}\\Windows`)) {
    apiset = await loadApiSet(sql);
    log(`ApiSet : ${apiset} contrats`);
  }
  log(`arêtes import/export de ${peIds.length} images PE`);
  await refreshPeEdges(sql, peIds);
  if (prev?.size && peNames.size) await refreshImporters(sql, [...peNames]);
  if (apiset) {
    services = await loadServices(sql);
    log(`services et pilotes : ${services}`);
  }
  const catalog = req.catalog === false ? null : await catalogPass(sql, pool, root, log);
  await upsertRoot(sql, { path: root, hashMode: req.hash, graph: req.graph }, stats);

  let invalidated: number | null = null;
  if (redis) {
    try {
      invalidated = await invalidatePrefix(redis, root);
    } catch (e) {
      log(`Redis indisponible, cache non invalidé : ${(e as Error).message}`);
    }
  }
  const snapshot = (req.export ?? isVolume) ? await exportSnapshot(sql, root, driveDir(cfg.dir, drive)) : null;
  if (snapshot) log(`instantané NDJSON : ${snapshot.file} (${snapshot.entries} entrées)`);
  return {
    ...stats,
    peWritten: peIds.length,
    swept,
    catalog,
    apiset,
    services,
    invalidated,
    snapshot,
    checkpoint: checkpoint ? checkpoint.nextUsn.toString() : null,
  };
}

export type CatalogStats = { checked: number; catalog: number; ms: number };

/** Deferred catalog-signature pass over the PE images still unchecked, in the worker pool. */
export async function catalogPass(sql: SQL, pool: Pool, root: string | undefined, log: Log): Promise<CatalogStats> {
  const t0 = performance.now();
  const stats: CatalogStats = { checked: 0, catalog: 0, ms: 0 };
  let after = 0;
  const per = 32;
  for (;;) {
    const page = await pendingCatalog(sql, after, per * pool.size * 4, root);
    if (!page.length) break;
    after = page.at(-1)!.id;
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < page.length; i += per) {
      const part = page.slice(i, i + per);
      const { done } = await pool.catalogs(part.map(p => p.path));
      jobs.push(
        done.then(async sigs => {
          const rows = part.map((p, k) => ({
            id: p.id,
            catalog: sigs[k]?.catalog ?? null,
            signer: sigs[k]?.signer ?? null,
            issuer: sigs[k]?.issuer ?? null,
            digest: sigs[k]?.digest ?? null,
          }));
          await setCatalogs(sql, rows);
          stats.checked += rows.length;
          stats.catalog += rows.filter(r => r.catalog).length;
        }),
      );
    }
    await Promise.all(jobs);
    log(`catalogues : ${stats.checked} images vérifiées, ${stats.catalog} signées par catalogue`);
  }
  stats.ms = performance.now() - t0;
  return stats;
}
