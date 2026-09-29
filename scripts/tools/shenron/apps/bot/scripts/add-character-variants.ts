/**
 * Crée la table PG-only `bot.db_character_variants` : **une version d'un
 * personnage à une saga donnée** — « Son Goku, saga Namek », « Son Goku, saga
 * Majin Boo », « Vegeta, saga Cyborgs »…
 *
 * Pourquoi une table plutôt que des fiches séparées : dupliquer `db_characters`
 * (« Son Goku (Saga Namek) ») ferait exploser l'index des 1 323 personnages,
 * casserait les relations (techniques, transformations, planète d'origine) et
 * obligerait chaque lecteur à deviner quelle ligne est « le vrai » Goku. Ici
 * l'identité reste UNE, et la fiche gagne une frise de ses états successifs.
 *
 * Une variante ne redit pas la fiche : elle ne porte que ce qui CHANGE d'une
 * saga à l'autre (apparence, forme atteinte, puissance, rôle, faits marquants).
 * Tout champ laissé NULL retombe sur la fiche du personnage à l'affichage.
 *
 * Pose aussi les **bornes manga** sur `bot.db_sagas` (`manga_volume_start` /
 * `manga_volume_end`, plus les chapitres si un jour on les renseigne) : c'est
 * ce qui rend la présence d'un personnage dans une saga MESURABLE sur l'OCR du
 * manga (`bot.db_manga_pages`) au lieu d'être devinée. Les bornes vivent en
 * base — donc corrigibles depuis le back-office — et non en dur dans le code.
 *
 * Table PG-ONLY (comme `db_wiki_sections`) : absente des listes de sync, donc
 * ni poussée en SQLite, ni écrasée par le reverse-sync. `id` en IDENTITY (les
 * inserts viennent du site, cf. « PK wiki en IDENTITY »). Idempotent.
 *
 * Lancer sur le VPS (PG local) :
 *   sudo systemd-run --pipe -p EnvironmentFile=/home/ubuntu/.shenron-neon.env \
 *     --working-directory=/home/ubuntu/shenron/apps/bot bun scripts/add-character-variants.ts
 * ou simplement `DATABASE_URL=... bun scripts/add-character-variants.ts`.
 */
import postgres from "postgres";

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL requis (Postgres du site).");
	const sql = postgres(url, { max: 1 });
	try {
		await sql.unsafe(`
			CREATE TABLE IF NOT EXISTS bot."db_character_variants" (
				id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				character_id  bigint  NOT NULL,
				saga_id       bigint  NOT NULL,
				slug          text    NOT NULL,
				label         text    NOT NULL,
				display_name  text,
				name_ja       text,
				form          text,
				image         text,
				age           bigint,
				power_level   text,
				ki            text,
				max_ki        text,
				role          text,
				affiliation   text,
				summary       text,
				highlights    jsonb,
				transformation_ids jsonb,
				technique_ids jsonb,
				first_volume  bigint,
				last_volume   bigint,
				first_episode bigint,
				last_episode  bigint,
				origin        text,
				evidence      jsonb,
				sort_order    bigint  NOT NULL DEFAULT 0,
				visible       boolean NOT NULL DEFAULT true
			)
		`);

		// Une seule variante par couple (personnage, saga) : c'est la définition
		// même de la table, et c'est ce qui permet à l'amorçage d'être rejouable
		// (ON CONFLICT DO UPDATE) sans dupliquer ce qu'il a déjà posé.
		await sql.unsafe(`
			CREATE UNIQUE INDEX IF NOT EXISTS db_character_variants_uni
			ON bot."db_character_variants" (character_id, saga_id)
		`);
		// Le slug sert d'ancre stable dans l'URL de la fiche (#goku-namek).
		await sql.unsafe(`
			CREATE UNIQUE INDEX IF NOT EXISTS db_character_variants_slug_uni
			ON bot."db_character_variants" (slug)
		`);
		// Lecture publique : « toutes les variantes de ce personnage, dans l'ordre ».
		await sql.unsafe(`
			CREATE INDEX IF NOT EXISTS db_character_variants_char_idx
			ON bot."db_character_variants" (character_id, sort_order)
		`);
		// Lecture inverse : « qui apparaît dans cette saga » (page saga).
		await sql.unsafe(`
			CREATE INDEX IF NOT EXISTS db_character_variants_saga_idx
			ON bot."db_character_variants" (saga_id) WHERE visible
		`);

		// Colonnes ajoutées après coup : la table existe déjà en production.
		for (const col of ["first_episode", "last_episode"]) {
			await sql.unsafe(
				`ALTER TABLE bot."db_character_variants" ADD COLUMN IF NOT EXISTS ${col} bigint`
			);
		}
		// Épisodes dont le TITRE nomme le personnage — le seul enrichissement
		// éditorial qui se mesure au lieu de s'écrire. `[{ num, title }]`.
		await sql.unsafe(
			`ALTER TABLE bot."db_character_variants" ADD COLUMN IF NOT EXISTS key_episodes jsonb`
		);

		// Bornes manga des sagas — sans elles, aucune mesure de présence possible.
		for (const col of [
			"manga_volume_start",
			"manga_volume_end",
			"manga_chapter_start",
			"manga_chapter_end",
			// Bornes d'ÉPISODES : la seconde source mesurable. 18 sagas sur 33 n'ont
			// aucun support manga (GT, Daima, DBS anime, films) — leur présence se
			// mesure sur les synopsis de `db_episodes`, qui nomment les personnages
			// en clair. `episode_series` est indispensable : la numérotation
			// recommence à 1 dans chaque série (DBZ #1 ≠ DBGT #1).
			"episode_start",
			"episode_end",
		]) {
			await sql.unsafe(`ALTER TABLE bot."db_sagas" ADD COLUMN IF NOT EXISTS ${col} bigint`);
		}
		await sql.unsafe(`ALTER TABLE bot."db_sagas" ADD COLUMN IF NOT EXISTS episode_series text`);

		console.log("✓ bot.db_character_variants (+ index) et bornes manga/épisodes sur bot.db_sagas");
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
