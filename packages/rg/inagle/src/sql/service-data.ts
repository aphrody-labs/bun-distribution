import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import type { Database } from "@rosegriffon/db/schema";

type JsonObject = Record<string, unknown>;
type Db = ReturnType<typeof createAchilleaSql<Database>>;

function object(value: unknown): JsonObject {
	return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function array<T>(value: unknown): T[] {
	return Array.isArray(value) ? value as T[] : [];
}

/**
 * Charge les projections SQL consommées par le service Inagle.
 * PostgreSQL est l’unique source du runtime. Les parseurs de dump sont des
 * outils d’import séparés et ne constituent jamais un repli applicatif.
 */
export async function loadInagleServiceData(db: Db = createAchilleaSql<Database>()) {
	try {
		const optionalRows = async (table: string) => {
			try {
				return await db.selectFrom(table as any).selectAll().execute() as Record<string, unknown>[];
			} catch {
				return [];
			}
		};
		const [basara, characters, skills, passives, teams, formations, items, quests, capsules, gallery, uniforms, dropTables, dropBattles, dropTreasures, auras, keshins, souls, miximax, awakenings, modeChanges] = await Promise.all([
			db.selectFrom("inagle_basara").selectAll().orderBy("character_id", "asc").execute(),
			db.selectFrom("inagle_characters").selectAll().orderBy("id", "asc").execute(),
			db.selectFrom("inagle_skills").selectAll().orderBy("id", "asc").execute(),
			db.selectFrom("inagle_passives").selectAll().orderBy("id", "asc").execute(),
			db.selectFrom("inagle_teams").selectAll().orderBy("id", "asc").execute(),
			db.selectFrom("inagle_formations").selectAll().orderBy("id", "asc").execute(),
			db.selectFrom("inagle_items").selectAll().orderBy("id", "asc").execute(),
			db.selectFrom("inagle_quests").selectAll().orderBy("id", "asc").execute(),
			db.selectFrom("inagle_capsules").selectAll().orderBy("id", "asc").execute(),
			db.selectFrom("inagle_gallery").selectAll().orderBy("id", "asc").execute(),
			db.selectFrom("inagle_uniforms").selectAll().orderBy("name_id", "asc").execute(),
			db.selectFrom("inagle_drops_tables").selectAll().execute(),
			db.selectFrom("inagle_drops_battles").selectAll().execute(),
			db.selectFrom("inagle_drops_treasures").selectAll().execute(),
			optionalRows("inagle_auras"),
			optionalRows("inagle_keshins"),
			optionalRows("inagle_souls"),
			optionalRows("inagle_miximax"),
			optionalRows("inagle_awakenings"),
			optionalRows("inagle_mode_changes"),
		]);

		if (characters.length === 0 || skills.length === 0 || teams.length === 0) {
			throw new Error("Incomplete Inagle PostgreSQL projections: characters, skills and teams are required");
		}

		return {
			basara,
			characters,
			skills,
			passives,
			teams: teams.map((row) => {
				const payload = object(row.data);
				const name = row.name_fr ?? row.name_en ?? row.name_ja ?? row.id;
				return {
					...payload,
					teamId: row.id,
					teamIdStr: row.id,
					name,
					displayName: name,
					name_FR: row.name_fr ?? undefined,
					name_EN: row.name_en ?? undefined,
					name_JA: row.name_ja ?? undefined,
					emblemId: row.emblem_url ?? row.id,
					emblems: row.emblems ?? payload.emblems,
					kits: row.kits ?? payload.kits,
					uniforms: array(payload.uniforms),
				};
			}),
			formations: formations.map((row) => {
				const payload = object(row.data);
				return {
					...payload,
					formId: row.id,
					formIdStr: row.id,
					name_FR: row.name_fr ?? undefined,
					name_EN: row.name_en ?? undefined,
					name_JA: row.name_ja ?? undefined,
					placements: array(payload.placements),
				};
			}),
			items: items.map((row) => {
				const payload = object(row.data);
				return {
					...payload,
					itemId: row.id,
					internalCode: row.internal_code ?? undefined,
					category: row.category ?? "important",
					rarity: row.rarity ?? undefined,
					names: { en: row.name_en ?? undefined, fr: row.name_fr ?? undefined, ja: row.name_ja ?? undefined },
					descriptions: { en: row.description_en ?? undefined, fr: row.description_fr ?? undefined, ja: row.description_ja ?? undefined },
					imageUrl: row.image_url ?? undefined,
					shops: object(row.shops) as { en: string[]; fr: string[] },
					price: row.price ?? undefined,
				};
			}),
			quests: quests.map((row) => {
				const payload = object(row.data);
				const titles = object(payload.titles);
				return {
					...payload,
					questId: row.id,
					titleHash: String(payload.titleHash ?? ""),
					phase: Number(row.phase ?? payload.phase ?? 0),
					type: Number(row.type ?? payload.type ?? 0),
					titles: { en: row.name_en ?? titles.en, fr: row.name_fr ?? titles.fr, ja: row.name_ja ?? titles.ja },
				};
			}),
			capsules: capsules.map((row) => ({ ...object(row.data), capsuleId: row.id, capsuleIdStr: row.id, rarity: Number(object(row.data).rarity ?? 0), dropTable: array(row.prize_data), thumbnailPath: String(object(row.data).thumbnailPath ?? "") })),
			gallery: gallery.map((row) => ({ ...object(row.data), galleryId: row.id, galleryIdStr: row.id, imgPath: row.img_path ?? "", thumbPath: row.thumb_path ?? "", categoryId: Number(object(row.data).categoryId ?? 0), unlockCondition: String(object(row.data).unlockCondition ?? "") })),
			uniforms,
			drops: { tables: dropTables, battles: dropBattles, treasures: dropTreasures },
			auras,
			keshins,
			souls,
			miximax,
			awakenings,
			modeChanges,
		};
	} catch (error) {
		throw new Error(
			"Inagle PostgreSQL projections are unavailable; run the SQL importers before starting the runtime.",
			{ cause: error },
		);
	}
}
