import { projectionSource, sqliteRows } from "../sql/sqlite-query.js";
import { gameVfs } from "../core/vfs-data.js";
import type { NieVfsHandle } from "../ffi/nie.js";
/** Accès SQL canonique à l’index CPK durable `inagle_cpk_index`. */
import { createInagleSql, sql } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";
import {
  cpkAssetKind,
  cpkAssetUrl,
  cpkThumbUrl,
  normalizeDir,
  type CpkAssetKind,
  type CpkDir,
  type CpkFile,
  type CpkListing,
} from "./shared";

export type { CpkDir, CpkFile, CpkListing } from "./shared";

type Db = ReturnType<typeof createInagleSql<Database>>;
let db: Db | undefined;
function sqlDb(): Db {
  return (db ??= createInagleSql<Database>());
}

export interface CpkFileMeta extends CpkFile {
  top: string;
  sub: string;
  dir: string;
  depth: number;
  kind: CpkAssetKind;
  assetUrl: string | null;
  thumbUrl: string | null;
}

export interface CpkPagedListing extends CpkListing {
  fileTotal: number;
  fileOffset: number;
}

type FileRow = { name: string; ext: string; cpk: string; path: string };
type SubRow = { name: string; count: number };
type IndexedFileRow = FileRow & { top: string; sub: string; dir: string; depth: number };
const nativeIndexes = new WeakMap<NieVfsHandle, IndexedFileRow[]>();

/** Project native index DTOs without duplicating archive or game-data decoding. */
export function vfsCpkRows(vfs: Pick<NieVfsHandle, "count" | "listRange">): IndexedFileRow[] {
  const count = Number(vfs.count());
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid native VFS entry count");
  const rows: IndexedFileRow[] = [];
  for (let offset = 0; offset < count; offset += 4096) {
    const page = vfs.listRange(offset, 4096);
    if (page.length !== Math.min(4096, count - offset))
      throw new Error("Native VFS index pagination ended early");
    for (const entry of page) {
      if (typeof entry.path !== "string" || !entry.path || typeof entry.cpk !== "string")
        throw new Error("Invalid native VFS index metadata");
      const path = String(entry.path);
      const segments = path.split("/");
      const name = segments.at(-1)!;
      const extension = name.lastIndexOf(".");
      rows.push({
        path,
        name,
        ext: extension < 0 ? "" : name.slice(extension + 1),
        cpk: String(entry.cpk ?? ""),
        dir: segments.slice(0, -1).join("/"),
        top: segments[segments[0] === "data" ? 1 : 0] ?? "",
        sub: segments[segments[0] === "data" ? 2 : 1] ?? "",
        depth: segments.length,
      });
    }
  }
  return rows;
}

function nativeRows(): IndexedFileRow[] {
  const vfs = gameVfs();
  let rows = nativeIndexes.get(vfs);
  if (!rows) {
    rows = vfsCpkRows(vfs);
    nativeIndexes.set(vfs, rows);
  }
  return rows;
}

function files(rows: FileRow[]): CpkFile[] {
  return rows.map((row) => ({ name: row.name, ext: row.ext, cpk: row.cpk, path: row.path }));
}

async function subdirectories(dir: string): Promise<CpkDir[]> {
  if (projectionSource() === "vfs") {
    const counts = new Map<string, number>();
    for (const row of nativeRows()) {
      const name =
        !dir || dir === "data"
          ? row.top
          : row.path.startsWith(`${dir}/`) && row.dir !== dir
            ? row.path.slice(dir.length + 1).split("/")[0]
            : "";
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));
  }
  if (projectionSource() === "sqlite") {
    if (!dir || dir === "data")
      return sqliteRows<SubRow>(
        "SELECT top AS name, COUNT(*) AS count FROM inagle_cpk_index GROUP BY top ORDER BY top",
      );
    const prefix = `${dir}/`;
    return sqliteRows<SubRow>(
      "SELECT CASE WHEN instr(rest, '/') > 0 THEN substr(rest, 1, instr(rest, '/') - 1) ELSE rest END AS name, count(*) AS count FROM (SELECT substr(path, ?) AS rest FROM inagle_cpk_index WHERE substr(path, 1, ?) = ? AND dir <> ?) GROUP BY name ORDER BY name",
      [prefix.length + 1, prefix.length, prefix, dir],
    ).filter((row) => row.name.length > 0);
  }
  if (!dir || dir === "data") {
    const rows = await sqlDb()
      .selectFrom("inagle_cpk_index")
      .select((eb) => ["top as name", eb.fn.countAll<number>().as("count")])
      .groupBy("top")
      .orderBy("top", "asc")
      .execute();
    return rows.map((row) => ({ name: row.name, count: Number(row.count) }));
  }
  const prefix = `${dir}/`;
  const rows = await sql<SubRow>`
		select split_part(substring(path from ${prefix.length + 1}), '/', 1) as name,
		       count(*)::int as count
		from public.inagle_cpk_index
		where path like ${`${prefix}%`} and dir <> ${dir}
		group by 1 order by 1
	`.execute(sqlDb());
  return rows.rows.filter((row) => row.name.length > 0);
}

export async function listDir(dirPath: string): Promise<CpkListing> {
  const dir = normalizeDir(dirPath);
  const dirs = await subdirectories(dir);
  if (!dir || dir === "data") return { dir: "data", dirs, files: [] };
  if (projectionSource() === "vfs")
    return {
      dir,
      dirs,
      files: files(
        nativeRows()
          .filter((row) => row.dir === dir)
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    };
  if (projectionSource() === "sqlite")
    return {
      dir,
      dirs,
      files: files(
        sqliteRows<FileRow>(
          "SELECT name, ext, cpk, path FROM inagle_cpk_index WHERE dir = ? ORDER BY name",
          [dir],
        ),
      ),
    };
  const rows = await sqlDb()
    .selectFrom("inagle_cpk_index")
    .select(["name", "ext", "cpk", "path"])
    .where("dir", "=", dir)
    .orderBy("name", "asc")
    .execute();
  return { dir, dirs, files: files(rows) };
}

export async function listDirPaged(
  dirPath: string,
  limit = 200,
  offset = 0,
): Promise<CpkPagedListing> {
  const dir = normalizeDir(dirPath);
  const safeLimit = Math.min(Math.max(limit, 1), 5000);
  const safeOffset = Math.max(offset, 0);
  const dirs = await subdirectories(dir);
  if (!dir || dir === "data") return { dir: "data", dirs, files: [], fileTotal: 0, fileOffset: 0 };
  if (projectionSource() === "vfs") {
    const rows = nativeRows()
      .filter((row) => row.dir === dir)
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      dir,
      dirs,
      files: files(rows.slice(safeOffset, safeOffset + safeLimit)),
      fileTotal: rows.length,
      fileOffset: safeOffset,
    };
  }
  if (projectionSource() === "sqlite") {
    const total = sqliteRows<{ count: number }>(
      "SELECT count(*) AS count FROM inagle_cpk_index WHERE dir = ?",
      [dir],
    )[0];
    const rows = sqliteRows<FileRow>(
      "SELECT name, ext, cpk, path FROM inagle_cpk_index WHERE dir = ? ORDER BY name LIMIT ? OFFSET ?",
      [dir, safeLimit, safeOffset],
    );
    return { dir, dirs, files: files(rows), fileTotal: total.count, fileOffset: safeOffset };
  }
  const [total, rows] = await Promise.all([
    sqlDb()
      .selectFrom("inagle_cpk_index")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("dir", "=", dir)
      .executeTakeFirstOrThrow(),
    sqlDb()
      .selectFrom("inagle_cpk_index")
      .select(["name", "ext", "cpk", "path"])
      .where("dir", "=", dir)
      .orderBy("name", "asc")
      .limit(safeLimit)
      .offset(safeOffset)
      .execute(),
  ]);
  return { dir, dirs, files: files(rows), fileTotal: Number(total.count), fileOffset: safeOffset };
}

export async function fileMeta(filePath: string): Promise<CpkFileMeta | null> {
  const row =
    projectionSource() === "vfs"
      ? nativeRows().find((row) => row.path === normalizeDir(filePath))
      : projectionSource() === "sqlite"
        ? sqliteRows<{
            path: string;
            top: string;
            sub: string;
            dir: string;
            name: string;
            ext: string;
            cpk: string;
            depth: number;
          }>(
            "SELECT path, top, sub, dir, name, ext, cpk, depth FROM inagle_cpk_index WHERE path = ?",
            [normalizeDir(filePath)],
          )[0]
        : await sqlDb()
            .selectFrom("inagle_cpk_index")
            .select(["path", "top", "sub", "dir", "name", "ext", "cpk", "depth"])
            .where("path", "=", normalizeDir(filePath))
            .executeTakeFirst();
  if (!row) return null;
  return {
    path: row.path,
    top: row.top,
    sub: row.sub,
    dir: row.dir,
    name: row.name,
    ext: row.ext,
    cpk: row.cpk,
    depth: row.depth,
    kind: cpkAssetKind(row.ext),
    assetUrl: cpkAssetUrl(row.path, row.ext),
    thumbUrl: cpkThumbUrl(row.path, row.ext),
  };
}

export async function searchFiles(query: string, limit = 200): Promise<CpkFile[]> {
  const value = query.trim();
  if (value.length < 2) return [];
  if (projectionSource() === "vfs")
    return files(
      nativeRows()
        .filter((row) => row.path.toLowerCase().includes(value.toLowerCase()))
        .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
        .slice(0, Math.min(Math.max(limit, 1), 1000)),
    );
  if (projectionSource() === "sqlite") {
    const results: FileRow[] = [];
    const maximum = Math.min(Math.max(limit, 1), 1000);
    for (let offset = 0; ; offset += 5000) {
      const page = sqliteRows<FileRow>(
        "SELECT path, name, ext, cpk FROM inagle_cpk_index ORDER BY length(name), name LIMIT 5000 OFFSET ?",
        [offset],
      );
      for (const row of page) {
        if (row.path.toLowerCase().includes(value.toLowerCase())) results.push(row);
        if (results.length >= maximum) return files(results);
      }
      if (page.length < 5000) return files(results);
    }
  }
  const needle = `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const rows = await sql<FileRow>`
		select path, name, ext, cpk from public.inagle_cpk_index
		where path ilike ${needle} escape '\\'
		order by length(name), name limit ${Math.min(Math.max(limit, 1), 1000)}
	`.execute(sqlDb());
  return files(rows.rows);
}

export async function totalFiles(): Promise<number> {
  if (projectionSource() === "vfs") return nativeRows().length;
  if (projectionSource() === "sqlite")
    return sqliteRows<{ count: number }>("SELECT count(*) AS count FROM inagle_cpk_index")[0].count;
  const row = await sqlDb()
    .selectFrom("inagle_cpk_index")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export * from "./nie-bridge.ts";
