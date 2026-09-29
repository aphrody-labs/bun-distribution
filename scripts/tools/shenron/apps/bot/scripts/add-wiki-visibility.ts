/**
 * Ajoute la colonne PG-only `visible boolean NOT NULL DEFAULT true` sur les tables
 * wiki éditoriales « parcourables » du schéma `bot` (Postgres du site). Permet à
 * l'admin de masquer une entité du site public sans la supprimer.
 *
 * Colonne PG-ONLY (comme `article`/`players`/`frames`) : le forward-sync
 * SQLite→Neon EXCLUT ces tables éditoriales et le reverse-sync Neon→SQLite les
 * préserve par intersection de colonnes → jamais écrasée, jamais poussée en
 * SQLite. Idempotent (`ADD COLUMN IF NOT EXISTS`) — sûr à rejouer.
 *
 * Lancer sur le VPS (PG local) :
 *   sudo systemd-run --pipe -p EnvironmentFile=/home/ubuntu/.shenron-neon.env \
 *     --working-directory=/home/ubuntu/shenron/apps/bot bun scripts/add-wiki-visibility.ts
 * ou simplement `DATABASE_URL=... bun scripts/add-wiki-visibility.ts`.
 */
import postgres from "postgres";

const VISIBILITY_TABLES = [
	"db_characters",
	"db_planets",
	"db_transformations",
	"db_races",
	"db_techniques",
	"db_sagas",
	"db_arcs",
	"db_episodes",
	"db_movies",
	"db_games",
	"db_manga_volumes",
	"db_manga_chapters",
] as const;

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL requis (Postgres du site).");
	const sql = postgres(url, { max: 1 });
	try {
		for (const t of VISIBILITY_TABLES) {
			await sql.unsafe(
				`ALTER TABLE bot."${t}" ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT true`
			);
			console.log(`✓ bot.${t}.visible`);
		}
		console.log(`\n${VISIBILITY_TABLES.length} tables OK.`);
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
