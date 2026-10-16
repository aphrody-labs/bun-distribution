import type { Database } from "@rosegriffon/db/schema";
import { sql, type Kysely } from "kysely";
import { WikiSqlRepository } from "../wiki/repository";

type Db = Kysely<Database>;

function json(value: unknown): unknown {
	return value ?? null;
}

export class InagleRepository {
	private readonly wiki: WikiSqlRepository;

	constructor(private readonly db: Db) {
		this.wiki = new WikiSqlRepository(db);
	}

	async teams(query?: string, limit = 50) {
		try {
			const rows = (await this.wiki.teams(query, limit)) ?? [];
			return rows.map((row) => ({
				...row,
				name: row.name_fr ?? row.name_en ?? row.name_ja ?? row.id,
				displayName: row.name_fr ?? row.name_en ?? row.name_ja ?? row.id,
				emblems: json(row.emblems),
				kits: json(row.kits),
				members: json(row.members),
			}));
		} catch {
			return null;
		}
	}

	async team(id: string) {
		try {
			const row = await this.wiki.team(id);
			return row ? {
				...row,
				name: row.name_fr ?? row.name_en ?? row.name_ja ?? row.id,
				displayName: row.name_fr ?? row.name_en ?? row.name_ja ?? row.id,
			} : null;
		} catch {
			return null;
		}
	}

	async quests(query?: string, phase?: number, limit = 50) {
		try {
			const rows = (await this.wiki.quests(query, limit, 1, phase))?.data ?? [];
			return rows.map((row) => ({
				...row,
				id: row.id,
				displayText: row.display_text ?? row.name_fr ?? row.name_en ?? row.name_ja ?? row.id,
				explain_FR: row.name_fr,
				explain_EN: row.name_en,
				explain_JA: row.name_ja,
			}));
		} catch {
			return null;
		}
	}

	async quest(id: string) {
		try {
			const row = await this.wiki.quest(id);
			return row ? {
				...row,
				displayText: row.display_text ?? row.name_fr ?? row.name_en ?? row.name_ja ?? row.id,
				explain_FR: row.name_fr,
				explain_EN: row.name_en,
				explain_JA: row.name_ja,
			} : null;
		} catch {
			return null;
		}
	}

	async items(query?: string, category?: string, limit = 50) {
		try {
			const rows = (await this.wiki.items(query, limit, 1, category))?.data ?? [];
			return rows.map((row) => ({
				...row,
				names: { fr: row.name_fr, en: row.name_en, ja: row.name_ja },
			}));
		} catch {
			return null;
		}
	}

	async souls(query?: string, limit = 50) {
		try {
			let request = this.db.selectFrom("inagle_souls").selectAll().orderBy("id", "asc").limit(limit);
			if (query) {
				const term = `%${query.toLowerCase()}%`;
				request = request.where((eb) => eb.or([
					eb("name_fr", "ilike", term),
					eb("name_en", "ilike", term),
					eb("name_ja", "ilike", `%${query}%`),
				]));
			}
			return await request.execute();
		} catch {
			return null;
		}
	}

	async formations(query?: string, limit = 50) {
		try {
			let request = this.db.selectFrom("inagle_formations").selectAll().orderBy("id", "asc").limit(limit);
			if (query) {
				const term = `%${query.toLowerCase()}%`;
				request = request.where((eb) => eb.or([
					eb("name_fr", "ilike", term),
					eb("name_en", "ilike", term),
					eb("name_ja", "ilike", `%${query}%`),
				]));
			}
			return await request.execute();
		} catch {
			return null;
		}
	}

	async formation(id: string) {
		try {
			return await this.db.selectFrom("inagle_formations").selectAll().where("id", "=", id).executeTakeFirst() ?? null;
		} catch {
			return null;
		}
	}

	async soul(id: string) {
		try {
			return await this.db.selectFrom("inagle_souls").selectAll().where("id", "=", id).executeTakeFirst() ?? null;
		} catch {
			return null;
		}
	}

	async item(id: string) {
		try {
			const row = await this.wiki.item(id);
			return row ? { ...row, names: { fr: row.name_fr, en: row.name_en, ja: row.name_ja } } : null;
		} catch {
			return null;
		}
	}

	async dropTable(id: string) {
		try {
			return await this.db.selectFrom("inagle_drops_tables").selectAll().where("table_id", "=", id).executeTakeFirst() ?? null;
		} catch {
			return null;
		}
	}

	async battleDrops(id: number) {
		try {
			const row = await sql<{ entries: unknown }>`
				select t.entries
				from public.inagle_drops_battles b
				join public.inagle_drops_tables t
				  on t.table_id = b.item_table_id::text
				where b.battle_group_id = ${id}
				  and b.item_table_id is not null
				limit 1
			`.execute(this.db);
			return row.rows[0] ? [{ items: row.rows[0].entries }] : [];
		} catch {
			return null;
		}
	}

	async dropSources(itemId: string) {
		try {
			const normalized = itemId.trim().toLowerCase();
			if (!normalized) return [];
			const result = await sql<{ type: "battle" | "treasure"; id: string; map_id: string | null }>`
				select 'battle'::text as type,
				       b.battle_group_id::text as id,
				       null::text as map_id
				from public.inagle_drops_battles b
				join public.inagle_drops_tables t
				  on t.table_id = b.item_table_id::text
				cross join lateral jsonb_array_elements(coalesce(t.entries, '[]'::jsonb)) entry
				where b.item_table_id is not null
				  and lower(coalesce(entry->>'itemId', entry->>'item_id', '')) = ${normalized}
				union all
				select 'treasure'::text as type,
				       tr.id,
				       tr.map_id
				from public.inagle_drops_treasures tr
				cross join lateral jsonb_array_elements_text(coalesce(tr.items, '[]'::jsonb)) item
				where lower(item) = ${normalized}
				order by type, id
			`.execute(this.db);
			return result.rows.map((row) => ({
				type: row.type,
				id: row.id,
				...(row.map_id ? { mapId: row.map_id } : {}),
			}));
		} catch {
			return null;
		}
	}

	async skillCutin(id: string) {
		try {
			return await this.db.selectFrom("inagle_skill_cutins").selectAll().where("skill_id", "=", id).executeTakeFirst() ?? null;
		} catch {
			return null;
		}
	}

	async skillCutinAssets(eventIdName: string) {
		try {
			return await this.db.selectFrom("inagle_skill_cutin_assets").selectAll().where("event_id_name", "=", eventIdName).executeTakeFirst() ?? null;
		} catch {
			return null;
		}
	}
}
