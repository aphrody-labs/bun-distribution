import {
	applyEloUpdate,
	DEFAULT_BASE_RATING,
	DEFAULT_K_FACTOR,
	progressiveEloDelta,
	computeMatchElo,
	resolveTournamentSideOutcome,
} from "@rosegriffon/achillea-core";
import { LockMode } from "@mikro-orm/core";
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import type { Generated, Kysely } from "kysely";
import { singleton } from "tsyringe";

import { Lobby, Rank, Season, User, UserElo } from "@/entities";
import {
	EventTypeEnum,
	LobbyState,
	LobbyUserState,
	MatchMode,
	SeasonState,
	TeamSide,
} from "@/utils/enums";

import { Database } from "./Database";
import { MetricsService } from "./MetricsService";

export interface EloCalculationResult {
	newWinner: number;
	newLoser: number;
	delta: number;
}

export interface MatchResultOpts {
	matchId: string;
	winnerId: string;
	loserId: string;
	mode: MatchMode;
}

export interface TournamentEloApplyResult {
	applied: boolean;
	reason?: string;
	deltas?: Record<string, number>;
}

/** Placement final d'un participant (rank 1-based brackets-manager). */
interface EloDatabase {
	user_elo: {
		user_id: string;
		season_id: string | null;
		mode: number;
		elo: Generated<number>;
		peak_rating: Generated<number>;
		games_played: Generated<number>;
		wins: Generated<number>;
		losses: Generated<number>;
		updated_at: Generated<Date>;
	};
	season: {
		id: Generated<string>;
		name: string;
		starts_at: Date;
		ends_at: Date;
		state: string;
		config: Record<string, unknown> | null;
	};
}

const eloSql = createAchilleaSql<EloDatabase>() as Kysely<EloDatabase>;

interface EloSnapshot {
	userId: string;
	mode: MatchMode;
	seasonId: string | null;
	elo: number;
	peakRating: number;
	gamesPlayed: number;
	wins: number;
	losses: number;
}

@singleton()
export class EloService {
	constructor(
		private db: Database,
		private metrics: MetricsService
	) {}

	calculate(
		winnerRating: number,
		loserRating: number,
		kFactor: number = DEFAULT_K_FACTOR
	): EloCalculationResult {
		// Logique pure déléguée à @rosegriffon/achillea-core (identique au calcul historique).
		return computeMatchElo(winnerRating, loserRating, kFactor);
	}

	async applyMatchResult(
		opts: MatchResultOpts
	): Promise<{ winnerElo: EloSnapshot; loserElo: EloSnapshot; delta: number }> {
		const result = await eloSql.transaction().execute(async (trx) => {
			const activeSeason = await trx.selectFrom("season").selectAll()
				.where("state", "=", SeasonState.Active)
				.orderBy("starts_at", "desc").executeTakeFirst();
			const kFactor = Number(activeSeason?.config?.kFactor ?? DEFAULT_K_FACTOR);
			const baseRating = Number(activeSeason?.config?.baseRating ?? DEFAULT_BASE_RATING);
			const seasonId = activeSeason?.id ?? null;
			const findOrCreate = async (userId: string) => {
				await trx.insertInto("user_elo").values({
					user_id: userId, mode: opts.mode, season_id: seasonId,
					elo: baseRating, peak_rating: baseRating, games_played: 0, wins: 0, losses: 0,
				}).onConflict((oc) => oc.columns(["user_id", "mode"]).doNothing()).execute();
				return trx.selectFrom("user_elo").selectAll().where("user_id", "=", userId)
					.where("mode", "=", opts.mode).forUpdate().executeTakeFirstOrThrow();
			};
			const winner = await findOrCreate(opts.winnerId);
			const loser = await findOrCreate(opts.loserId);
			const { newWinner, newLoser, delta } = this.calculate(Number(winner.elo), Number(loser.elo), kFactor);
			const now = new Date();
			await trx.updateTable("user_elo").set({
				elo: newWinner, peak_rating: Math.max(Number(winner.peak_rating), newWinner),
				games_played: Number(winner.games_played) + 1, wins: Number(winner.wins) + 1, updated_at: now,
			}).where("user_id", "=", opts.winnerId).where("mode", "=", opts.mode).execute();
			await trx.updateTable("user_elo").set({
				elo: newLoser, games_played: Number(loser.games_played) + 1,
				losses: Number(loser.losses) + 1, updated_at: now,
			}).where("user_id", "=", opts.loserId).where("mode", "=", opts.mode).execute();
			return {
				winnerElo: { userId: opts.winnerId, mode: opts.mode, seasonId, elo: newWinner, peakRating: Math.max(Number(winner.peak_rating), newWinner), gamesPlayed: Number(winner.games_played) + 1, wins: Number(winner.wins) + 1, losses: Number(winner.losses) },
				loserElo: { userId: opts.loserId, mode: opts.mode, seasonId, elo: newLoser, peakRating: Number(loser.peak_rating), gamesPlayed: Number(loser.games_played) + 1, wins: Number(loser.wins), losses: Number(loser.losses) + 1 },
				delta,
			};
		});

		this.metrics.increment("achillea_elo_matches_total", { mode: String(opts.mode) });
		return result;
	}

	/**
	 * Applique l'Elo ranked (barème AP progressif) à un lobby de tournoi terminé.
	 * Idempotent via `lobby.rankedEloApplied`.
	 *
	 * 1 joueur / côté : Elo 1v1 classique.
	 * Plusieurs joueurs / côté : chaque joueur gagne/perd face à l'Elo moyen adverse.
	 */
	async applyTournamentLobbyResult(
		lobbyId: number,
		em?: DatabaseEntityManager
	): Promise<TournamentEloApplyResult> {
		const entityManager = em ?? this.db.em.fork();

		return await entityManager.transactional(async (tem) => {
			const lobby = await tem.findOne(
				Lobby,
				{ id: lobbyId },
				{
					populate: ["lobbyUsers", "lobbyUsers.user"],
					lockMode: LockMode.PESSIMISTIC_WRITE,
				}
			);

			if (!lobby) return { applied: false, reason: "lobby_introuvable" };
			if (lobby.eventType !== EventTypeEnum.TOURNAMENT)
				return { applied: false, reason: "pas_un_tournoi" };
			if (lobby.rankedEloApplied) return { applied: false, reason: "deja_applique" };
			if (lobby.state !== LobbyState.FINISHED && lobby.state !== LobbyState.FORFEITED)
				return { applied: false, reason: "lobby_non_termine" };

			const users = lobby.lobbyUsers.getItems();
			const team1 = users.filter((u) => u.team === TeamSide.TEAM_1);
			const team2 = users.filter((u) => u.team === TeamSide.TEAM_2);
			if (team1.length === 0 || team2.length === 0)
				return { applied: false, reason: "equipes_incompletes" };

			const outcome = resolveTournamentSideOutcome(team1, team2, lobby.state);
			if (!outcome) return { applied: false, reason: "issue_indeterminee" };

			const activeSeason = await this.getCurrentSeason(tem);
			const kFactor = activeSeason?.config?.kFactor ?? DEFAULT_K_FACTOR;
			const baseRating = activeSeason?.config?.baseRating ?? DEFAULT_BASE_RATING;
			const mode = lobby.mode || MatchMode.ONE_VS_ONE;

			const ranks = await tem.find(Rank, {}, { orderBy: { minElo: "ASC" } });
			const tierIndex = (elo: number): number => {
				for (let i = 0; i < ranks.length; i++) {
					if (elo >= ranks[i].minElo && elo <= ranks[i].maxElo) return i;
				}
				return elo > 0 && ranks.length > 0 ? ranks.length - 1 : 0;
			};

			const findOrCreate = async (userId: string): Promise<UserElo> => {
				const existing = await tem.findOne(UserElo, {
					user: { id: userId } as User,
					mode,
				});
				if (existing) return existing;
				const row = tem.create(UserElo, {
					user: tem.getReference(User, userId),
					mode,
					season: activeSeason,
					elo: baseRating,
					peakRating: baseRating,
					gamesPlayed: 0,
					wins: 0,
					losses: 0,
					createdAt: new Date(),
					updatedAt: new Date(),
				});
				tem.persist(row);
				return row;
			};

			const avgElo = async (side: typeof team1): Promise<number> => {
				let sum = 0;
				for (const lu of side) {
					const row = await findOrCreate(lu.user.id);
					sum += row.elo;
				}
				return side.length ? sum / side.length : baseRating;
			};

			const oppAvgForT1 = await avgElo(team2);
			const oppAvgForT2 = await avgElo(team1);

			const deltas: Record<string, number> = {};

			const applySide = async (
				side: typeof team1,
				oppAvg: number,
				actual: number,
				isWin: boolean,
				isLoss: boolean
			) => {
				for (const lu of side) {
					const row = await findOrCreate(lu.user.id);
					const d = progressiveEloDelta(row.elo, oppAvg, actual, tierIndex(row.elo), kFactor);
					const { newElo, clampedDelta } = applyEloUpdate(row.elo, d);
					row.elo = newElo;
					row.gamesPlayed += 1;
					if (isWin) row.wins += 1;
					if (isLoss) row.losses += 1;
					if (newElo > row.peakRating) row.peakRating = newElo;
					lu.eloVariation = clampedDelta;
					lu.state = LobbyUserState.FINISHED;
					lu.validatedResult = true;
					deltas[lu.user.id] = clampedDelta;
				}
			};

			if (outcome.winner === TeamSide.TEAM_1) {
				await applySide(team1, oppAvgForT1, 1, true, false);
				await applySide(team2, oppAvgForT2, 0, false, true);
			} else if (outcome.winner === TeamSide.TEAM_2) {
				await applySide(team1, oppAvgForT1, 0, false, true);
				await applySide(team2, oppAvgForT2, 1, true, false);
			} else {
				// Nul (rare en tournoi) : actual 0.5, pas de W/L
				await applySide(team1, oppAvgForT1, 0.5, false, false);
				await applySide(team2, oppAvgForT2, 0.5, false, false);
			}

			lobby.rankedEloApplied = true;
			await tem.flush();

			this.metrics.increment("achillea_elo_matches_total", { mode: String(mode) });

			return { applied: true, deltas };
		});
	}

	async getCurrentSeason(em?: DatabaseEntityManager): Promise<Season | null> {
		const entityManager = em ?? this.db.em.fork();
		return entityManager.findOne(
			Season,
			{ state: SeasonState.Active },
			{ orderBy: { startsAt: "DESC" } }
		);
	}

}
