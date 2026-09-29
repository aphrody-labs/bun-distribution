import postgres from "postgres";

import {
	type BxcResult,
	refreshEpisodePlayers,
	refreshMoviePlayers,
} from "./_bxc-media";
import {
	type Player,
	type ProbeResult,
	probePlayer,
	withConcurrency,
} from "./_embed-liveness";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const dryRun = process.argv.includes("--dry-run");
const limit = Math.max(1, Number(process.env.LIMIT ?? 15));
const rowConcurrency = Math.max(1, Number(process.env.ROW_CONCURRENCY ?? 4));
const staleHours = Math.max(1, Number(process.env.PLAYER_STALE_H ?? 8));
const drain = process.env.DRAIN === "1";
const baseBackoffMs = Math.max(
	60_000,
	Number(process.env.REPAIR_BACKOFF_MS ?? 3_600_000),
);
const maxBackoffMs = Math.max(
	baseBackoffMs,
	Number(process.env.REPAIR_MAX_BACKOFF_MS ?? 604_800_000),
);
const sql = postgres(databaseUrl, {
	max: 1,
	prepare: false,
	onnotice: () => {},
});

type MediaRow = {
	id: number;
	title: string;
	series?: string;
	numberInSeries?: number | null;
	players: Player[] | null;
	repairFailures?: number | null;
};

function dedupe(players: Player[]): Player[] {
	const seen = new Set<string>();
	return players.filter((player) => {
		const key = `${player.lang ?? "unknown"}:${player.embedUrl}`;
		if (!player.embedUrl || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function expectedLanguages(
	table: "db_episodes" | "db_movies",
	row: MediaRow,
): Player["lang"][] {
	if (table === "db_episodes")
		return row.series === "DB_DAIMA" ? ["vostfr"] : ["vf", "vostfr"];
	if ([16, 35, 36].includes(row.id)) return ["vostfr"];
	if ((row.id >= 12 && row.id <= 31) || row.id === 37) return ["vf", "vostfr"];
	return [];
}

function samePlayers(left: Player[], right: Player[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function nextRetryAt(failures: number): number {
	return (
		Date.now() +
		Math.min(maxBackoffMs, baseBackoffMs * 2 ** Math.min(failures, 10))
	);
}

async function inspect(players: Player[]): Promise<ProbeResult[]> {
	return withConcurrency(players, 8, (player) => probePlayer(player));
}

async function processRow(
	table: "db_episodes" | "db_movies",
	row: MediaRow,
	refresh: () => Promise<BxcResult<Player[]>>,
): Promise<void> {
	const current = dedupe(row.players ?? []);
	const verdicts = await inspect(current);
	const retained = current.filter(
		(_, index) => verdicts[index].verdict !== "dead",
	);
	const deadCount = current.length - retained.length;
	const expected = expectedLanguages(table, row);
	const missing = expected.filter(
		(language) => !retained.some((player) => player.lang === language),
	);
	const repairNeeded =
		current.length === 0 || deadCount > 0 || missing.length > 0;
	let finalPlayers = retained;
	let repairSucceeded = !repairNeeded;
	let failureReason = "";

	if (repairNeeded) {
		const fresh = await refresh();
		if (fresh.ok) {
			const freshPlayers = dedupe(fresh.value);
			const freshVerdicts = await inspect(freshPlayers);
			const verified = freshPlayers.filter(
				(_, index) => freshVerdicts[index].verdict === "alive",
			);
			finalPlayers = dedupe([...retained, ...verified]);
			repairSucceeded =
				verified.length > 0 &&
				expected.every((language) =>
					finalPlayers.some((player) => player.lang === language),
				);
			if (!repairSucceeded) {
				const stillMissing = expected.filter(
					(language) =>
						!finalPlayers.some((player) => player.lang === language),
				);
				failureReason =
					stillMissing.length > 0
						? `missing ${stillMissing.join("+")} players`
						: "no fresh player passed validation";
			}
		} else {
			failureReason = fresh.error;
		}
	}

	const suspectCount = verdicts.filter(
		(result) => result.verdict === "suspect",
	).length;
	const changed = !samePlayers(current, finalPlayers);
	const status = repairNeeded
		? repairSucceeded
			? "repaired"
			: "retry scheduled"
		: "healthy";
	console.log(
		`  ${table}#${row.id} ${status}: ${current.length} -> ${finalPlayers.length}, dead=${deadCount}, suspect=${suspectCount}${failureReason ? ` (${failureReason})` : ""}`,
	);

	if (dryRun) return;
	const now = Date.now();
	if (repairSucceeded) {
		await sql`
			UPDATE bot.${sql(table)}
			SET players = ${sql.json(finalPlayers)}, players_checked_at = ${now},
			    players_repair_failures = 0, players_repair_after = NULL
			WHERE id = ${row.id}
		`;
	} else {
		const failures = (row.repairFailures ?? 0) + 1;
		await sql`
			UPDATE bot.${sql(table)}
			SET players = ${sql.json(finalPlayers)}, players_checked_at = ${now},
			    players_repair_failures = ${failures},
			    players_repair_after = ${nextRetryAt(failures)}
			WHERE id = ${row.id}
		`;
	}
	if (changed)
		console.log(`    persisted player replacement for ${table}#${row.id}`);
}

async function rowsFor(
	table: "db_episodes" | "db_movies",
): Promise<MediaRow[]> {
	const staleBefore = Date.now() - staleHours * 3_600_000;
	if (table === "db_episodes") {
		return (await sql`
			SELECT id, title, series, number_in_series AS "numberInSeries", players,
			       players_repair_failures AS "repairFailures"
			FROM bot.db_episodes
			WHERE (players_repair_after IS NULL OR players_repair_after <= ${Date.now()})
			  AND (players_checked_at IS NULL OR players_checked_at < ${staleBefore})
			ORDER BY players_checked_at ASC NULLS FIRST
			LIMIT ${limit}
		`) as unknown as MediaRow[];
	}
	return (await sql`
		SELECT id, title, players, players_repair_failures AS "repairFailures"
		FROM bot.db_movies
		WHERE (players_repair_after IS NULL OR players_repair_after <= ${Date.now()})
		  AND (players_checked_at IS NULL OR players_checked_at < ${staleBefore})
		ORDER BY players_checked_at ASC NULLS FIRST
		LIMIT ${limit}
	`) as unknown as MediaRow[];
}

async function main(): Promise<void> {
	if (!dryRun) {
		for (const table of ["db_episodes", "db_movies"] as const) {
			await sql`ALTER TABLE bot.${sql(table)} ADD COLUMN IF NOT EXISTS players_checked_at bigint`;
			await sql`ALTER TABLE bot.${sql(table)} ADD COLUMN IF NOT EXISTS players_repair_failures integer NOT NULL DEFAULT 0`;
			await sql`ALTER TABLE bot.${sql(table)} ADD COLUMN IF NOT EXISTS players_repair_after bigint`;
		}
	}

	const [{ locked }] = (await sql`
		SELECT pg_try_advisory_lock(hashtext('shenron-media-player-repair')) AS locked
	`) as unknown as [{ locked: boolean }];
	if (!locked) {
		console.log("Another player repair cycle is already running; exiting.");
		return;
	}

	try {
		for (;;) {
			const episodes = await rowsFor("db_episodes");
			const movies = await rowsFor("db_movies");
			if (episodes.length === 0 && movies.length === 0) break;
			await withConcurrency(episodes, rowConcurrency, async (row) => {
				if (row.series && row.numberInSeries != null) {
					const series = row.series;
					const numberInSeries = row.numberInSeries;
					await processRow("db_episodes", row, () =>
						refreshEpisodePlayers(series, numberInSeries),
					);
				}
			});
			await withConcurrency(movies, rowConcurrency, (row) =>
				processRow("db_movies", row, () => refreshMoviePlayers(row.id)),
			);
			if (!drain) break;
		}
	} finally {
		await sql`SELECT pg_advisory_unlock(hashtext('shenron-media-player-repair'))`;
	}
}

console.log(dryRun ? "[DRY RUN]" : "[LIVE]");
await main();
await sql.end();
