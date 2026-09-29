/**
 * Migre l'`article` long-format des fiches wiki vers des **sections de contenu**
 * éditables (`bot.db_wiki_sections`) : découpe l'article par titre `##`
 * (Histoire / Personnalité / Pouvoirs et techniques / Transformations /
 * Anecdotes…) et crée une ligne de section par catégorie. Rend chaque catégorie
 * éditable individuellement au studio, sans rien fabriquer (le contenu existe
 * déjà). L'`article` est **conservé** (aucune perte ; le rendu public surcharge
 * l'article par les sections de même clé — cf. `buildWikiContentPanels`).
 *
 * Idempotent : une entité qui a déjà des sections est ignorée. N'migre que les
 * articles réellement structurés (≥ 2 sections `##`). `id` = IDENTITY (omis).
 *
 * Lancer (dry-run par défaut) :
 *   DATABASE_URL=... bun apps/site/scripts/migrate-articles-to-sections.ts
 *   DATABASE_URL=... bun apps/site/scripts/migrate-articles-to-sections.ts --apply
 *   … --table db_planets --entity-type planet --limit 50
 * ou via systemd-run avec EnvironmentFile=/home/ubuntu/.shenron-neon.env.
 */
import postgres from "postgres";
import { splitArticleSections } from "../src/lib/wiki-article-sections";

/** Table wiki → type d'entité (`db_wiki_sections.entity_type`). */
const TABLE_ENTITY: Record<string, string> = {
	db_characters: "character",
	db_planets: "planet",
	db_sagas: "saga",
	db_arcs: "arc",
	db_races: "race",
	db_techniques: "technique",
};

function argVal(args: string[], flag: string): string | undefined {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
	const args = process.argv.slice(2);
	const apply = args.includes("--apply");
	const table = argVal(args, "--table") ?? "db_characters";
	const entityType = argVal(args, "--entity-type") ?? TABLE_ENTITY[table] ?? "character";
	const limit = Number(argVal(args, "--limit") ?? "0") || 0;

	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL requis (Postgres du site).");
	const sql = postgres(url, { max: 1 });

	const stats = { scanned: 0, migrated: 0, skipped: 0, unstructured: 0, inserted: 0 };
	const sample: string[] = [];

	try {
		const rows = limit
			? await sql`select id, article from bot.${sql(table)}
					where article is not null and length(trim(article)) > 0 order by id limit ${limit}`
			: await sql`select id, article from bot.${sql(table)}
					where article is not null and length(trim(article)) > 0 order by id`;
		stats.scanned = rows.length;

		for (const r of rows) {
			const id = Number(r.id);
			const [{ n }] =
				await sql`select count(*)::int n from bot.db_wiki_sections where entity_type = ${entityType} and entity_id = ${id}`;
			if (Number(n) > 0) {
				stats.skipped++;
				continue;
			}

			const secs = splitArticleSections(r.article as string);
			// Article sans structure (< 2 titres ##) → laissé tel quel (le rendu
			// public l'affiche déjà en section unique « Histoire »).
			if (secs.length < 2) {
				stats.unstructured++;
				continue;
			}

			if (apply) {
				// Transaction par entité : un crash ne laisse jamais une fiche à moitié
				// migrée (que le garde-fou `count>0` sauterait ensuite pour toujours).
				await sql.begin(async (tx) => {
					for (let i = 0; i < secs.length; i++) {
						const s = secs[i];
						await tx`insert into bot.db_wiki_sections
							(entity_type, entity_id, key, label, accent, body, sort_order, visible)
							values (${entityType}, ${id}, ${s.key}, ${s.label}, ${s.accent}, ${s.body}, ${i}, true)`;
					}
				});
			}
			stats.migrated++;
			stats.inserted += secs.length;
			if (sample.length < 6) sample.push(`#${id}: ${secs.map((s) => s.label).join(" · ")}`);
		}

		console.log(
			`\n${apply ? "✓ APPLIQUÉ" : "▷ DRY-RUN (aucune écriture)"} — table=${table} entity=${entityType}`
		);
		console.table(stats);
		if (sample.length) {
			console.log("Exemples de découpage :");
			for (const s of sample) console.log("  " + s);
		}
		if (!apply && stats.migrated > 0) console.log("\nRelancer avec --apply pour écrire.");
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
