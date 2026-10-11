// SPDX-License-Identifier: Apache-2.0
// Disk projection of the index under <home>/windex/<drive>/ (outside the repository): full snapshots exported from
// PostgreSQL (`snapshot-<stamp>.ndjson`, the last KEEP_SNAPSHOTS kept), `latest.json` pointing at the newest one,
// and the watcher's change journal (`journal-<day>[-n].ndjson`, rotated at JOURNAL_MAX_BYTES, kept JOURNAL_DAYS).
import type { SQL } from "bun";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { RECORD_VERSION } from "./config.ts";
import { subtreeRange } from "./pg.ts";

export const KEEP_SNAPSHOTS = 3;
export const JOURNAL_MAX_BYTES = 64 << 20;
export const JOURNAL_DAYS = 14;

export const driveDir = (dir: string, drive: string) => join(dir, drive.slice(0, 1).toLowerCase());

const stamp = (d = new Date()) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

/** Removes all but the newest `keep` snapshots (names sort chronologically). Returns the removed names. */
export function rotateSnapshots(dir: string, keep = KEEP_SNAPSHOTS): string[] {
  if (!existsSync(dir)) return [];
  const snaps = readdirSync(dir)
    .filter((f) => /^snapshot-\d{8}T\d{6}Z\.ndjson$/.test(f))
    .toSorted();
  const drop = snaps.slice(0, Math.max(0, snaps.length - keep));
  for (const f of drop) rmSync(join(dir, f), { force: true });
  return drop;
}

/** Removes journals older than `days` (by the day in their name). Returns the removed names. */
export function rotateJournals(dir: string, days = JOURNAL_DAYS, now = new Date()): string[] {
  if (!existsSync(dir)) return [];
  const limit = new Date(now.getTime() - days * 86_400_000)
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");
  const drop = readdirSync(dir).filter((f) => {
    const m = /^journal-(\d{8})(?:-\d+)?\.ndjson$/.exec(f);
    return m !== null && m[1]! < limit;
  });
  for (const f of drop) rmSync(join(dir, f), { force: true });
  return drop;
}

/** Append-only change journal with size rotation; each line is one JSON event. */
export class Journal {
  private fd = -1;
  private file = "";
  private size = 0;

  constructor(
    readonly dir: string,
    private maxBytes = JOURNAL_MAX_BYTES,
  ) {}

  private target(day: string): string {
    for (let n = 0; ; n++) {
      const f = join(this.dir, n ? `journal-${day}-${n}.ndjson` : `journal-${day}.ndjson`);
      if (!existsSync(f) || statSync(f).size < this.maxBytes) return f;
    }
  }

  append(events: object[]): void {
    if (!events.length) return;
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    if (this.fd < 0 || !this.file.includes(`journal-${day}`) || this.size >= this.maxBytes) {
      this.close();
      mkdirSync(this.dir, { recursive: true });
      this.file = this.target(day);
      this.fd = openSync(this.file, "a");
      this.size = statSync(this.file).size;
      rotateJournals(this.dir);
    }
    const text = events.map((e) => JSON.stringify({ v: RECORD_VERSION, ...e })).join("\n") + "\n";
    this.size += writeSync(this.fd, text);
  }

  get current(): string {
    return this.file;
  }

  close(): void {
    if (this.fd >= 0) closeSync(this.fd);
    this.fd = -1;
  }
}

export type ExportResult = {
  file: string;
  entries: number;
  files: number;
  pe: number;
  bytes: number;
  ms: number;
};

/**
 * Streams every stored node below `root` from PostgreSQL into a new snapshot (keyset pagination on the unique
 * `path_lc` index), then atomically renames it, updates `latest.json` and rotates old snapshots.
 */
export async function exportSnapshot(
  sql: SQL,
  root: string,
  dir: string,
  page = 20_000,
): Promise<ExportResult> {
  const t0 = performance.now();
  mkdirSync(dir, { recursive: true });
  const name = `snapshot-${stamp()}.ndjson`;
  const final = join(dir, name);
  const partial = `${final}.partial`;
  const [lo, hi] = subtreeRange(root);
  const fd = openSync(partial, "w");
  let entries = 0;
  let files = 0;
  let pe = 0;
  let bytes = 0;
  try {
    bytes += writeSync(
      fd,
      `${JSON.stringify({ v: RECORD_VERSION, type: "header", root, exportedAt: new Date().toISOString() })}\n`,
    );
    let last = "";
    for (;;) {
      const rows =
        await sql`SELECT f.path, f.path_lc, f.is_dir, f.size, f.attrs, f.frn::text AS frn, f.nlink,
          f.created_at, f.modified_at, f.accessed_at, f.changed_at, f.sha256, f.ads, f.error,
          CASE WHEN p.node_id IS NULL THEN NULL ELSE jsonb_build_object(
            'kind', p.kind, 'machine', p.machine, 'bits', p.bits, 'subsystem', p.subsystem,
            'isDotnet', p.is_dotnet, 'fileVersion', p.file_version, 'company', p.company,
            'description', p.description, 'product', p.product, 'originalFilename', p.original_filename,
            'signature', p.signature, 'signer', p.signer, 'catalog', p.catalog, 'imports', p.n_imports,
            'exports', p.n_exports,
            'modules', (SELECT jsonb_agg(DISTINCT i.module) FROM windex.pe_import i WHERE i.node_id = f.id)) END AS pe
        FROM windex.fs_node f LEFT JOIN windex.pe p ON p.node_id = f.id
        WHERE (f.path_lc = ${lo.slice(0, -1)} OR (f.path_lc >= ${lo} AND f.path_lc < ${hi})) AND f.path_lc > ${last}
        ORDER BY f.path_lc LIMIT ${page}`;
      if (!rows.length) break;
      let chunk = "";
      for (const r of rows) {
        entries++;
        if (!r.is_dir) files++;
        if (r.pe) pe++;
        chunk += `${JSON.stringify({
          v: RECORD_VERSION,
          path: r.path,
          dir: r.is_dir,
          size: Number(r.size),
          attrs: r.attrs,
          frn: r.frn,
          nlink: r.nlink,
          created: r.created_at,
          modified: r.modified_at,
          accessed: r.accessed_at,
          changed: r.changed_at,
          sha256: r.sha256 ?? undefined,
          ads: r.ads ?? undefined,
          error: r.error ?? undefined,
          pe: r.pe ?? undefined,
        })}\n`;
      }
      bytes += writeSync(fd, chunk);
      last = rows.at(-1).path_lc;
      if (rows.length < page) break;
    }
  } finally {
    closeSync(fd);
  }
  renameSync(partial, final);
  const result = { file: final, entries, files, pe, bytes, ms: performance.now() - t0 };
  const latest = join(dir, "latest.json");
  const tmp = `${latest}.tmp`;
  await Bun.write(
    tmp,
    `${JSON.stringify({ v: RECORD_VERSION, root, snapshot: name, entries, files, pe, bytes, exportedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  renameSync(tmp, latest);
  rotateSnapshots(dir);
  return result;
}
