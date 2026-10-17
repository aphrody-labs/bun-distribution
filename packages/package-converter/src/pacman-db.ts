// SPDX-License-Identifier: MIT
// pacman sync databases (<repo>.db / <repo>.files): a tar of <name>-<version>/desc and
// <name>-<version>/files entries. Reference: alpm-repo-db(5) and alpm-repo-files(5).
import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { repositoryUrls, type PacmanRepository } from "../../../factory/arch/index.ts";
import { decodedFile, download } from "./remote.ts";
import { tarStream } from "./tar.ts";

export type { PacmanRepository } from "../../../factory/arch/index.ts";

export interface PacmanPackage {
  repo: string;
  family: PacmanRepository["family"];
  priority: number;
  name: string;
  version: string;
  base?: string;
  filename: string;
  sha256: string;
  csize: number;
  isize: number;
  arch: string;
  description?: string;
  url?: string;
  packager?: string;
  licenses: string[];
  depends: string[];
  optdepends: string[];
  provides: string[];
  conflicts: string[];
  replaces: string[];
  groups: string[];
}

export interface Dependency {
  name: string;
  operator?: "<" | "<=" | "=" | ">=" | ">";
  version?: string;
  description?: string;
}

/** alpm dependency expression: name[op version][: description]. */
export function parseDependency(text: string): Dependency {
  const [expression, ...description] = text.split(": ");
  const match = /^([^<>=\s]+)(?:(<=|>=|<|>|=)(.+))?$/.exec(expression!.trim());
  if (!match) throw new Error(`Invalid pacman dependency: ${text}`);
  return {
    name: match[1]!,
    operator: match[2] as Dependency["operator"],
    version: match[3],
    description: description.length ? description.join(": ") : undefined,
  };
}

/** `libfoo.so=1-64` is an automatic soname provide; returns `libfoo.so.1` and 64. */
export function sonameProvide(dependency: Dependency): { soname: string; bits: 32 | 64 } | undefined {
  if (!dependency.name.endsWith(".so")) return undefined;
  const match = /^(.*?)-(32|64)$/.exec(dependency.version ?? "");
  const version = match ? match[1]! : (dependency.version ?? "");
  return {
    soname: version ? `${dependency.name}.${version}` : dependency.name,
    bits: match?.[2] === "32" ? 32 : 64,
  };
}

export function parseDesc(text: string): Record<string, string[]> {
  const fields: Record<string, string[]> = Object.create(null);
  let key: string | undefined;
  for (const line of text.split("\n")) {
    const header = /^%([A-Z0-9]+)%$/.exec(line);
    if (header) fields[(key = header[1]!)] = [];
    else if (!line) key = undefined;
    else if (key) fields[key]!.push(line);
  }
  return fields;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pacman_repo(
  name TEXT PRIMARY KEY, priority INTEGER NOT NULL, family TEXT NOT NULL, arch TEXT NOT NULL,
  isa TEXT NOT NULL, servers TEXT NOT NULL, db_url TEXT, db_sha256 TEXT, files_sha256 TEXT,
  synced TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pacman_pkg(
  repo TEXT NOT NULL, name TEXT NOT NULL, version TEXT NOT NULL, base TEXT, filename TEXT NOT NULL,
  sha256 TEXT NOT NULL, csize INTEGER NOT NULL, isize INTEGER NOT NULL, arch TEXT NOT NULL,
  description TEXT, url TEXT, packager TEXT, licenses TEXT NOT NULL, depends TEXT NOT NULL,
  optdepends TEXT NOT NULL, provides TEXT NOT NULL, conflicts TEXT NOT NULL, replaces TEXT NOT NULL,
  groups_ TEXT NOT NULL, PRIMARY KEY(repo, name));
CREATE TABLE IF NOT EXISTS pacman_provide(provide TEXT NOT NULL, repo TEXT NOT NULL, name TEXT NOT NULL, version TEXT);
CREATE INDEX IF NOT EXISTS pacman_provide_name ON pacman_provide(provide);
CREATE TABLE IF NOT EXISTS pacman_soname(soname TEXT NOT NULL, bits INTEGER NOT NULL, repo TEXT NOT NULL, name TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS pacman_soname_name ON pacman_soname(repo, name);
CREATE INDEX IF NOT EXISTS pacman_soname_soname ON pacman_soname(soname);
CREATE TABLE IF NOT EXISTS pacman_file(repo TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS pacman_file_pkg ON pacman_file(repo, name);
CREATE TABLE IF NOT EXISTS ubuntu_release(suite TEXT PRIMARY KEY, mirror TEXT NOT NULL, sha256 TEXT NOT NULL, signature TEXT NOT NULL, synced TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ubuntu_pkg(
  name TEXT NOT NULL, arch TEXT NOT NULL, version TEXT NOT NULL, suite TEXT NOT NULL, component TEXT NOT NULL,
  section TEXT, multiarch TEXT, essential INTEGER NOT NULL, PRIMARY KEY(name, arch));
CREATE TABLE IF NOT EXISTS ubuntu_provide(provide TEXT NOT NULL, name TEXT NOT NULL, arch TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ubuntu_provide_name ON ubuntu_provide(provide);
CREATE TABLE IF NOT EXISTS ubuntu_file(path TEXT PRIMARY KEY, packages TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ubuntu_lib(soname TEXT NOT NULL, arch TEXT NOT NULL, dir TEXT NOT NULL, path TEXT NOT NULL, packages TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ubuntu_lib_soname ON ubuntu_lib(soname);
`;

export async function openIndex(state: string): Promise<Database> {
  await mkdir(state, { recursive: true });
  const db = new Database(join(state, "index.sqlite"), { create: true });
  db.exec(SCHEMA);
  return db;
}

type Row = Record<string, string | number | null>;

const list = (value: string | number | null | undefined): string[] =>
  typeof value === "string" ? (JSON.parse(value) as string[]) : [];

function packageRow(row: Row): PacmanPackage {
  return {
    repo: row.repo as string,
    family: row.family as PacmanPackage["family"],
    priority: row.priority as number,
    name: row.name as string,
    version: row.version as string,
    base: (row.base as string) ?? undefined,
    filename: row.filename as string,
    sha256: row.sha256 as string,
    csize: row.csize as number,
    isize: row.isize as number,
    arch: row.arch as string,
    description: (row.description as string) ?? undefined,
    url: (row.url as string) ?? undefined,
    packager: (row.packager as string) ?? undefined,
    licenses: list(row.licenses),
    depends: list(row.depends),
    optdepends: list(row.optdepends),
    provides: list(row.provides),
    conflicts: list(row.conflicts),
    replaces: list(row.replaces),
    groups: list(row.groups_),
  };
}

// Unversioned names are kept: NSS-style runtime libraries have no soname version, and
// development symlinks resolve to -dev owners that the converter ignores.
const LIB64 = /^usr\/lib\/([^/]+\.so(?:\.\d[^/]*)?)$/;
const LIB32 = /^usr\/lib32\/([^/]+\.so(?:\.\d[^/]*)?)$/;
const BIN = /^usr\/bin\/([^/]+)$/;

export interface RepositorySync {
  repo: string;
  packages: number;
  files: number;
  url: string;
  sha256: string;
}

/** Download `<repo>.db` (and `.files` when requested) and replace the repository rows. */
export async function syncRepository(
  db: Database,
  repository: PacmanRepository,
  priority: number,
  state: string,
  withFiles: boolean,
): Promise<RepositorySync> {
  const directory = join(state, "pacman", repository.name);
  await mkdir(directory, { recursive: true });
  const kind = withFiles ? "files" : "db";
  const fetched = await download(
    repositoryUrls(repository, `${repository.name}.${kind}`),
    join(directory, `${repository.name}.${kind}`),
    { maxBytes: 512 << 20, timeoutMs: 600_000 },
  );
  const insertPackage = db.prepare(`INSERT INTO pacman_pkg VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertProvide = db.prepare(`INSERT INTO pacman_provide VALUES (?,?,?,?)`);
  const insertSoname = db.prepare(`INSERT INTO pacman_soname VALUES (?,?,?,?)`);
  const insertFile = db.prepare(`INSERT INTO pacman_file VALUES (?,?,?)`);
  const owners = new Map<string, string>();
  let packages = 0;
  let files = 0;
  const pendingFiles = new Map<string, string[]>();
  const rows: Array<() => void> = [];
  for await (const entry of tarStream(await decodedFile(fetched.path), {
    entry: 64 << 20,
    total: 4 * 2 ** 30,
    entries: 2_000_000,
  })) {
    if (entry.kind !== "file") continue;
    const [directoryName, member] = entry.path.split("/");
    if (!directoryName || !member) continue;
    const text = new TextDecoder().decode(entry.data);
    if (member === "desc") {
      const fields = parseDesc(text);
      const one = (key: string) => fields[key]?.[0];
      const many = (key: string) => JSON.stringify(fields[key] ?? []);
      const name = one("NAME");
      const version = one("VERSION");
      const filename = one("FILENAME");
      const sha256 = one("SHA256SUM");
      if (!name || !version || !filename || !sha256 || !/^[a-f0-9]{64}$/.test(sha256))
        throw new Error(`${repository.name}: incomplete desc in ${directoryName}`);
      owners.set(directoryName, name);
      packages++;
      rows.push(() => {
        insertPackage.run(
          repository.name,
          name,
          version,
          one("BASE") ?? null,
          filename,
          sha256,
          Number(one("CSIZE") ?? 0),
          Number(one("ISIZE") ?? 0),
          one("ARCH") ?? repository.arch,
          one("DESC") ?? null,
          one("URL") ?? null,
          one("PACKAGER") ?? null,
          many("LICENSE"),
          many("DEPENDS"),
          many("OPTDEPENDS"),
          many("PROVIDES"),
          many("CONFLICTS"),
          many("REPLACES"),
          many("GROUPS"),
        );
        insertProvide.run(name, repository.name, name, version);
        for (const provide of fields.PROVIDES ?? []) {
          const dependency = parseDependency(provide);
          insertProvide.run(dependency.name, repository.name, name, dependency.version ?? null);
          const soname = sonameProvide(dependency);
          if (soname) insertSoname.run(soname.soname, soname.bits, repository.name, name);
        }
      });
    } else if (member === "files") {
      pendingFiles.set(
        directoryName,
        (parseDesc(text).FILES ?? []).filter(path => LIB64.test(path) || LIB32.test(path) || BIN.test(path)),
      );
    }
  }
  db.transaction(() => {
    for (const table of ["pacman_pkg", "pacman_provide", "pacman_soname", "pacman_file"])
      db.prepare(`DELETE FROM ${table} WHERE repo = ?`).run(repository.name);
    for (const row of rows) row();
    for (const [directoryName, paths] of pendingFiles) {
      const name = owners.get(directoryName);
      if (!name) continue;
      for (const path of paths) {
        const lib64 = LIB64.exec(path);
        const lib32 = LIB32.exec(path);
        if (lib64) insertSoname.run(lib64[1]!, 64, repository.name, name);
        else if (lib32) insertSoname.run(lib32[1]!, 32, repository.name, name);
        insertFile.run(repository.name, name, path);
        files++;
      }
    }
    db.prepare(`INSERT OR REPLACE INTO pacman_repo VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      repository.name,
      priority,
      repository.family,
      repository.arch,
      repository.isa,
      JSON.stringify(repository.servers),
      fetched.url,
      withFiles ? null : fetched.sha256,
      withFiles ? fetched.sha256 : null,
      new Date().toISOString(),
    );
  })();
  return {
    repo: repository.name,
    packages,
    files,
    url: fetched.url,
    sha256: fetched.sha256,
  };
}

const SELECT = `SELECT p.*, r.family, r.priority FROM pacman_pkg p JOIN pacman_repo r ON r.name = p.repo`;

export class PacmanIndex {
  constructor(readonly db: Database) {}

  repositories(): Array<PacmanRepository & { priority: number }> {
    return (this.db.prepare(`SELECT * FROM pacman_repo ORDER BY priority`).all() as Row[]).map(row => ({
      name: row.name as string,
      family: row.family as PacmanRepository["family"],
      arch: row.arch as string,
      isa: row.isa as PacmanRepository["isa"],
      servers: JSON.parse(row.servers as string) as string[],
      priority: row.priority as number,
    }));
  }

  /** Exact name, first repository in pacman.conf order wins (pacman semantics). */
  get(name: string, repo?: string): PacmanPackage | undefined {
    const row = this.db
      .prepare(`${SELECT} WHERE p.name = ? ${repo ? "AND p.repo = ?" : ""} ORDER BY r.priority LIMIT 1`)
      .get(...(repo ? [name, repo] : [name])) as Row | null;
    return row ? packageRow(row) : undefined;
  }

  byFilename(filename: string): PacmanPackage | undefined {
    const row = this.db
      .prepare(`${SELECT} WHERE p.filename = ? ORDER BY r.priority LIMIT 1`)
      .get(filename) as Row | null;
    return row ? packageRow(row) : undefined;
  }

  /** Providers of a virtual name, best repository first; the exact name is excluded. */
  providers(name: string): PacmanPackage[] {
    return (
      this.db
        .prepare(
          `${SELECT} JOIN pacman_provide v ON v.repo = p.repo AND v.name = p.name
           WHERE v.provide = ? AND p.name <> ? ORDER BY r.priority, p.name`,
        )
        .all(name, name) as Row[]
    ).map(packageRow);
  }

  sonames(pkg: PacmanPackage): Array<{ soname: string; bits: 32 | 64 }> {
    return this.db
      .prepare(`SELECT DISTINCT soname, bits FROM pacman_soname WHERE repo = ? AND name = ?`)
      .all(pkg.repo, pkg.name) as Array<{ soname: string; bits: 32 | 64 }>;
  }

  binaries(pkg: PacmanPackage): string[] {
    return (
      this.db
        .prepare(`SELECT path FROM pacman_file WHERE repo = ? AND name = ? AND path LIKE 'usr/bin/%'`)
        .all(pkg.repo, pkg.name) as Array<{ path: string }>
    ).map(row => row.path);
  }

  hasFiles(pkg: PacmanPackage): boolean {
    return !!this.db
      .prepare(`SELECT files_sha256 FROM pacman_repo WHERE name = ? AND files_sha256 IS NOT NULL`)
      .get(pkg.repo);
  }

  /** Resolve a requested name: exact package, else a single unambiguous provider. */
  resolve(name: string): PacmanPackage {
    const [repo, bare] = name.includes("/") ? name.split("/", 2) : [undefined, name];
    const exact = this.get(bare!, repo);
    if (exact) return exact;
    const providers = this.providers(bare!).filter(pkg => !repo || pkg.repo === repo);
    if (!providers.length) throw new Error(`${name}: not found in the synced pacman databases`);
    if (providers.length > 1)
      throw new Error(
        `${name} is virtual; choose one provider: ${providers.map(pkg => `${pkg.repo}/${pkg.name}`).join(", ")}`,
      );
    return providers[0]!;
  }
}

/** pacman/libalpm version comparison (rpmvercmp with epoch and pkgrel). */
export function vercmp(left: string, right: string): number {
  const split = (value: string) => {
    const epoch = /^(\d+):/.exec(value);
    const rest = epoch ? value.slice(epoch[0].length) : value;
    const dash = rest.lastIndexOf("-");
    return {
      epoch: Number(epoch?.[1] ?? 0),
      version: dash < 0 ? rest : rest.slice(0, dash),
      release: dash < 0 ? undefined : rest.slice(dash + 1),
    };
  };
  const segments = (a: string, b: string): number => {
    const pattern = /([0-9]+|[a-zA-Z]+)/g;
    const x = a.match(pattern) ?? [];
    const y = b.match(pattern) ?? [];
    for (let index = 0; index < Math.min(x.length, y.length); index++) {
      const p = x[index]!;
      const q = y[index]!;
      const numeric = /^\d/.test(p);
      if (numeric !== /^\d/.test(q)) return numeric ? 1 : -1;
      const difference = numeric ? Math.sign(Number(BigInt(p) - BigInt(q))) : p < q ? -1 : p > q ? 1 : 0;
      if (difference) return difference;
    }
    if (x.length === y.length) return 0;
    const longer = x.length > y.length ? x[y.length]! : y[x.length]!;
    const sign = x.length > y.length ? 1 : -1;
    return /^\d/.test(longer) ? sign : -sign;
  };
  const a = split(left);
  const b = split(right);
  if (a.epoch !== b.epoch) return Math.sign(a.epoch - b.epoch);
  const version = segments(a.version, b.version);
  if (version || a.release === undefined || b.release === undefined) return version;
  return segments(a.release, b.release);
}
