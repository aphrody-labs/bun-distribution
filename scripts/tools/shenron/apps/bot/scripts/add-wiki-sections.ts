/**
 * Crée la table PG-only `bot.db_wiki_sections` : sections de contenu éditorial
 * par entité wiki (personnage, planète, saga…). Chaque ligne = un bloc markdown
 * riche nommé (« Histoire », « Personnalité », « Anecdotes », « PWS »…) attaché à
 * une entité, réordonnable et masquable individuellement.
 *
 * Table PG-ONLY (comme `visible`/`article`/`players`) : absente d'aucune liste de
 * sync (forward SQLite→PG et reverse PG→SQLite parcourent des tables nommées) →
 * ni poussée en SQLite, ni écrasée. Le site est le seul lecteur/écrivain.
 *
 * `id` en IDENTITY (inserts côté site, cf. `PK wiki en IDENTITY`). Idempotent
 * (`CREATE TABLE IF NOT EXISTS`) — sûr à rejouer.
 *
 * Lancer sur le VPS (PG local) :
 *   sudo systemd-run --pipe -p EnvironmentFile=/home/ubuntu/.shenron-neon.env \
 *     --working-directory=/home/ubuntu/shenron/apps/bot bun scripts/add-wiki-sections.ts
 * ou simplement `DATABASE_URL=... bun scripts/add-wiki-sections.ts`.
 */
import postgres from "postgres";

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL requis (Postgres du site).");
	const sql = postgres(url, { max: 1 });
	try {
		await sql.unsafe(`
			CREATE TABLE IF NOT EXISTS bot."db_wiki_sections" (
				id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				entity_type text    NOT NULL,
				entity_id   bigint  NOT NULL,
				key         text    NOT NULL,
				label       text    NOT NULL,
				accent      text,
				body        text,
				sort_order  bigint  NOT NULL DEFAULT 0,
				visible     boolean NOT NULL DEFAULT true
			)
		`);
		// Sous-catégories (2e niveau de hiérarchie) + pages wiki affiliées.
		// - group_label : nom d'un GROUPE parent optionnel qui regroupe plusieurs
		//   sections sous une même catégorie (ex. « Powerscaling » → « Feats »,
		//   « Statements »…). NULL = section de 1er niveau (comportement historique).
		// - links : tableau jsonb de cartes vers d'AUTRES pages wiki, chacune
		//   { href, label, image } → rendues en vignettes avec photo dans la section.
		await sql.unsafe(
			`ALTER TABLE bot."db_wiki_sections" ADD COLUMN IF NOT EXISTS group_label text`
		);
		await sql.unsafe(`ALTER TABLE bot."db_wiki_sections" ADD COLUMN IF NOT EXISTS links jsonb`);
		// Lecture publique : filtre (entity_type, entity_id) + tri sort_order.
		await sql.unsafe(`
			CREATE INDEX IF NOT EXISTS db_wiki_sections_entity_idx
			ON bot."db_wiki_sections" (entity_type, entity_id, sort_order)
		`);
		console.log("✓ bot.db_wiki_sections (+ group_label, links, index entité)");
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
