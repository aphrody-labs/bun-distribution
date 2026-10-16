// SPDX-License-Identifier: Apache-2.0
/**
 * Host probe for the RG/Shenron database comparison. Self-contained: it is
 * piped to `bun run -` on every host (local, vps, dbfr), so it imports only
 * Bun built-ins. Read-only: SQLite files are opened with `readonly: true`.
 * Input: base64 JSON `ProbeInput` in PROBE_INPUT. Output: one JSON line.
 */
import { Database } from "bun:sqlite";

export type Domain = "rg" | "shenron";

export interface ProbeInput {
  host: string;
  sqliteRoots: string[];
  packageRoots: string[];
  /** Directories that may hold sqlite-vec's `vec0.so` (needed for vec0 tables). */
  vecExtensionDirs?: string[];
}

export interface SqliteTable {
  name: string;
  rows: number;
  columns: string[];
  /** Newest value of a timestamp-like column, ISO 8601, when one exists. */
  newest: string | null;
}

export interface SqliteCandidate {
  host: string;
  path: string;
  domain: Domain;
  bytes: number;
  modified: string;
  sha256: string;
  integrity: string;
  totalRows: number;
  newestRow: string | null;
  tables: SqliteTable[];
  error?: string;
}

export interface PackageFile {
  path: string;
  bytes: number;
  sha256: string;
  modified: string;
}

export interface PackageCandidate {
  host: string;
  dir: string;
  domain: Domain;
  name: string;
  version: string;
  modified: string;
  dependencies: Record<string, string>;
  exports: string[];
  files: PackageFile[];
  /** Table names declared in source (pgTable/sqliteTable/CREATE TABLE). */
  declaredTables: string[];
}

export interface ProbeOutput {
  host: string;
  bun: string;
  sqlite: SqliteCandidate[];
  packages: PackageCandidate[];
}

const PACKAGE_NAMES: Record<string, Domain> = {
  "@rosegriffon/db": "rg",
  "@shenron/db": "shenron",
};
const TIME_COLUMN =
  /(^|_)(created|updated|modified|inserted|deleted|seen|sent|last)(_at|_on|_time|_ts)?$|(^|_)(timestamp|ts|date|time)$/i;
const DECLARED_TABLE =
  /(?:pgTable|sqliteTable)\(\s*["'`]([\w.]+)["'`]|create\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?([\w.]+)|^ {6}(\w+): \{\s*\n\s*Row: \{/gim;

function classify(path: string): Domain | null {
  const p = path.toLowerCase();
  if (/shenron|dbfr|dragonball/.test(p)) return "shenron";
  if (/(^|\/)rg(\/|-|$)|rose-?griffon|achillea|discord-sync/.test(p))
    return "rg";
  return null;
}

/** Normalises epoch seconds/milliseconds or date strings to ISO, or null. */
function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    /^\d+(\.\d+)?$/.test(String(value))
  ) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n > 1e14 ? n / 1000 : n > 1e11 ? n : n * 1000;
    const d = new Date(ms);
    return d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100
      ? d.toISOString()
      : null;
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function maxIso(values: Iterable<string | null>): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (!best || v > best)) best = v;
  return best;
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const reader = Bun.file(path).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
  }
  return hasher.digest("hex");
}

async function findFiles(roots: string[], args: string[]): Promise<string[]> {
  const existing: string[] = [];
  for (const root of roots)
    if ((await Bun.$`test -d ${root}`.nothrow().quiet()).exitCode === 0)
      existing.push(root);
  if (existing.length === 0) return [];
  const prune = [
    "(",
    "-name",
    "node_modules",
    "-o",
    "-name",
    "target",
    "-o",
    "-name",
    ".git",
    "-o",
    "-name",
    ".next",
    ")",
    "-prune",
    "-o",
  ];
  const out = await Bun.$`find ${existing} -xdev ${prune} ${args} -print`
    .nothrow()
    .quiet()
    .text();
  return [...new Set(out.split("\n").filter(Boolean))].toSorted();
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

async function findVecExtension(dirs: string[]): Promise<string | null> {
  for (const dir of dirs)
    if (await Bun.file(`${dir}/vec0.so`).exists()) return `${dir}/vec0.so`;
  return null;
}

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

async function probeSqlite(
  host: string,
  path: string,
  domain: Domain,
  vecExtension: string | null,
): Promise<SqliteCandidate> {
  const file = Bun.file(path);
  const base: SqliteCandidate = {
    host,
    path,
    domain,
    bytes: file.size,
    modified: new Date(file.lastModified).toISOString(),
    sha256: await sha256(path),
    integrity: "unknown",
    totalRows: 0,
    newestRow: null,
    tables: [],
  };
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    if (vecExtension) attempt(() => db!.loadExtension(vecExtension), undefined);
    base.integrity = attempt(
      () =>
        String(
          (
            db!.query("pragma quick_check(1)").get() as Record<
              string,
              unknown
            > | null
          )?.quick_check ?? "unknown",
        ),
      "unchecked (module missing)",
    );
    const names = db
      .query(
        "select name from sqlite_schema where type = 'table' and name not like 'sqlite_%' order by name",
      )
      .all() as { name: string }[];
    for (const { name } of names) {
      const columns = attempt(
        () =>
          (
            db!.query(`pragma table_info(${quoteIdent(name)})`).all() as {
              name: string;
            }[]
          ).map((c) => c.name),
        [] as string[],
      );
      let rows = 0;
      let newest: string | null = null;
      try {
        rows = Number(
          (
            db.query(`select count(*) as n from ${quoteIdent(name)}`).get() as {
              n: number;
            }
          ).n,
        );
        const timeColumns = columns.filter((c) => TIME_COLUMN.test(c));
        newest = maxIso(
          timeColumns.map((c) =>
            toIso(
              (
                db!
                  .query(
                    `select max(${quoteIdent(c)}) as v from ${quoteIdent(name)}`,
                  )
                  .get() as { v: unknown }
              ).v,
            ),
          ),
        );
      } catch {
        // Virtual tables (FTS/vec) without their module still count as present.
      }
      base.tables.push({ name, rows, columns, newest });
    }
    base.totalRows = base.tables.reduce((sum, t) => sum + t.rows, 0);
    base.newestRow = maxIso(base.tables.map((t) => t.newest));
  } catch (error) {
    base.error = error instanceof Error ? error.message : String(error);
  } finally {
    db?.close();
  }
  return base;
}

async function probePackage(
  host: string,
  manifestPath: string,
): Promise<PackageCandidate | null> {
  const manifest = (await Bun.file(manifestPath).json()) as {
    name?: string;
    version?: string;
    exports?: Record<string, unknown> | string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const domain = manifest.name ? PACKAGE_NAMES[manifest.name] : undefined;
  if (!domain) return null;
  const dir = manifestPath.slice(0, -"/package.json".length);
  const files: PackageFile[] = [];
  const declared = new Set<string>();
  for await (const rel of new Bun.Glob("**/*.{ts,tsx,sql,json}").scan({
    cwd: dir,
    onlyFiles: true,
  })) {
    if (/(^|\/)(node_modules|dist|target)\//.test(rel) || rel.endsWith(".d.ts"))
      continue;
    const f = Bun.file(`${dir}/${rel}`);
    const text = await f.text();
    for (const m of text.matchAll(DECLARED_TABLE))
      declared.add((m[1] ?? m[2] ?? m[3] ?? "").toLowerCase());
    files.push({
      path: rel,
      bytes: f.size,
      sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
      modified: new Date(f.lastModified).toISOString(),
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const exportsField = manifest.exports;
  return {
    host,
    dir,
    domain,
    name: manifest.name!,
    version: manifest.version ?? "0.0.0",
    modified:
      maxIso(files.map((f) => f.modified)) ??
      new Date(Bun.file(manifestPath).lastModified).toISOString(),
    dependencies: { ...manifest.peerDependencies, ...manifest.dependencies },
    exports:
      typeof exportsField === "string"
        ? ["."]
        : Object.keys(exportsField ?? {}),
    files,
    declaredTables: [...declared].filter(Boolean).toSorted(),
  };
}

export async function probe(input: ProbeInput): Promise<ProbeOutput> {
  const sqlitePaths = await findFiles(input.sqliteRoots, [
    "-type",
    "f",
    "(",
    "-name",
    "*.db",
    "-o",
    "-name",
    "*.sqlite",
    "-o",
    "-name",
    "*.sqlite3",
    ")",
    "-size",
    "+8k",
  ]);
  const vecExtension = await findVecExtension(input.vecExtensionDirs ?? []);
  const sqlite: SqliteCandidate[] = [];
  for (const path of sqlitePaths) {
    const domain = classify(path);
    if (domain)
      sqlite.push(await probeSqlite(input.host, path, domain, vecExtension));
  }
  const manifests = await findFiles(input.packageRoots, [
    "-type",
    "f",
    "-path",
    "*/db/package.json",
  ]);
  const packages: PackageCandidate[] = [];
  for (const path of manifests) {
    const candidate = await probePackage(input.host, path).catch(() => null);
    if (candidate) packages.push(candidate);
  }
  return { host: input.host, bun: Bun.version, sqlite, packages };
}

if (import.meta.main) {
  const raw = Bun.env.PROBE_INPUT;
  if (!raw) throw new Error("PROBE_INPUT (base64 JSON) is required");
  const input = JSON.parse(
    new TextDecoder().decode(Uint8Array.fromBase64(raw)),
  ) as ProbeInput;
  console.log(JSON.stringify(await probe(input)));
}
