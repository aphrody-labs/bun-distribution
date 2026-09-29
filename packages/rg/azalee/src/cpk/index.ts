/** Accès SQL canonique à l’index CPK durable `inagle_cpk_index`. */
import { createAchilleaSql, sql } from "@rosegriffon/db/achillea-sql";
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

type Db = ReturnType<typeof createAchilleaSql<Database>>;
let db: Db | undefined;
function sqlDb(): Db {
	return (db ??= createAchilleaSql<Database>());
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

function files(rows: FileRow[]): CpkFile[] {
	return rows.map((row) => ({ name: row.name, ext: row.ext, cpk: row.cpk, path: row.path }));
}

async function subdirectories(dir: string): Promise<CpkDir[]> {
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
	const rows = await sqlDb()
		.selectFrom("inagle_cpk_index")
		.select(["name", "ext", "cpk", "path"])
		.where("dir", "=", dir)
		.orderBy("name", "asc")
		.execute();
	return { dir, dirs, files: files(rows) };
}

export async function listDirPaged(dirPath: string, limit = 200, offset = 0): Promise<CpkPagedListing> {
	const dir = normalizeDir(dirPath);
	const safeLimit = Math.min(Math.max(limit, 1), 5000);
	const safeOffset = Math.max(offset, 0);
	const dirs = await subdirectories(dir);
	if (!dir || dir === "data") return { dir: "data", dirs, files: [], fileTotal: 0, fileOffset: 0 };
	const [total, rows] = await Promise.all([
		sqlDb().selectFrom("inagle_cpk_index").select((eb) => eb.fn.countAll<number>().as("count")).where("dir", "=", dir).executeTakeFirstOrThrow(),
		sqlDb().selectFrom("inagle_cpk_index").select(["name", "ext", "cpk", "path"]).where("dir", "=", dir).orderBy("name", "asc").limit(safeLimit).offset(safeOffset).execute(),
	]);
	return { dir, dirs, files: files(rows), fileTotal: Number(total.count), fileOffset: safeOffset };
}

export async function fileMeta(filePath: string): Promise<CpkFileMeta | null> {
	const row = await sqlDb()
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
	const needle = `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
	const rows = await sql<FileRow>`
		select path, name, ext, cpk from public.inagle_cpk_index
		where path ilike ${needle} escape '\\'
		order by length(name), name limit ${Math.min(Math.max(limit, 1), 1000)}
	`.execute(sqlDb());
	return files(rows.rows);
}

export async function totalFiles(): Promise<number> {
	const row = await sqlDb().selectFrom("inagle_cpk_index").select((eb) => eb.fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
	return Number(row.count);
}
