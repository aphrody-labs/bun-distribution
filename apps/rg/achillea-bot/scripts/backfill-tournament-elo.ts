/**
 * Rétroactif : applique l'Elo ranked aux matchs de tournoi déjà terminés.
 *
 * Implémentation **SQL pur** (Bun.SQL) — pas de DI bot (évite les cycles
 * Database ↔ Stats ↔ …). Même barème progressif que EloService.
 *
 * Usage (cwd apps/achillea-bot) :
 *   bun scripts/backfill-tournament-elo.ts              # dry-run
 *   bun scripts/backfill-tournament-elo.ts --apply
 *   bun scripts/backfill-tournament-elo.ts --apply --limit=50 --verbose
 */

import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname });

import {
	applyEloUpdate,
	DEFAULT_BASE_RATING,
	DEFAULT_K_FACTOR,
	progressiveEloDelta,
	computeSeriesOutcome,
} from "@rosegriffon/achillea-core";
import { MatchFormat } from "../src/utils/enums";

type CliOpts = { apply: boolean; limit: number | null; verbose: boolean };

function parseArgs(argv: string[]): CliOpts {
	const opts: CliOpts = { apply: false, limit: null, verbose: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--apply") opts.apply = true;
		else if (a === "--verbose" || a === "-v") opts.verbose = true;
		else if (a.startsWith("--limit=")) opts.limit = Number(a.slice("--limit=".length));
		else if (a === "--limit") opts.limit = Number(argv[++i]);
		else if (a === "--help" || a === "-h") {
			console.info(
				"Usage: bun scripts/backfill-tournament-elo.ts [--apply] [--limit N] [--verbose]"
			);
			process.exit(0);
		}
	}
	return opts;
}

function openSql() {
	const host = process.env.DATABASE_HOST!;
	const port = Number(process.env.DATABASE_PORT || 5432);
	const user = process.env.DATABASE_USER!;
	const password = process.env.DATABASE_PASSWORD!;
	const database = process.env.DATABASE_NAME || "postgres";
	if (!host || !user || !password) {
		throw new Error("DATABASE_* manquants dans apps/achillea-bot/.env");
	}
	console.info(`DB ${user}@${host}:${port}/${database}`);
	return new Bun.SQL({
		hostname: host,
		port,
		username: user,
		password,
		database,
		tls: host.includes("supabase") ? { rejectUnauthorized: false } : undefined,
		max: 3,
	});
}

interface RankRow {
	min_elo: number;
	max_elo: number;
}

interface PendingLobby {
	id: number;
	state: string;
	match_format: string;
	created_at: string;
	mode: number;
	event_id: number;
	event_name: string;
}

interface LobbyUserRow {
	id: number;
	user_id: string;
	team: number;
	score: number;
	forfeit: boolean;
}

function tierIndexForElo(elo: number, ranks: RankRow[]): number {
	for (let i = 0; i < ranks.length; i++) {
		if (elo >= ranks[i]!.min_elo && elo <= ranks[i]!.max_elo) return i;
	}
	return elo > 0 && ranks.length > 0 ? ranks.length - 1 : 0;
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const sql = openSql();

	const ranks = (await sql`
		SELECT min_elo, max_elo FROM rank ORDER BY min_elo ASC
	`) as RankRow[];

	const seasonRows = (await sql`
		SELECT id, config FROM season WHERE state = 'Active' ORDER BY starts_at DESC LIMIT 1
	`) as Array<{ id: string; config: { kFactor?: number; baseRating?: number } | null }>;
	const season = seasonRows[0] ?? null;
	const kFactor = season?.config?.kFactor ?? DEFAULT_K_FACTOR;
	const baseRating = season?.config?.baseRating ?? DEFAULT_BASE_RATING;
	const seasonId = season?.id ?? null;

	const limitSql = opts.limit != null ? `LIMIT ${Number(opts.limit)}` : "";
	const pending = (await sql.unsafe(`
		SELECT l.id, l.state, l.match_format, l.created_at, l.mode, l.event_id,
		       COALESCE(e.name, '') AS event_name
		FROM lobby l
		LEFT JOIN event e ON e.id = l.event_id
		WHERE l.event_type = 'TOURNAMENT'
		  AND l.state IN ('Finished', 'Forfeited')
		  AND l.ranked_elo_applied = false
		ORDER BY l.created_at ASC, l.id ASC
		${limitSql}
	`)) as PendingLobby[];

	console.info(
		`[backfill] ${pending.length} lobby(s) en attente (${opts.apply ? "APPLY" : "DRY-RUN"})` +
			` k=${kFactor} base=${baseRating} ranks=${ranks.length}`
	);

	let applied = 0;
	let skipped = 0;
	let failed = 0;

	const getOrCreateElo = async (
		tx: any,
		userId: string,
		mode: number
	): Promise<{ elo: number }> => {
		const existing = await tx`
			SELECT elo FROM user_elo WHERE user_id = ${userId} AND mode = ${mode} LIMIT 1
		`;
		if (existing[0]) return { elo: Number(existing[0].elo) };
		await tx`
			INSERT INTO user_elo (user_id, mode, season_id, elo, peak_rating, games_played, wins, losses, created_at, updated_at)
			VALUES (${userId}, ${mode}, ${seasonId}, ${baseRating}, ${baseRating}, 0, 0, 0, NOW(), NOW())
			ON CONFLICT (user_id, mode) DO NOTHING
		`;
		const refreshed = await tx`
			SELECT elo FROM user_elo WHERE user_id = ${userId} AND mode = ${mode} LIMIT 1
		`;
		return { elo: Number(refreshed[0]?.elo ?? baseRating) };
	};

	for (const row of pending) {
		try {
			let users = (await sql`
				SELECT id, user_id, team, score, forfeit
				FROM lobby_user WHERE lobby_id = ${row.id} ORDER BY team
			`) as LobbyUserRow[];

			const team1 = users.filter((u) => Number(u.team) === 1);
			const team2 = users.filter((u) => Number(u.team) === 2);
			if (!team1.length || !team2.length) {
				skipped++;
				if (opts.verbose) console.info(`  [skip] #${row.id} équipes incomplètes`);
				continue;
			}

			// Reconstruire scores depuis lobby_match si absents
			const hasScores =
				team1.some((u) => Number(u.score) > 0 || u.forfeit) ||
				team2.some((u) => Number(u.score) > 0 || u.forfeit);

			if (!hasScores && row.state === "Finished") {
				const matches = (await sql`
					SELECT game_number, score_team1, score_team2,
					       team1validated, team2validated, admin_validated
					FROM lobby_match WHERE lobby_id = ${row.id} ORDER BY game_number ASC
				`) as Array<{
					score_team1: number;
					score_team2: number;
					team1validated: boolean;
					team2validated: boolean;
					admin_validated: boolean;
				}>;

				const series = matches.map((m) => ({
					isValidated: true,
					scoreTeam1: Number(m.score_team1 ?? 0),
					scoreTeam2: Number(m.score_team2 ?? 0),
				}));
				const fmt = (row.match_format as MatchFormat) || MatchFormat.DOUBLE_LEG;
				const outcome = computeSeriesOutcome(fmt, series);
				if (outcome.status !== "decided") {
					skipped++;
					if (opts.verbose)
						console.info(`  [skip] #${row.id} issue indéterminée (${outcome.status})`);
					continue;
				}
				if (opts.apply) {
					await sql`
						UPDATE lobby_user SET score = ${outcome.scoreT1}, state = 'Finished', updated_at = NOW()
						WHERE lobby_id = ${row.id} AND team = 1
					`;
					await sql`
						UPDATE lobby_user SET score = ${outcome.scoreT2}, state = 'Finished', updated_at = NOW()
						WHERE lobby_id = ${row.id} AND team = 2
					`;
					users = (await sql`
						SELECT id, user_id, team, score, forfeit
						FROM lobby_user WHERE lobby_id = ${row.id} ORDER BY team
					`) as LobbyUserRow[];
				} else {
					// dry-run : inject scores en mémoire
					for (const u of users) {
						u.score = Number(u.team) === 1 ? outcome.scoreT1 : outcome.scoreT2;
					}
				}
			}

			const t1 = users.filter((u) => Number(u.team) === 1);
			const t2 = users.filter((u) => Number(u.team) === 2);
			const s1 = Number(t1[0]?.score ?? 0);
			const s2 = Number(t2[0]?.score ?? 0);
			const t1Forfeit = t1.some((u) => u.forfeit);
			const t2Forfeit = t2.some((u) => u.forfeit);

			let winner: 1 | 2 | null = null;
			if (t1Forfeit && !t2Forfeit) winner = 2;
			else if (t2Forfeit && !t1Forfeit) winner = 1;
			else if (s1 > s2) winner = 1;
			else if (s2 > s1) winner = 2;

			if (winner == null) {
				skipped++;
				if (opts.verbose) console.info(`  [skip] #${row.id} pas de vainqueur (score ${s1}-${s2})`);
				continue;
			}

			if (!opts.apply) {
				applied++;
				if (opts.verbose) {
					console.info(`  [dry] #${row.id} « ${row.event_name} » T${winner} gagne ${s1}-${s2}`);
				}
				continue;
			}

			const mode = Number(row.mode) || 2;

			await sql.begin(async (tx: any) => {
				// Idempotence sous lock
				const cur = await tx`
					SELECT ranked_elo_applied FROM lobby WHERE id = ${row.id} FOR UPDATE
				`;
				if (!cur[0] || cur[0].ranked_elo_applied) return;

				const eloMap = new Map<string, number>();
				for (const u of users) {
					const e = await getOrCreateElo(tx, u.user_id, mode);
					eloMap.set(u.user_id, e.elo);
				}

				const avg = (side: LobbyUserRow[]) => {
					if (!side.length) return baseRating;
					let sum = 0;
					for (const u of side) sum += eloMap.get(u.user_id) ?? baseRating;
					return sum / side.length;
				};
				const opp1 = avg(t2);
				const opp2 = avg(t1);

				const applySide = async (
					side: LobbyUserRow[],
					oppAvg: number,
					actual: number,
					isWin: boolean,
					isLoss: boolean
				) => {
					for (const u of side) {
						const before = eloMap.get(u.user_id) ?? baseRating;
						const d = progressiveEloDelta(
							before,
							oppAvg,
							actual,
							tierIndexForElo(before, ranks),
							kFactor
						);
						const { newElo, clampedDelta } = applyEloUpdate(before, d);
						await tx`
							UPDATE user_elo SET
								elo = ${newElo},
								peak_rating = GREATEST(peak_rating, ${newElo}),
								games_played = games_played + 1,
								wins = wins + ${isWin ? 1 : 0},
								losses = losses + ${isLoss ? 1 : 0},
								updated_at = NOW()
							WHERE user_id = ${u.user_id} AND mode = ${mode}
						`;
						await tx`
							UPDATE lobby_user SET
								elo_variation = ${clampedDelta},
								validated_result = true,
								state = 'Finished',
								updated_at = NOW()
							WHERE id = ${u.id}
						`;
						eloMap.set(u.user_id, newElo);
					}
				};

				if (winner === 1) {
					await applySide(t1, opp1, 1, true, false);
					await applySide(t2, opp2, 0, false, true);
				} else {
					await applySide(t1, opp1, 0, false, true);
					await applySide(t2, opp2, 1, true, false);
				}

				await tx`
					UPDATE lobby SET ranked_elo_applied = true, updated_at = NOW()
					WHERE id = ${row.id}
				`;
			});

			applied++;
			if (opts.verbose) {
				console.info(`  [ok] #${row.id} « ${row.event_name} » T${winner} ${s1}-${s2}`);
			}
		} catch (e) {
			failed++;
			console.error(`  [err] #${row.id}:`, e instanceof Error ? e.message : e);
		}
	}

	console.info("─".repeat(50));
	console.info(
		`[backfill] fin — applied=${applied} skipped=${skipped} failed=${failed}` +
			(opts.apply ? "" : " (dry-run)")
	);
	if (!opts.apply && applied > 0) {
		console.info("Relancer avec --apply pour écrire.");
	}

	await sql.close();
	process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
	console.error("[backfill] fatal:", e);
	process.exit(1);
});
