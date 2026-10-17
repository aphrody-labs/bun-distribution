// SPDX-License-Identifier: Apache-2.0
// Real-time maintenance of the index. Elevated (administrator session or SYSTEM task): the directory tree comes
// from the MFT, then the NTFS USN journal is tailed (FSCTL_READ_USN_JOURNAL, non-blocking poll) from the checkpoint
// stored in windex.volume, so changes made while the watcher was stopped are replayed. Not elevated: a recursive
// fs.watch (ReadDirectoryChangesW) per registered root. Every applied change updates PostgreSQL, invalidates Redis,
// appends to the NDJSON journal and, debounced, refreshes the RAG cards. A lost checkpoint triggers an incremental
// rescan of the roots, never silent divergence.
import type { RedisClient, SQL } from "bun";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  watch as fsWatch,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { EntryRecord, Task } from "./analyze.ts";
import { connectRedis, EVENTS_CHANNEL, invalidate, type ChangeEvent } from "./cache.ts";
import { defaultExcludes, pathKey, RECORD_VERSION, underRoot, type Config, type HashMode } from "./config.ts";
import { driveDir, Journal } from "./ndjson.ts";
import { ERROR_JOURNAL_ENTRY_DELETED, readMft, Volume, Win32Error, type Journal as UsnJournal } from "./ntfs.ts";
import {
  connect,
  deletePath,
  getVolume,
  linkParentsOf,
  migrate,
  movePath,
  refreshImporters,
  refreshPeEdges,
  roots,
  setVolume,
  upsertEntries,
  type Root,
} from "./pg.ts";
import { hashPolicy, scan, type Log } from "./pipeline.ts";
import { Pool } from "./pool.ts";
import { buildCards, indexCards } from "./rag.ts";
import { excluded, scanRoot } from "./scan.ts";
import { loadApiSet, loadServices } from "./system.ts";
import { DATA_REASONS, FILE_ATTRIBUTE_DIRECTORY, USN_REASON, type DirTree, type UsnRecord } from "./usn.ts";
import { volumeSerial } from "./win32.ts";

export type WatchOptions = {
  pollMs: number;
  ragMinutes: number;
  log: Log;
  signal?: AbortSignal;
};

type PendingChange = {
  path: string;
  dir: boolean;
  reasons: number;
  first: number;
  closed: boolean;
  usn: bigint;
};
type Op =
  | { op: "delete"; path: string; dir: boolean; usn: bigint }
  | {
      op: "rename";
      from: string | null;
      to: string;
      dir: boolean;
      usn: bigint;
    };

const SETTLE_MS = 2000;
const ROOTS_REFRESH_MS = 60_000;
const SERVICES_REFRESH_MS = 3_600_000;
const LOG_DAYS = 7;

/** File logger under <home>/windex/logs (a SYSTEM task has no console). */
function fileLog(cfg: Config, base: Log): Log {
  const dir = join(cfg.dir, "logs");
  mkdirSync(dir, { recursive: true });
  const limit = new Date(Date.now() - LOG_DAYS * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
  for (const f of readdirSync(dir)) {
    const m = /^watch-(\d{8})\.log$/.exec(f);
    if (m && m[1]! < limit) rmSync(join(dir, f), { force: true });
  }
  return msg => {
    base(msg);
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    try {
      appendFileSync(join(dir, `watch-${day}.log`), `${new Date().toISOString()} ${msg}\n`);
    } catch {
      // Logging never stops the watcher.
    }
  };
}

/** Single instance per home: a PID lock file (a live owner, even another user's, keeps it). */
function acquireLock(cfg: Config): () => void {
  const file = join(cfg.dir, "watch.lock");
  mkdirSync(cfg.dir, { recursive: true });
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, "utf8").trim());
    let alive = false;
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (e) {
        alive = (e as NodeJS.ErrnoException).code === "EPERM";
      }
    }
    if (alive) throw new Error(`un watcher windex tourne déjà (pid ${pid})`);
  }
  writeFileSync(file, String(process.pid));
  return () => {
    try {
      if (readFileSync(file, "utf8").trim() === String(process.pid)) unlinkSync(file);
    } catch {
      // Already gone.
    }
  };
}

class Applier {
  registered: Root[] = [];
  private policy: (path: string) => HashMode = () => "pe";
  readonly excludes: string[];
  ragDirty = 0;
  applied = 0;

  constructor(
    readonly cfg: Config,
    readonly sql: SQL,
    readonly pool: Pool,
    public redis: RedisClient | null,
    readonly journal: Journal,
    readonly log: Log,
  ) {
    this.excludes = defaultExcludes(cfg.home);
  }

  async refreshRoots(): Promise<void> {
    this.registered = await roots(this.sql);
    this.policy = hashPolicy(this.registered, "pe");
  }

  relevant(path: string | null | undefined): path is string {
    if (!path) return false;
    return this.registered.some(r => underRoot(path, r.path)) && !excluded(path, this.excludes);
  }

  private underGraph(path: string): boolean {
    return this.registered.some(r => r.graph && underRoot(path, r.path));
  }

  /** Indexes a directory that appeared with content (moved in from outside the roots). */
  private async indexSubtree(dir: string): Promise<void> {
    const peIds: number[] = [];
    await scanRoot({
      root: dir,
      hash: this.policy(dir),
      hashFor: this.policy,
      maxHashBytes: 1 << 30,
      excludes: this.excludes,
      pool: this.pool,
      sink: async records => {
        peIds.push(...(await upsertEntries(this.sql, records)).pe);
      },
    });
    await linkParentsOf(this.sql, [dir]);
    await refreshPeEdges(this.sql, peIds);
  }

  /** Applies ordered structural ops then settled content changes; returns the events written. */
  async apply(ops: Op[], changes: PendingChange[]): Promise<ChangeEvent[]> {
    const events: ChangeEvent[] = [];
    const at = Date.now();
    for (const o of ops) {
      if (o.op === "delete") {
        if (!this.relevant(o.path)) continue;
        await deletePath(this.sql, o.path);
        events.push({
          v: RECORD_VERSION,
          op: "delete",
          path: o.path,
          dir: o.dir,
          usn: o.usn.toString(),
          at,
        });
        continue;
      }
      const fromRel = this.relevant(o.from);
      const toRel = this.relevant(o.to);
      if (fromRel && toRel) {
        const moved = await movePath(this.sql, o.from!, o.to);
        if (!moved)
          changes.push({
            path: o.to,
            dir: o.dir,
            reasons: USN_REASON.FILE_CREATE,
            first: 0,
            closed: true,
            usn: o.usn,
          });
        else if (o.dir) await linkParentsOf(this.sql, [o.to]);
      } else if (fromRel) {
        await deletePath(this.sql, o.from!);
      } else if (toRel) {
        if (o.dir) await this.indexSubtree(o.to);
        else
          changes.push({
            path: o.to,
            dir: false,
            reasons: USN_REASON.FILE_CREATE,
            first: 0,
            closed: true,
            usn: o.usn,
          });
      } else continue;
      events.push({
        v: RECORD_VERSION,
        op: fromRel && toRel ? "rename" : fromRel ? "delete" : "upsert",
        path: fromRel && !toRel ? o.from! : o.to,
        from: fromRel && toRel ? o.from! : undefined,
        dir: o.dir,
        usn: o.usn.toString(),
        at,
      });
    }
    const relevant = changes.filter(c => this.relevant(c.path));
    if (relevant.length) {
      // Metadata-only changes of stored files skip the content; anything else is fully re-analysed.
      const known = new Set<string>(
        (
          await this.sql.unsafe(
            `SELECT path_lc FROM windex.fs_node WHERE path_lc IN (SELECT jsonb_array_elements_text($1::jsonb))`,
            [relevant.map(c => pathKey(c.path))],
          )
        ).map((r: { path_lc: string }) => r.path_lc),
      );
      const tasks: Task[] = relevant.map(c => ({
        path: c.path,
        dir: c.dir,
        hash: this.policy(c.path),
        maxHashBytes: 1 << 30,
        catalog: true,
        metaOnly: !c.dir && known.has(pathKey(c.path)) && (c.reasons & DATA_REASONS) === 0 && c.reasons !== 0,
      }));
      const records: EntryRecord[] = [];
      for (let i = 0; i < tasks.length; i += 64) records.push(...(await this.pool.run(tasks.slice(i, i + 64))));
      const gone = records.filter(r => r.error === "ENOENT");
      for (const r of gone) {
        await deletePath(this.sql, r.path);
        events.push({
          v: RECORD_VERSION,
          op: "delete",
          path: r.path,
          dir: r.dir,
          usn: null,
          at,
        });
      }
      const live = records.filter(r => r.error !== "ENOENT");
      const maxUsn = relevant.reduce((m, c) => (c.usn > m ? c.usn : m), 0n);
      const r = await upsertEntries(this.sql, live, maxUsn || null);
      await linkParentsOf(
        this.sql,
        live.map(x => x.path),
      );
      await refreshPeEdges(this.sql, r.pe);
      const created = live.filter(
        x => x.pe && x.pe.kind !== "exe" && relevant.find(c => c.path === x.path)!.reasons & USN_REASON.FILE_CREATE,
      );
      if (created.length) {
        await refreshImporters(
          this.sql,
          created.map(x => x.path.slice(x.path.lastIndexOf("\\") + 1).toLowerCase()),
        );
      }
      if (live.some(x => pathKey(x.path).endsWith("\\system32\\apisetschema.dll"))) await loadApiSet(this.sql);
      for (const x of live) {
        events.push({
          v: RECORD_VERSION,
          op: "upsert",
          path: x.path,
          dir: x.dir,
          usn: maxUsn ? maxUsn.toString() : null,
          at,
        });
      }
    }
    if (!events.length) return events;
    this.journal.append(events);
    if (this.redis) {
      try {
        await invalidate(this.redis, events);
      } catch (e) {
        this.log(`Redis : invalidation impossible (${(e as Error).message}), reconnexion au prochain lot`);
        this.redis = null;
      }
    }
    if (events.some(e => this.underGraph(e.path))) this.ragDirty ||= Date.now();
    this.applied += events.length;
    return events;
  }
}

/** Turns USN records into ordered structural ops and coalesced content changes, maintaining the tree. */
export function collect(
  tree: DirTree,
  records: UsnRecord[],
  pending: Map<string, PendingChange>,
  ops: Op[],
  renames: Map<bigint, { path: string; dir: boolean }>,
  relevant: (path: string) => boolean,
): void {
  const now = Date.now();
  for (const rec of records) {
    const isDir = (rec.attributes & FILE_ATTRIBUTE_DIRECTORY) !== 0;
    const path = tree.childPath(rec.parentRecord, rec.name);
    if (isDir) {
      if (rec.reason & USN_REASON.FILE_DELETE) tree.delete(rec.record);
      else if (!(rec.reason & USN_REASON.RENAME_OLD_NAME)) tree.set(rec.record, rec.parentRecord, rec.name);
    }
    if (path === undefined) continue;
    if (rec.reason & USN_REASON.RENAME_OLD_NAME) {
      renames.set(rec.frn, { path, dir: isDir });
      continue;
    }
    if (rec.reason & USN_REASON.RENAME_NEW_NAME) {
      const old = renames.get(rec.frn);
      renames.delete(rec.frn);
      if (old && old.path === path) continue;
      if ((old && relevant(old.path)) || relevant(path)) {
        ops.push({
          op: "rename",
          from: old?.path ?? null,
          to: path,
          dir: isDir,
          usn: rec.usn,
        });
        if (old) {
          const p = pending.get(pathKey(old.path));
          if (p) {
            pending.delete(pathKey(old.path));
            pending.set(pathKey(path), { ...p, path });
          }
        }
      }
      continue;
    }
    if (!relevant(path)) continue;
    const key = pathKey(path);
    if (rec.reason & USN_REASON.FILE_DELETE) {
      pending.delete(key);
      ops.push({ op: "delete", path, dir: isDir, usn: rec.usn });
      continue;
    }
    const p = pending.get(key);
    if (p) {
      p.reasons |= rec.reason;
      p.closed ||= (rec.reason & USN_REASON.CLOSE) !== 0;
    } else {
      pending.set(key, {
        path,
        dir: isDir,
        reasons: rec.reason,
        first: now,
        closed: (rec.reason & USN_REASON.CLOSE) !== 0,
        usn: rec.usn,
      });
    }
  }
}

/** Settled changes: closed by their writer, directories, or open longer than SETTLE_MS. */
function settled(pending: Map<string, PendingChange>, force = false): PendingChange[] {
  const now = Date.now();
  const out: PendingChange[] = [];
  for (const [k, p] of pending) {
    if (force || p.closed || p.dir || now - p.first > SETTLE_MS) {
      out.push(p);
      pending.delete(k);
    }
  }
  return out;
}

export async function watch(cfg: Config, opts: WatchOptions): Promise<void> {
  const log = fileLog(cfg, opts.log);
  const release = acquireLock(cfg);
  const sql = connect(cfg, 4);
  const pool = new Pool(Math.max(2, Math.min(4, cfg.workers)));
  const journal = new Journal(driveDir(cfg.dir, "C"));
  let redis: RedisClient | null = null;
  const connectCache = async () => {
    try {
      redis = await connectRedis(cfg);
    } catch (e) {
      log(`Redis indisponible (${(e as Error).message}) : cache non invalidé jusqu'à reconnexion`);
      redis = null;
    }
  };
  let stop = false;
  const onSignal = () => {
    stop = true;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  opts.signal?.addEventListener("abort", onSignal);
  try {
    await migrate(sql);
    await connectCache();
    const applier = new Applier(cfg, sql, pool, redis, journal, log);
    await applier.refreshRoots();
    if (!applier.registered.length) log("aucune racine enregistrée : lancer `windex scan` (le watcher les suivra)");
    let vol: Volume | null = null;
    try {
      vol = Volume.open("C");
    } catch (e) {
      log(`journal USN inaccessible (${(e as Error).message}) : repli ReadDirectoryChangesW (fs.watch)`);
    }
    const timers = { roots: Date.now(), services: Date.now() };
    const housekeeping = async () => {
      if (Date.now() - timers.roots > ROOTS_REFRESH_MS) {
        timers.roots = Date.now();
        await applier.refreshRoots();
        if (!applier.redis) {
          await connectCache();
          applier.redis = redis;
        }
      }
      if (Date.now() - timers.services > SERVICES_REFRESH_MS) {
        timers.services = Date.now();
        log(`services et pilotes rechargés : ${await loadServices(sql)}`);
      }
      if (applier.ragDirty && Date.now() - applier.ragDirty > opts.ragMinutes * 60_000 && !ragRunning) {
        applier.ragDirty = 0;
        ragRunning = true;
        void (async () => {
          try {
            const cards = await buildCards(sql, cfg);
            const r = await indexCards(cfg, cards.dir);
            log(`RAG : ${cards.written} fiches écrites, ${cards.removed} retirées ; home index code ${r.code}`);
          } catch (e) {
            log(`RAG : échec (${(e as Error).message})`);
          } finally {
            ragRunning = false;
          }
        })();
      }
    };
    let ragRunning = false;
    if (vol) await tailUsn(vol, cfg, sql, applier, opts, log, () => stop, housekeeping);
    else await tailFsWatch(applier, opts, log, () => stop, housekeeping);
    vol?.close();
  } finally {
    journal.close();
    pool.close();
    (redis as RedisClient | null)?.close();
    await sql.close();
    release();
    log("watcher arrêté");
  }
}

async function tailUsn(
  vol: Volume,
  cfg: Config,
  sql: SQL,
  applier: Applier,
  opts: WatchOptions,
  log: Log,
  stopped: () => boolean,
  housekeeping: () => Promise<void>,
): Promise<void> {
  log("lecture de la MFT C: (arbre des répertoires) ...");
  const mft = readMft("C", false);
  const tree = mft.tree;
  log(`MFT : ${mft.records} enregistrements, ${tree.dirs.size} répertoires en ${Math.round(mft.ms)} ms`);
  let j: UsnJournal = vol.queryOrCreate();
  const stored = await getVolume(sql, "C");
  let usn: bigint;
  let rescan = false;
  if (stored && stored.journalId === j.journalId && stored.nextUsn >= j.firstUsn) {
    usn = stored.nextUsn;
    log(`reprise du journal USN au point ${usn} (${j.nextUsn - usn} octets de journal à rejouer)`);
  } else {
    usn = mft.journal.nextUsn;
    rescan = stored !== undefined;
    log(
      stored
        ? "point de reprise USN perdu (journal recréé ou tronqué) : rescan incrémental des racines"
        : "premier démarrage : journal suivi depuis maintenant",
    );
  }
  const serial = volumeSerial("C:\\");
  const pending = new Map<string, PendingChange>();
  const renames = new Map<bigint, { path: string; dir: boolean }>();
  let ops: Op[] = [];
  let lastSaved = usn;
  const relevant = (p: string) => applier.relevant(p);
  const rescanRoots = async () => {
    for (const r of applier.registered) {
      log(`rescan incrémental de ${r.path}`);
      const report = await scan(
        cfg,
        sql,
        applier.pool,
        {
          root: r.path,
          hash: r.hashMode,
          graph: r.graph,
          maxHashBytes: 1 << 30,
          export: false,
        },
        applier.redis,
        log,
      );
      log(`rescan ${r.path} : ${report.entries} entrées, ${report.swept} supprimées`);
    }
  };
  if (rescan) await rescanRoots();
  while (!stopped()) {
    let records: UsnRecord[] = [];
    try {
      const r = vol.read(usn, j.journalId);
      records = r.records;
      usn = r.next;
    } catch (e) {
      if (e instanceof Win32Error && e.code === ERROR_JOURNAL_ENTRY_DELETED) {
        log("le journal USN a dépassé le point de lecture : rescan incrémental");
        j = vol.queryOrCreate();
        usn = j.nextUsn;
        await rescanRoots();
        continue;
      }
      throw e;
    }
    if (records.length) collect(tree, records, pending, ops, renames, relevant);
    const ready = settled(pending);
    if (ops.length || ready.length) {
      const batchOps = ops;
      ops = [];
      try {
        await applier.apply(batchOps, ready);
      } catch (e) {
        // PostgreSQL unreachable: keep the changes and retry; the checkpoint does not advance.
        log(`application différée (${(e as Error).message})`);
        ops = [...batchOps, ...ops];
        for (const c of ready) pending.set(pathKey(c.path), c);
        await Bun.sleep(2000);
        continue;
      }
    }
    // The checkpoint never passes a change that is still settling.
    let checkpoint = usn;
    for (const p of pending.values()) if (p.usn < checkpoint) checkpoint = p.usn;
    if (checkpoint !== lastSaved) {
      try {
        await setVolume(sql, {
          letter: "C",
          serial,
          journalId: j.journalId,
          nextUsn: checkpoint,
          mftRecords: mft.records,
        });
        lastSaved = checkpoint;
      } catch (e) {
        log(`point de reprise non enregistré (${(e as Error).message})`);
      }
    }
    await housekeeping();
    if (!records.length) await Bun.sleep(opts.pollMs);
  }
  if (pending.size || ops.length) await applier.apply(ops, settled(pending, true)).catch(() => {});
}

async function tailFsWatch(
  applier: Applier,
  opts: WatchOptions,
  log: Log,
  stopped: () => boolean,
  housekeeping: () => Promise<void>,
): Promise<void> {
  const pending = new Map<string, PendingChange>();
  const watchers = new Map<string, ReturnType<typeof fsWatch>>();
  const sync = () => {
    for (const r of applier.registered) {
      if (watchers.has(r.path)) continue;
      const w = fsWatch(r.path, { recursive: true }, (_event, name) => {
        if (!name) return;
        const path = `${r.path.endsWith("\\") ? r.path : `${r.path}\\`}${String(name).replaceAll("/", "\\")}`;
        if (!applier.relevant(path)) return;
        const k = pathKey(path);
        const p = pending.get(k);
        if (p) p.first = Date.now();
        else
          pending.set(k, {
            path,
            dir: false,
            reasons: 0,
            first: Date.now(),
            closed: false,
            usn: 0n,
          });
      });
      watchers.set(r.path, w);
      log(`fs.watch récursif sur ${r.path}`);
    }
  };
  sync();
  while (!stopped()) {
    // Without USN reasons a change is settled after 300 ms of silence; existence decides upsert or delete.
    const now = Date.now();
    const ready: PendingChange[] = [];
    for (const [k, p] of pending) {
      if (now - p.first > 300) {
        pending.delete(k);
        ready.push({ ...p, dir: existsSync(p.path) && isDir(p.path) });
      }
    }
    if (ready.length) {
      const deletes: Op[] = ready
        .filter(p => !existsSync(p.path))
        .map(p => ({ op: "delete", path: p.path, dir: false, usn: 0n }));
      try {
        await applier.apply(
          deletes,
          ready.filter(p => existsSync(p.path)),
        );
      } catch (e) {
        log(`application différée (${(e as Error).message})`);
        for (const p of ready) pending.set(pathKey(p.path), p);
      }
    }
    await housekeeping();
    sync();
    await Bun.sleep(opts.pollMs);
  }
  for (const w of watchers.values()) w.close();
}

function isDir(path: string): boolean {
  try {
    return readdirSync(path).length >= 0;
  } catch {
    return false;
  }
}

export type ProbeResult = {
  file: string;
  createVisibleMs: number | null;
  createEventMs: number | null;
  deleteVisibleMs: number | null;
  deleteEventMs: number | null;
  row: Record<string, unknown> | null;
};

/**
 * Measures the propagation of a created then deleted file to PostgreSQL (row visible / gone) and to the Redis
 * change channel. Requires a running watcher and `dir` below a registered root.
 */
export async function probe(cfg: Config, dir: string, timeoutMs = 30_000): Promise<ProbeResult> {
  const sql = connect(cfg, 2);
  const sub = await connectRedis(cfg).catch(() => null);
  const file = `${dir.replace(/\\$/, "")}\\windex-probe-${Date.now()}.txt`;
  const key = pathKey(file);
  const seen = new Map<string, number>();
  try {
    if (sub) {
      await sub.subscribe(EVENTS_CHANNEL, (message: string) => {
        try {
          const e = JSON.parse(message) as ChangeEvent;
          if (pathKey(e.path) === key && !seen.has(e.op)) seen.set(e.op, performance.now());
        } catch {
          // Foreign message.
        }
      });
    }
    const until = async (cond: () => Promise<boolean>, t0: number) => {
      while (performance.now() - t0 < timeoutMs) {
        if (await cond()) return performance.now() - t0;
        await Bun.sleep(5);
      }
      return null;
    };
    const exists = async () => (await sql`SELECT 1 FROM windex.fs_node WHERE path_lc = ${key}`).length > 0;
    const t0 = performance.now();
    writeFileSync(file, `windex probe ${new Date().toISOString()}\n`);
    const createVisibleMs = await until(exists, t0);
    const [row] =
      await sql`SELECT path, size, sha256, modified_at, usn::text AS usn FROM windex.fs_node WHERE path_lc = ${key}`;
    // The change event is published right after the row is written: give it a moment to arrive.
    for (let i = 0; i < 100 && sub && !seen.has("upsert"); i++) await Bun.sleep(5);
    const createEvent = seen.get("upsert");
    const t1 = performance.now();
    unlinkSync(file);
    const deleteVisibleMs = await until(async () => !(await exists()), t1);
    await Bun.sleep(50);
    const deleteEvent = seen.get("delete");
    return {
      file,
      createVisibleMs: createVisibleMs === null ? null : Math.round(createVisibleMs),
      createEventMs: createEvent === undefined ? null : Math.round(createEvent - t0),
      deleteVisibleMs: deleteVisibleMs === null ? null : Math.round(deleteVisibleMs),
      deleteEventMs: deleteEvent === undefined ? null : Math.round(deleteEvent - t1),
      row: row ?? null,
    };
  } finally {
    if (existsSync(file)) unlinkSync(file);
    sub?.close();
    await sql.close();
  }
}
