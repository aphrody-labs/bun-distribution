import postgres from "postgres";

import { probePlayer, withConcurrency, type Player } from "./_embed-liveness";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const dryRun = process.argv.includes("--dry-run");
const sql = postgres(databaseUrl, { max: 5, prepare: false });

async function processTable(table: "db_episodes" | "db_movies"): Promise<void> {
	const rows = (await sql`
		SELECT id, title, players
		FROM bot.${sql(table)}
		WHERE jsonb_typeof(players) = 'array' AND jsonb_array_length(players) > 0
	`) as unknown as { id: number; title: string; players: Player[] }[];

	let before = 0;
	let after = 0;
	let dead = 0;
	let suspect = 0;
	for (const row of rows) {
		const verdicts = await withConcurrency(row.players, 12, (player) => probePlayer(player));
		const kept = row.players.filter((_, index) => verdicts[index].verdict !== "dead");
		const rowDead = row.players.length - kept.length;
		const rowSuspect = verdicts.filter((result) => result.verdict === "suspect").length;
		before += row.players.length;
		after += kept.length;
		dead += rowDead;
		suspect += rowSuspect;
		if (rowDead > 0) {
			console.log(
				`  ${table}#${row.id} ${row.players.length} -> ${kept.length} (dead=${rowDead}, suspect=${rowSuspect})`
			);
			if (!dryRun) {
				await sql`UPDATE bot.${sql(table)} SET players = ${sql.json(kept)} WHERE id = ${row.id}`;
			}
		}
	}
	console.log(`${table}: ${before} -> ${after}; dead=${dead}; preserved suspect=${suspect}`);
}

console.log(dryRun ? "[DRY RUN]" : "[LIVE]");
await processTable("db_episodes");
await processTable("db_movies");
await sql.end();
