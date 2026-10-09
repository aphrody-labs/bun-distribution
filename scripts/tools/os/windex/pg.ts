// SPDX-License-Identifier: Apache-2.0
// PostgreSQL store of windex through Bun's built-in SQL client: versioned immutable migrations
// (migrations/NNNN_name.sql, checksum-verified), batched upserts through one jsonb parameter per batch, and the
// incremental helpers used by the scanner and the watcher.
import { SQL } from "bun";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { EntryRecord, PeSummary } from "./analyze.ts";
import { pathKey, readSecret, type Config } from "./config.ts";

export const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

export function connect(cfg: Config, max = 4): SQL {
  return new SQL({
    hostname: cfg.pg.host,
    port: cfg.pg.port,
    username: cfg.pg.user,
    password: readSecret(cfg.pg.passwordFile),
    database: cfg.pg.database,
    max,
    idleTimeout: 30,
    connectionTimeout: 10,
  });
}

export type Migration = { version: number; name: string; file: string; sha256: string; sql: string };

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const out: Migration[] = [];
  for (const f of readdirSync(dir).filter((x) => /^\d{4}_[a-z0-9_]+\.sql$/.test(x)).toSorted()) {
    const sql = await Bun.file(join(dir, f)).text();
    out.push({
      version: Number(f.slice(0, 4)),
      name: f.slice(5, -4),
      file: f,
      sha256: new Bun.CryptoHasher("sha256").update(sql).digest("hex"),
      sql,
    });
  }
  const versions = out.map((m) => m.version);
  if (new Set(versions).size !== versions.length) throw new Error("numéros de migration dupliqués");
  return out;
}

/** Applies pending migrations under an advisory lock; an applied migration whose checksum changed is an error. */
export async function migrate(sql: SQL): Promise<{ applied: string[]; current: number }> {
  const migrations = await loadMigrations();
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('windex-migrate'))`;
    await tx.unsafe(`CREATE TABLE IF NOT EXISTS public.windex_schema_migrations (
      version integer PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Map<number, string>();
    for (const r of await tx`SELECT version, sha256 FROM public.windex_schema_migrations`) {
      done.set(Number(r.version), r.sha256);
    }
    for (const m of migrations) {
      const sha = done.get(m.version);
      if (sha !== undefined) {
        if (sha !== m.sha256) throw new Error(`migration ${m.file} modifiée après application`);
        continue;
      }
      await tx.unsafe(m.sql);
      await tx`INSERT INTO public.windex_schema_migrations (version, name, sha256)
               VALUES (${m.version}, ${m.name}, ${m.sha256})`;
      applied.push(m.file);
    }
  });
  return { applied, current: migrations.at(-1)?.version ?? 0 };
}

/** Integer array literal for a `$n::bigint[]` parameter. */
export const pgArray = (ids: (number | undefined)[]) => `{${ids.filter((x) => x !== undefined).join(",")}}`;

const iso = (ms: number | null) => (ms === null || !Number.isFinite(ms) ? null : new Date(ms).toISOString());

function nodeRow(r: EntryRecord, usn: string | null) {
  const p = r.path;
  const cut = p.lastIndexOf("\\");
  const name = cut >= 0 ? p.slice(cut + 1) : p;
  const parent = cut > 2 ? p.slice(0, cut) : cut === 2 ? p.slice(0, 3) : null;
  const dot = name.lastIndexOf(".");
  return {
    path: p,
    path_lc: pathKey(p),
    parent_lc: parent ? pathKey(parent) : null,
    name: name || p,
    ext: !r.dir && dot > 0 ? name.slice(dot + 1).toLowerCase() : "",
    is_dir: r.dir,
    frn: r.frn,
    size: r.size,
    attrs: r.attrs | 0,
    nlink: r.nlink,
    created_at: iso(r.birthMs),
    modified_at: iso(r.mtimeMs),
    accessed_at: iso(r.atimeMs),
    changed_at: iso(r.ctimeMs),
    sha256: r.sha256,
    ads: r.ads,
    error: r.error,
    usn,
    unchanged: r.unchanged,
  };
}

const NODE_COLUMNS = `path text, path_lc text, parent_lc text, name text, ext text, is_dir boolean, frn numeric,
  size bigint, attrs integer, nlink integer, created_at timestamptz, modified_at timestamptz,
  accessed_at timestamptz, changed_at timestamptz, sha256 text, ads jsonb, error text, usn bigint, unchanged boolean`;

/**
 * Upserts filesystem nodes and their PE data in one transaction. Unchanged entries keep their stored hash, ADS and
 * PE rows. Returns the ids of the nodes whose PE data was (re)written.
 */
export async function upsertEntries(
  sql: SQL,
  records: EntryRecord[],
  usn: bigint | null = null,
): Promise<{ nodes: number; pe: number[] }> {
  if (!records.length) return { nodes: 0, pe: [] };
  const rows = records.map((r) => nodeRow(r, usn === null ? null : usn.toString()));
  const peIds: number[] = [];
  await sql.begin(async (tx) => {
    const ids: { id: string; path_lc: string }[] = [];
    // Unchanged entries (same size and mtime) keep their stored hash and streams; changed ones replace them.
    for (const unchanged of [false, true]) {
      const part = rows.filter((r) => r.unchanged === unchanged);
      if (!part.length) continue;
      const content = unchanged ? "" : "sha256 = excluded.sha256, ads = excluded.ads,";
      ids.push(
        ...(await tx.unsafe(
          `INSERT INTO windex.fs_node AS f (path, path_lc, parent_lc, parent_id, name, ext, is_dir, frn, size, attrs,
             nlink, created_at, modified_at, accessed_at, changed_at, sha256, ads, error, usn, seen_at)
           SELECT r.path, r.path_lc, r.parent_lc, p.id, r.name, r.ext, r.is_dir, r.frn, r.size, r.attrs, r.nlink,
             r.created_at, r.modified_at, r.accessed_at, r.changed_at, r.sha256, r.ads, r.error, r.usn, now()
           FROM jsonb_to_recordset($1::jsonb) AS r(${NODE_COLUMNS})
           LEFT JOIN windex.fs_node p ON p.path_lc = r.parent_lc
           ON CONFLICT (path_lc) DO UPDATE SET
             path = excluded.path, parent_lc = excluded.parent_lc,
             parent_id = COALESCE(excluded.parent_id, f.parent_id), name = excluded.name, ext = excluded.ext,
             is_dir = excluded.is_dir, frn = excluded.frn, size = excluded.size, attrs = excluded.attrs,
             nlink = excluded.nlink, created_at = excluded.created_at, modified_at = excluded.modified_at,
             accessed_at = excluded.accessed_at, changed_at = excluded.changed_at, ${content}
             error = excluded.error, usn = COALESCE(excluded.usn, f.usn), seen_at = now()
           RETURNING id, path_lc`,
          [part],
        )),
      );
    }
    const idOf = new Map<string, number>();
    for (const r of ids) idOf.set(r.path_lc, Number(r.id));
    const pe = records.filter((r) => r.pe && !r.unchanged);
    // A changed file that is no longer a PE loses its PE rows.
    const notPe = records.filter((r) => !r.pe && !r.unchanged && !r.dir).map((r) => idOf.get(pathKey(r.path)));
    if (notPe.length) {
      await tx.unsafe(`DELETE FROM windex.pe WHERE node_id = ANY($1::bigint[])`, [pgArray(notPe)]);
    }
    if (!pe.length) return;
    const peRows = pe.map((r) => peRow(idOf.get(pathKey(r.path))!, r.pe!));
    const nodeIds = peRows.map((r) => r.node_id);
    peIds.push(...nodeIds);
    await tx.unsafe(
      `INSERT INTO windex.pe AS p SELECT r.* FROM jsonb_populate_recordset(NULL::windex.pe, $1::jsonb) r
       ON CONFLICT (node_id) DO UPDATE SET kind = excluded.kind, machine = excluded.machine, bits = excluded.bits,
         subsystem = excluded.subsystem, characteristics = excluded.characteristics,
         dll_characteristics = excluded.dll_characteristics, linker_ts = excluded.linker_ts,
         image_base = excluded.image_base, image_size = excluded.image_size, entry_rva = excluded.entry_rva,
         is_dotnet = excluded.is_dotnet, file_version = excluded.file_version,
         product_version = excluded.product_version, company = excluded.company,
         description = excluded.description, product = excluded.product,
         original_filename = excluded.original_filename, internal_name = excluded.internal_name,
         copyright = excluded.copyright, signature = excluded.signature, signer = excluded.signer,
         signer_issuer = excluded.signer_issuer, digest = excluded.digest, catalog = excluded.catalog,
         export_name = excluded.export_name, n_imports = excluded.n_imports, n_exports = excluded.n_exports,
         warnings = excluded.warnings`,
      [peRows],
    );
    await tx.unsafe(`DELETE FROM windex.pe_import WHERE node_id = ANY($1::bigint[])`, [pgArray(nodeIds)]);
    await tx.unsafe(`DELETE FROM windex.pe_export WHERE node_id = ANY($1::bigint[])`, [pgArray(nodeIds)]);
    const imports = pe.flatMap((r) => {
      const id = idOf.get(pathKey(r.path))!;
      // One row per (module, delay); a module imported twice in the same table is merged.
      const merged = new Map<string, { node_id: number; module: string; delay: boolean; functions: string[] }>();
      for (const i of r.pe!.imports) {
        const k = `${i.module}|${i.delay}`;
        const m = merged.get(k);
        if (m) m.functions.push(...i.functions);
        else merged.set(k, { node_id: id, module: i.module, delay: i.delay, functions: [...i.functions] });
      }
      return [...merged.values()];
    });
    if (imports.length) {
      await tx.unsafe(
        `INSERT INTO windex.pe_import (node_id, module, delay, functions)
         SELECT node_id, module, delay, functions FROM jsonb_to_recordset($1::jsonb)
           AS r(node_id bigint, module text, delay boolean, functions text[])
         ON CONFLICT DO NOTHING`,
        [imports],
      );
    }
    const exports = pe.flatMap((r) => {
      const id = idOf.get(pathKey(r.path))!;
      return r.pe!.exports.map((e) => ({ node_id: id, ordinal: e.ordinal, name: e.name, forwarder: e.forwarder }));
    });
    for (let i = 0; i < exports.length; i += 20_000) {
      await tx.unsafe(
        `INSERT INTO windex.pe_export (node_id, ordinal, name, forwarder)
         SELECT node_id, ordinal, name, forwarder FROM jsonb_to_recordset($1::jsonb)
           AS r(node_id bigint, ordinal integer, name text, forwarder text)
         ON CONFLICT DO NOTHING`,
        [exports.slice(i, i + 20_000)],
      );
    }
  });
  return { nodes: rows.length, pe: peIds };
}

function peRow(nodeId: number, p: PeSummary) {
  return {
    node_id: nodeId,
    kind: p.kind,
    machine: p.machine,
    bits: p.bits,
    subsystem: p.subsystem,
    characteristics: p.characteristics,
    dll_characteristics: p.dllCharacteristics,
    linker_ts: p.timestamp,
    image_base: p.imageBase,
    image_size: p.imageSize,
    entry_rva: p.entryRva,
    is_dotnet: p.isDotnet,
    file_version: p.fileVersion,
    product_version: p.productVersion,
    company: p.company,
    description: p.description,
    product: p.product,
    original_filename: p.originalFilename,
    internal_name: p.internalName,
    copyright: p.copyright,
    signature: p.signature,
    signer: p.signer,
    signer_issuer: p.signerIssuer,
    digest: p.digest,
    catalog: p.catalog,
    export_name: p.exportName,
    n_imports: p.imports.reduce((n, i) => n + i.functions.length, 0),
    n_exports: p.exports.length,
    warnings: p.warnings.length ? p.warnings : null,
  };
}

/** Links children inserted before their parent (scan order is not parent-first). */
export async function linkParents(sql: SQL): Promise<number> {
  const r = await sql`UPDATE windex.fs_node c SET parent_id = p.id
    FROM windex.fs_node p WHERE c.parent_id IS NULL AND c.parent_lc IS NOT NULL AND p.path_lc = c.parent_lc`;
  return r.count;
}

/** Subtree bounds of a root in "C" collation: (prefix, upper) such that prefix <= path_lc < upper. */
export function subtreeRange(root: string): [string, string] {
  const r = pathKey(root);
  const prefix = r.endsWith("\\") ? r : `${r}\\`;
  return [prefix, `${prefix.slice(0, -1)}]`];
}

/** Deletes the entries of a root not seen since `since` (removed while no watcher ran). */
export async function sweep(sql: SQL, root: string, since: Date): Promise<number> {
  const [lo, hi] = subtreeRange(root);
  const r = await sql`DELETE FROM windex.fs_node WHERE path_lc >= ${lo} AND path_lc < ${hi} AND seen_at < ${since}`;
  return r.count;
}

/** `size/mtimeMs` of the stored content-analysed files below a root, the incremental skip key. */
export async function previousState(sql: SQL, root: string): Promise<Map<string, string>> {
  const [lo, hi] = subtreeRange(root);
  const out = new Map<string, string>();
  const rows = await sql`SELECT path_lc, size, (extract(epoch FROM modified_at) * 1000)::bigint AS m
    FROM windex.fs_node WHERE path_lc >= ${lo} AND path_lc < ${hi} AND NOT is_dir AND error IS NULL
      AND (sha256 IS NOT NULL OR EXISTS (SELECT 1 FROM windex.pe p WHERE p.node_id = fs_node.id))`;
  for (const r of rows) out.set(r.path_lc, `${r.size}/${r.m}`);
  return out;
}

/** Deletes one path (and its subtree through ON DELETE CASCADE); returns the removed ids. */
export async function deletePath(sql: SQL, path: string): Promise<number> {
  const r = await sql`DELETE FROM windex.fs_node WHERE path_lc = ${pathKey(path)}`;
  return r.count;
}

/** Moves a path and its subtree (rename); returns rows updated. */
export async function movePath(sql: SQL, from: string, to: string): Promise<number> {
  const a = pathKey(from);
  const b = pathKey(to);
  const [lo, hi] = subtreeRange(from);
  return await sql.begin(async (tx) => {
    // Any stale row already at the destination is replaced by the moved one.
    await tx`DELETE FROM windex.fs_node WHERE path_lc = ${b}`;
    const cut = to.lastIndexOf("\\");
    const name = to.slice(cut + 1);
    const parentLc = pathKey(cut > 2 ? to.slice(0, cut) : to.slice(0, 3));
    const one = await tx`UPDATE windex.fs_node SET path = ${to}, path_lc = ${b}, name = ${name},
        parent_lc = ${parentLc}, parent_id = (SELECT id FROM windex.fs_node WHERE path_lc = ${parentLc}), seen_at = now()
      WHERE path_lc = ${a}`;
    const sub = await tx`UPDATE windex.fs_node SET
        path = ${to} || substr(path, ${from.length + 1}),
        path_lc = ${b} || substr(path_lc, ${a.length + 1}),
        parent_lc = ${b} || substr(parent_lc, ${a.length + 1}), seen_at = now()
      WHERE path_lc >= ${lo} AND path_lc < ${hi}`;
    return one.count + sub.count;
  });
}

export async function refreshPeEdges(sql: SQL, ids: number[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 2000) {
    await sql.unsafe(`SELECT windex.refresh_pe_edges($1::bigint[])`, [pgArray(ids.slice(i, i + 2000))]);
  }
}

export async function setVolume(
  sql: SQL,
  v: { letter: string; serial?: string; journalId: bigint; nextUsn: bigint; mftRecords?: number },
): Promise<void> {
  await sql`INSERT INTO windex.volume (letter, serial, journal_id, next_usn, mft_records, updated_at)
    VALUES (${v.letter}, ${v.serial ?? null}, ${v.journalId.toString()}, ${v.nextUsn.toString()},
            ${v.mftRecords ?? null}, now())
    ON CONFLICT (letter) DO UPDATE SET serial = COALESCE(excluded.serial, windex.volume.serial),
      journal_id = excluded.journal_id, next_usn = excluded.next_usn,
      mft_records = COALESCE(excluded.mft_records, windex.volume.mft_records), updated_at = now()`;
}

export async function getVolume(
  sql: SQL,
  letter: string,
): Promise<{ journalId: bigint; nextUsn: bigint } | undefined> {
  const [r] = await sql`SELECT journal_id::text AS j, next_usn::text AS n FROM windex.volume WHERE letter = ${letter}`;
  return r ? { journalId: BigInt(r.j), nextUsn: BigInt(r.n) } : undefined;
}

export type Root = { path: string; hashMode: "all" | "pe" | "none"; graph: boolean };

export async function roots(sql: SQL): Promise<Root[]> {
  const rows = await sql`SELECT path, hash_mode, graph FROM windex.root ORDER BY length(path_lc)`;
  return rows.map((r: { path: string; hash_mode: Root["hashMode"]; graph: boolean }) => ({
    path: r.path,
    hashMode: r.hash_mode,
    graph: r.graph,
  }));
}
