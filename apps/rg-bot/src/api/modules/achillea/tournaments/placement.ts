import { applyEloUpdate, DEFAULT_BASE_RATING, MatchMode, placementPrizeAp } from "@rosegriffon/achillea-core";
import { Status } from "brackets-model";
import { sql, type Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";
import { finalTournamentStandings } from "./bracket";

export type PlacementPrizeResult =
	| { applied: true; deltas: Record<string, number>; tournamentSize: number }
	| { applied: false; reason: string };

/**
 * Applique le bonus de classement dans une transaction idempotente.
 * Toute mutation métier est ici, hors du bot Discord et des contrôleurs HTTP.
 */
export async function applyPlacementPrizes(
	db: Kysely<Database>,
	tournamentId: number,
	actorId: string | null,
	requireFinished = true
): Promise<PlacementPrizeResult> {
	const tournament = await db.selectFrom("event")
		.select(["internal_state", "tournament_type", "participants_number"])
		.where("id", "=", tournamentId).where("type", "=", "TOURNAMENT").executeTakeFirst();
	if (!tournament) return { applied: false, reason: "tournoi_introuvable" };
	if (requireFinished && tournament.internal_state !== "Finished") return { applied: false, reason: "tournoi_non_termine" };
	if (tournament.tournament_type !== "single_elimination" && tournament.tournament_type !== "double_elimination") return { applied: false, reason: "format_non_eligible" };
	const alreadyApplied = await db.selectFrom("tournament_event").select("id")
		.where("tournament_id", "=", tournamentId).where("type", "=", "TOURNAMENT_PLACEMENT_PRIZES_APPLIED").executeTakeFirst();
	if (alreadyApplied) return { applied: false, reason: "deja_applique" };
	// A finished event can still contain an unfinished migrated bracket. Never
	// pay a partial finalStandings projection: its apparent podium may change.
	const bracket = await sql<{ matches: string; unsettled: string }>`
		SELECT count(m.id)::text AS matches,
			count(m.id) FILTER (WHERE m.status NOT IN (${Status.Completed}, ${Status.Archived}))::text AS unsettled
		FROM bm_stage s
		LEFT JOIN bm_match m ON m.stage_id = s.id
		WHERE s.id = (
			SELECT id FROM bm_stage WHERE tournament_id = ${tournamentId}
			ORDER BY id DESC LIMIT 1
		)
	`.execute(db);
	if (!Number(bracket.rows[0]?.matches) || Number(bracket.rows[0]?.unsettled)) {
		return { applied: false, reason: "classement_non_resolu" };
	}
	let placements: Awaited<ReturnType<typeof finalTournamentStandings>>;
	try {
		placements = await finalTournamentStandings(db, tournamentId);
	} catch {
		return { applied: false, reason: "classement_non_resolu" };
	}
	if (!placements.length) return { applied: false, reason: "classement_vide" };
	const size = tournament.participants_number ?? 0;
	if (size <= 0) return { applied: false, reason: "taille_invalide" };
	const season = await db.selectFrom("season").select(["id", "config"])
		.where("state", "=", "Active").orderBy("starts_at", "desc").executeTakeFirst();
	const base = Number((season?.config as { baseRating?: number } | null)?.baseRating ?? DEFAULT_BASE_RATING);
	const deltas: Record<string, number> = {};
	await db.transaction().execute(async (trx) => {
		for (const placement of placements) {
			const prize = placementPrizeAp(size, placement.rank);
			if (prize <= 0) continue;
			const current = await trx.selectFrom("user_elo").select(["elo", "peak_rating"])
				.where("user_id", "=", placement.userId).where("mode", "=", MatchMode.ONE_VS_ONE).executeTakeFirst();
			const previous = Number(current?.elo ?? base);
			const next = applyEloUpdate(previous, prize);
			if (current) {
				await trx.updateTable("user_elo").set({
					elo: next.newElo,
					peak_rating: Math.max(Number(current.peak_rating ?? previous), next.newElo),
					updated_at: new Date(),
				}).where("user_id", "=", placement.userId).where("mode", "=", MatchMode.ONE_VS_ONE).execute();
			} else {
				await trx.insertInto("user_elo").values({
					user_id: placement.userId, season_id: season?.id ?? null, mode: MatchMode.ONE_VS_ONE,
					elo: next.newElo, peak_rating: next.newElo, games_played: 0, wins: 0, losses: 0,
					updated_at: new Date(),
				}).execute();
			}
			deltas[placement.userId] = next.clampedDelta;
		}
		await trx.insertInto("tournament_event").values({
			tournament_id: tournamentId, type: "TOURNAMENT_PLACEMENT_PRIZES_APPLIED",
			actor_id: actorId, target_id: null, payload: { deltas }, reason: null,
		}).execute();
	});
	return { applied: true, deltas, tournamentSize: size };
}
