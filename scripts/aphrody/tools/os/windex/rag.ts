// SPDX-License-Identifier: Apache-2.0
// RAG projection of the index: Markdown cards generated from PostgreSQL under <home>/windex/rag/<drive>/ (one per
// PE image of the graph roots and per executable/driver elsewhere, one per directory down to a bounded depth, one
// per service or driver), then handed to the existing home pipeline (`aphrody home index <dir> --label windex`,
// incremental by content hash) so `aphrody home query` and the MCP `aphrody_rag_search` see them. Cards are only
// rewritten when their text changes and removed when their node disappears.
import type { SQL } from "bun";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aphrodyBin, RECORD_VERSION, type Config } from "./config.ts";

export const RAG_LABEL = "windex";
export const DIR_DEPTH = { graph: 4, other: 2 };

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
const short = (s: string) =>
  new Bun.CryptoHasher("sha256").update(s.toLowerCase()).digest("hex").slice(0, 12);

/** Card file of a node: `<kind>/<2 hex>/<name>-<hash>.md` (flat, far below MAX_PATH). */
export function cardPath(
  root: string,
  kind: "pe" | "dir" | "svc",
  key: string,
  name: string,
): string {
  const h = short(key);
  return join(root, kind, h.slice(0, 2), `${safe(name) || "root"}-${h}.md`);
}

const line = (label: string, value: unknown) =>
  value === null || value === undefined || value === "" ? "" : `- ${label}: ${value}\n`;

const list = (items: string[] | null | undefined, max: number) => {
  if (!items?.length) return null;
  const head = items.slice(0, max).join(", ");
  return items.length > max ? `${head} (+${items.length - max})` : head;
};

type PeCard = {
  id: string;
  path: string;
  name: string;
  size: string;
  sha256: string | null;
  modified_at: Date | null;
  kind: string;
  machine: string;
  bits: number;
  subsystem: string;
  is_dotnet: boolean;
  file_version: string | null;
  product_version: string | null;
  company: string | null;
  description: string | null;
  product: string | null;
  original_filename: string | null;
  signature: string;
  signer: string | null;
  signer_issuer: string | null;
  catalog: string | null;
  n_imports: number;
  n_exports: number;
  export_name: string | null;
  modules: string[] | null;
  resolved: string[] | null;
  importers: string[] | null;
  n_importers: number;
  exports: string[] | null;
  services: string[] | null;
};

export function peCardText(r: PeCard): string {
  return (
    `# ${r.name}${r.description ? ` — ${r.description}` : ""}\n\n` +
    `Windows PE image indexed by windex (record v${RECORD_VERSION}).\n\n` +
    line("Path", r.path) +
    line(
      "Type",
      `${r.kind} ${r.machine} ${r.bits}-bit, subsystem ${r.subsystem}${r.is_dotnet ? ", .NET assembly (CLR header)" : ""}`,
    ) +
    line("File version", r.file_version) +
    line("Product", [r.product, r.product_version].filter(Boolean).join(" ")) +
    line("Company", r.company) +
    line("Original filename", r.original_filename) +
    line(
      "Signature",
      [
        r.signature,
        r.signer,
        r.signer_issuer && `issued by ${r.signer_issuer}`,
        r.catalog && `catalog ${r.catalog}`,
      ]
        .filter(Boolean)
        .join(", "),
    ) +
    line("Size", `${r.size} bytes`) +
    line("Modified", r.modified_at ? new Date(r.modified_at).toISOString() : null) +
    line("SHA-256", r.sha256) +
    line("Imported modules", list(r.modules, 120)) +
    line("Imports resolve to", list(r.resolved, 120)) +
    line("Imported functions", r.n_imports) +
    line(
      "Imported by",
      r.n_importers ? `${r.n_importers} images: ${list(r.importers, 40)}` : null,
    ) +
    line("Export name", r.export_name) +
    line("Exports", r.n_exports ? `${r.n_exports}: ${list(r.exports, 150)}` : null) +
    line("Hosts services", list(r.services, 40))
  );
}

type DirCard = {
  path: string;
  name: string;
  modified_at: Date | null;
  n_dirs: number;
  n_files: number;
  n_pe: number;
  bytes: string | null;
  children: string[] | null;
};

export function dirCardText(r: DirCard): string {
  return (
    `# ${r.path}\n\nWindows directory indexed by windex.\n\n` +
    line("Subdirectories", r.n_dirs) +
    line("Files", r.n_files) +
    line("PE images", r.n_pe) +
    line("Bytes (direct files)", r.bytes) +
    line("Modified", r.modified_at ? new Date(r.modified_at).toISOString() : null) +
    line("Entries", list(r.children, 300))
  );
}

type SvcCard = {
  name: string;
  display_name: string | null;
  description: string | null;
  kind: string;
  start_mode: string | null;
  grp: string | null;
  image_path: string | null;
  service_dll: string | null;
  object_name: string | null;
  depend_on_service: string[];
  depend_on_group: string[];
  image: string | null;
  dependents: string[] | null;
};

export function svcCardText(r: SvcCard): string {
  return (
    `# ${r.kind === "kernel-driver" || r.kind === "fs-driver" ? "Driver" : "Service"} ${r.name}` +
    `${r.display_name && !r.display_name.startsWith("@") ? ` — ${r.display_name}` : ""}\n\n` +
    line("Kind", r.kind) +
    line("Start", r.start_mode) +
    line("Group", r.grp) +
    line("Account", r.object_name) +
    line("Description", r.description && !r.description.startsWith("@") ? r.description : null) +
    line("Image path", r.image_path) +
    line("Image file", r.image) +
    line("Service DLL", r.service_dll) +
    line("Depends on services", list(r.depend_on_service, 60)) +
    line("Depends on groups", list(r.depend_on_group, 30)) +
    line("Required by", list(r.dependents, 60))
  );
}

export type RagStats = {
  written: number;
  unchanged: number;
  removed: number;
  cards: number;
  ms: number;
};

function writeCard(file: string, text: string, keep: Set<string>, stats: RagStats): void {
  keep.add(file);
  stats.cards++;
  if (existsSync(file) && readFileSync(file, "utf8") === text) {
    stats.unchanged++;
    return;
  }
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  stats.written++;
}

function* files(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.name.endsWith(".md")) yield p;
  }
}

/** Regenerates the cards of every registered root; returns the card directory and counts. */
export async function buildCards(
  sql: SQL,
  cfg: Config,
  page = 2000,
): Promise<{ dir: string } & RagStats> {
  const t0 = performance.now();
  const dir = join(cfg.dir, "rag");
  const stats: RagStats = { written: 0, unchanged: 0, removed: 0, cards: 0, ms: 0 };
  const keep = new Set<string>();

  // PE images: every image below a graph root, executables and drivers elsewhere.
  let after = 0;
  for (;;) {
    const rows: PeCard[] =
      await sql`SELECT f.id::text AS id, f.path, f.name, f.size::text AS size, f.sha256,
        f.modified_at, p.kind, p.machine, p.bits, p.subsystem, p.is_dotnet, p.file_version, p.product_version,
        p.company, p.description, p.product, p.original_filename, p.signature, p.signer, p.signer_issuer, p.catalog,
        p.n_imports, p.n_exports, p.export_name,
        (SELECT array_agg(DISTINCT i.module ORDER BY i.module) FROM windex.pe_import i WHERE i.node_id = f.id) AS modules,
        (SELECT array_agg(DISTINCT t.name ORDER BY t.name) FROM windex.edge e JOIN windex.fs_node t ON t.id = e.dst
           WHERE e.src = f.id AND e.kind = 'imports') AS resolved,
        (SELECT count(DISTINCT e.src)::int FROM windex.edge e WHERE e.dst = f.id AND e.kind = 'imports') AS n_importers,
        (SELECT array_agg(n ORDER BY n) FROM (SELECT DISTINCT s.name AS n FROM windex.edge e
           JOIN windex.fs_node s ON s.id = e.src WHERE e.dst = f.id AND e.kind = 'imports' LIMIT 40) x) AS importers,
        (SELECT array_agg(x.name ORDER BY x.ordinal) FROM (SELECT name, ordinal FROM windex.pe_export
           WHERE node_id = f.id AND name IS NOT NULL ORDER BY ordinal LIMIT 150) x) AS exports,
        (SELECT array_agg(DISTINCT s.name ORDER BY s.name) FROM windex.edge e JOIN windex.service s ON s.id = e.src
           WHERE e.dst = f.id AND e.kind IN ('service', 'driver')) AS services
      FROM windex.pe p JOIN windex.fs_node f ON f.id = p.node_id
      WHERE p.node_id > ${after}
        AND (p.kind IN ('exe', 'sys', 'efi') OR EXISTS (SELECT 1 FROM windex.root r WHERE r.graph
          AND (f.path_lc = r.path_lc OR (f.path_lc > r.path_lc || '\\' AND f.path_lc < r.path_lc || ']'))))
        AND p.kind <> 'mui'
        -- WinSxS holds component-store copies (mostly hard links) of the live images: carded once, live.
        AND position('\\winsxs\\' IN f.path_lc) = 0
      ORDER BY p.node_id LIMIT ${page}`;
    for (const r of rows)
      writeCard(cardPath(dir, "pe", r.path, r.name), peCardText(r), keep, stats);
    if (rows.length < page) break;
    after = Number(rows.at(-1)!.id);
  }

  // Directories down to a bounded depth below each root (deeper below graph roots).
  for (const root of await sql`SELECT path, path_lc, graph FROM windex.root`) {
    const depth = root.graph ? DIR_DEPTH.graph : DIR_DEPTH.other;
    const base = root.path_lc.endsWith("\\") ? root.path_lc : `${root.path_lc}\\`;
    const baseDepth = base.split("\\").length - 1;
    let last = "";
    for (;;) {
      const rows: (DirCard & { path_lc: string })[] =
        await sql`SELECT d.path, d.path_lc, d.name, d.modified_at,
          (SELECT count(*)::int FROM windex.fs_node c WHERE c.parent_id = d.id AND c.is_dir) AS n_dirs,
          (SELECT count(*)::int FROM windex.fs_node c WHERE c.parent_id = d.id AND NOT c.is_dir) AS n_files,
          (SELECT count(*)::int FROM windex.fs_node c JOIN windex.pe p ON p.node_id = c.id WHERE c.parent_id = d.id) AS n_pe,
          (SELECT sum(c.size)::text FROM windex.fs_node c WHERE c.parent_id = d.id AND NOT c.is_dir) AS bytes,
          (SELECT array_agg(n ORDER BY n) FROM (SELECT CASE WHEN c.is_dir THEN c.name || '\\' ELSE c.name END AS n
             FROM windex.fs_node c WHERE c.parent_id = d.id ORDER BY c.is_dir DESC, c.name LIMIT 300) x) AS children
        FROM windex.fs_node d
        WHERE d.is_dir AND (d.path_lc = ${root.path_lc} OR (d.path_lc >= ${base} AND d.path_lc < ${`${base.slice(0, -1)}]`}))
          AND length(d.path_lc) - length(replace(d.path_lc, '\\', '')) <= ${baseDepth + depth - 1}
          AND d.path_lc > ${last}
          -- Children of very wide directories (WinSxS, servicing packages) are listed by their parent's card only.
          AND (d.parent_id IS NULL OR d.path_lc = ${root.path_lc} OR
               (SELECT count(*) FROM windex.fs_node s WHERE s.parent_id = d.parent_id AND s.is_dir) <= 500)
        ORDER BY d.path_lc LIMIT ${page}`;
      for (const r of rows)
        writeCard(cardPath(dir, "dir", r.path, r.name), dirCardText(r), keep, stats);
      if (rows.length < page) break;
      last = rows.at(-1)!.path_lc;
    }
  }

  // Services and drivers.
  const svcs: SvcCard[] =
    await sql`SELECT s.name, s.display_name, s.description, s.kind, s.start_mode, s.grp,
      s.image_path, s.service_dll, s.object_name, s.depend_on_service, s.depend_on_group,
      (SELECT f.path FROM windex.fs_node f WHERE f.path_lc = s.image_lc) AS image,
      (SELECT array_agg(d.name ORDER BY d.name) FROM windex.edge e JOIN windex.service d ON d.id = e.src
         WHERE e.dst = s.id AND e.kind = 'depends_on') AS dependents
    FROM windex.service s ORDER BY s.name`;
  for (const r of svcs)
    writeCard(cardPath(dir, "svc", r.name, r.name), svcCardText(r), keep, stats);

  for (const f of files(dir)) {
    if (!keep.has(f)) {
      rmSync(f, { force: true });
      stats.removed++;
    }
  }
  stats.ms = performance.now() - t0;
  return { dir, ...stats };
}

/** Runs the home pipeline on the card directory (`aphrody-home index <dir> --label windex --state <home>`). */
export async function indexCards(cfg: Config, dir: string): Promise<{ code: number; out: string }> {
  const bin = aphrodyBin(cfg.home, "aphrody-home");
  const proc = Bun.spawn([bin, "--state", cfg.home, "index", dir, "--label", RAG_LABEL], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out: `${out}${err}`.trim() };
}

/** `aphrody-home query` restricted to nothing but the home store (cards are chunks labelled `windex`). */
export async function queryHome(
  cfg: Config,
  text: string,
  limit = 5,
): Promise<{ code: number; out: string }> {
  const bin = aphrodyBin(cfg.home, "aphrody-home");
  const proc = Bun.spawn(
    [bin, "--state", cfg.home, "query", text, "--limit", String(limit), "--kind", "chunk"],
    {
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    },
  );
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out: `${out}${err}`.trim() };
}
