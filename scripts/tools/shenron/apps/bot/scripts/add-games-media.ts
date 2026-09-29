/**
 * Ajoute la colonne PG-only `media` (jsonb) sur `bot.db_games` : galerie style
 * Steam (images + trailers YouTube) sous la description de la fiche jeu.
 *
 *   sudo systemd-run --pipe -p EnvironmentFile=/home/ubuntu/.shenron-neon.env \
 *     --working-directory=/home/ubuntu/shenron/apps/bot bun scripts/add-games-media.ts
 */
import postgres from "postgres";

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL requis (Postgres du site).");
	const sql = postgres(url, { max: 1 });
	try {
		await sql.unsafe(`
			ALTER TABLE bot."db_games"
			ADD COLUMN IF NOT EXISTS media jsonb
		`);
		console.log("✓ bot.db_games.media (jsonb, galerie images + YouTube)");
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
