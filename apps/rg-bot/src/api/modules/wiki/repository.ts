import { sql, type Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";
import { cpkAssetKind, cpkAssetUrl, cpkThumbUrl, normalizeDir } from "@rosegriffon/azalee/cpk/shared";
import { normalizeHashId, type GameTextLocale } from "@rosegriffon/azalee/game-text/shared";

type Row = Record<string, unknown>;

/** SQL-first read model for the unified API. */
export class WikiSqlRepository {
	constructor(private readonly db: Kysely<Database>) {}

	private async list(
		table: string,
		query: string | undefined,
		limit: number,
		page: number,
		extraWhere: ReturnType<typeof sql> = sql.raw("true"),
	) {
		const offset = Math.max(0, page - 1) * limit;
		const needle = query?.trim() ? `%${query.trim().replaceAll("%", "\\%")}%` : null;
		try {
			const textWhere = needle
				? sql`(name_fr ilike ${needle} escape '\\' or name_en ilike ${needle} escape '\\' or name_ja ilike ${needle} escape '\\')`
				: sql.raw("true");
			const where = sql`where ${textWhere} and ${extraWhere}`;
			const result = await sql<Row>`select * from public.${sql.raw(table)} ${where} order by id asc limit ${limit} offset ${offset}`.execute(this.db);
			const count = await sql<{ count: string }>`select count(*)::text as count from public.${sql.raw(table)} ${where}`.execute(this.db);
			return { data: result.rows, count: Number(count.rows[0]?.count ?? 0), page, limit, source: "postgres" as const };
		} catch {
			return null;
		}
	}

	characters(query: string | undefined, limit = 24, page = 1) { return this.list("inagle_characters", query, limit, page); }
	skills(query: string | undefined, limit = 24, page = 1) { return this.list("inagle_skills", query, limit, page); }
	items(query: string | undefined, limit = 24, page = 1, category?: string) {
		return this.list(
			"inagle_items",
			query,
			limit,
			page,
			category === undefined ? sql.raw("true") : sql`category = ${category}`,
		);
	}
	quests(query: string | undefined, limit = 24, page = 1, phase?: number) {
		return this.list(
			"inagle_quests",
			query,
			limit,
			page,
			phase === undefined ? sql.raw("true") : sql`phase = ${String(phase)}`,
		);
	}
	passives(query: string | undefined, limit = 24, page = 1) { return this.list("inagle_passives", query, limit, page); }

	async character(id: string) { return this.one("inagle_characters", sql`id = ${id}`); }
	async skill(id: string) { return this.one("inagle_skills", sql`id = ${id}`); }
	async item(id: string) { return this.one("inagle_items", sql`id = ${id} or internal_code = ${id}`); }
	async quest(id: string) { return this.one("inagle_quests", sql`id = ${id}`); }
	async passive(id: string) { return this.one("inagle_passives", sql`id = ${id}`); }

	private async one(table: string, where: ReturnType<typeof sql>) {
		try {
			return (await sql<Row>`select * from public.${sql.raw(table)} where ${where} limit 1`.execute(this.db)).rows[0] ?? null;
		} catch {
			return null;
		}
	}

	async teams(query?: string, limit = 500) {
		try {
			let request = this.db.selectFrom("inagle_teams").selectAll().orderBy("name_fr", "asc").limit(limit);
			if (query?.trim()) {
				const term = `%${query.trim()}%`;
				request = request.where((eb) => eb.or([
					eb("name_fr", "ilike", term),
					eb("name_en", "ilike", term),
					eb("name_ja", "ilike", term),
				]));
			}
			return await request.execute();
		} catch {
			return null;
		}
	}

	async team(id: string) { return this.one("inagle_teams", sql`id = ${id}`); }

	async drops() {
		try { return (await sql<Row>`select * from public.inagle_drops order by id asc`.execute(this.db)).rows; }
		catch { return null; }
	}

	async crossCatalog(query: string | undefined, type: string | undefined, limit = 50, page = 1) {
		const safeLimit = Math.min(Math.max(limit, 1), 200);
		const offset = Math.max(0, page - 1) * safeLimit;
		const needle = query?.trim() ? `%${query.trim().replaceAll("%", "\\%")}%` : null;
		try {
			const filters = [
				needle ? sql`(key ilike ${needle} escape '\\' or bundle ilike ${needle} escape '\\')` : sql`true`,
				type?.trim() ? sql`type = ${type.trim()}` : sql`true`,
			];
			const where = sql.join(filters, sql` and `);
			const [rows, count] = await Promise.all([
				sql<Row>`select guid, key, type, bundle, size, n_deps, deps from public.inagle_cross_catalog where ${where} order by key asc limit ${safeLimit} offset ${offset}`.execute(this.db),
				sql<{ count: string }>`select count(*)::text as count from public.inagle_cross_catalog where ${where}`.execute(this.db),
			]);
			return { data: rows.rows, count: Number(count.rows[0]?.count ?? 0), page, limit: safeLimit, source: "postgres" as const };
		} catch {
			return null;
		}
	}

	async crossAsset(guid: string) {
		try {
			return (await sql<Row>`select guid, key, type, bundle, size, n_deps, deps from public.inagle_cross_catalog where guid = ${guid} limit 1`.execute(this.db)).rows[0] ?? null;
		} catch {
			return null;
		}
	}

	async cpkList(inputPath = "", limit = 200, offset = 0) {
		const dir = normalizeDir(inputPath);
		const safeLimit = Math.min(Math.max(limit, 1), 1000);
		const safeOffset = Math.max(offset, 0);
		try {
			if (!dir || dir === "data") {
				const rows = await sql<Row>`select top as name, count(*)::int as count from public.inagle_cpk_index group by top order by top`.execute(this.db);
				return { dir: "data", dirs: rows.rows, files: [], fileTotal: 0, fileOffset: 0, source: "postgres" as const };
			}
			const prefix = `${dir}/`;
			const [dirs, files, total] = await Promise.all([
				sql<Row>`select split_part(substring(path from ${prefix.length + 1}), '/', 1) as name, count(*)::int as count from public.inagle_cpk_index where path like ${`${prefix}%`} and dir <> ${dir} group by 1 order by 1`.execute(this.db),
				sql<Row>`select name, ext, cpk, path from public.inagle_cpk_index where dir = ${dir} order by name limit ${safeLimit} offset ${safeOffset}`.execute(this.db),
				sql<{ count: string }>`select count(*)::text as count from public.inagle_cpk_index where dir = ${dir}`.execute(this.db),
			]);
			return {
				dir, dirs: dirs.rows.filter((row) => String(row.name ?? "").length > 0),
				files: files.rows, fileTotal: Number(total.rows[0]?.count ?? 0), fileOffset: safeOffset,
				source: "postgres" as const,
			};
		} catch {
			return { dir, dirs: [], files: [], fileTotal: 0, fileOffset: safeOffset, source: "postgres" as const };
		}
	}

	async cpkFile(path: string) {
		try {
			const row = (await sql<Row>`select path, top, sub, dir, name, ext, cpk, depth from public.inagle_cpk_index where path = ${normalizeDir(path)} limit 1`.execute(this.db)).rows[0];
			if (!row) return null;
			return { ...row, kind: cpkAssetKind(String(row.ext)), assetUrl: cpkAssetUrl(String(row.path), String(row.ext)), thumbUrl: cpkThumbUrl(String(row.path), String(row.ext)), source: "postgres" as const };
		} catch {
			return null;
		}
	}

	async cpkSearch(query: string, limit = 200) {
		const needle = query.trim().toLowerCase();
		if (needle.length < 2) return [];
		try {
			const rows = await sql<Row>`select path, name, ext, cpk from public.inagle_cpk_index where lower(path) like ${`%${needle.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`} escape '\\' order by length(name), name limit ${Math.min(Math.max(limit, 1), 1000)}`.execute(this.db);
			return rows.rows;
		} catch {
			return [];
		}
	}

	async gameText(hash: string | number) {
		try {
			return (await sql<Row>`select hash_id, locale, category, value from public.inagle_game_text where hash_id = ${normalizeHashId(hash)} order by locale`.execute(this.db)).rows;
		} catch {
			return [];
		}
	}

	async gameTextSearch(query: string, locale: GameTextLocale = "fr", limit = 50) {
		const needle = query.trim();
		if (!needle) return [];
		try {
			return (await sql<Row>`select hash_id, locale, category, value from public.inagle_game_text where locale = ${locale} and value ilike ${`%${needle.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`} escape '\\' order by hash_id limit ${Math.min(Math.max(limit, 1), 500)}`.execute(this.db)).rows;
		} catch {
			return [];
		}
	}

	async gameTextStats() {
		try {
			return (await sql<Row>`select category, count(*)::int as count from public.inagle_game_text where locale = 'fr' group by category order by count desc`.execute(this.db)).rows;
		} catch {
			return [];
		}
	}

	async auxiliary(table: string, orderBy = "id") {
		const allowed = new Set(["inagle_shops", "inagle_capsules", "inagle_costumes", "inagle_stadiums", "inagle_trophies", "inagle_constellations", "inagle_coordinators", "inagle_gallery", "inagle_auras", "inagle_tactics", "inagle_keshins", "inagle_souls", "inagle_miximax"]);
		if (!allowed.has(table)) return null;
		try { return (await sql<Row>`select * from public.${sql.raw(table)} order by ${sql.raw(orderBy)} asc`.execute(this.db)).rows; }
		catch { return null; }
	}

	async auxiliaryOne(table: string, id: string) {
		const allowed = new Set(["inagle_shops", "inagle_capsules", "inagle_costumes", "inagle_stadiums", "inagle_trophies", "inagle_constellations", "inagle_coordinators", "inagle_gallery", "inagle_auras", "inagle_tactics", "inagle_keshins", "inagle_souls", "inagle_miximax"]);
		if (!allowed.has(table)) return null;
		const key = table === "inagle_shops" ? "shop_id" : "id";
		try { return (await sql<Row>`select * from public.${sql.raw(table)} where ${sql.raw(key)} = ${id} limit 1`.execute(this.db)).rows[0] ?? null; }
		catch { return null; }
	}
}
