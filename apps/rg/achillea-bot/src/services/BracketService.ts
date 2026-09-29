import { rel } from "@mikro-orm/core";
import { Conflict, NotFound } from "@tsed/exceptions";
import { BracketsManager } from "brackets-manager";
import { computeSeriesOutcome } from "@rosegriffon/achillea-core";
import type { Id, IdSeeding, Match } from "brackets-model";

import { Service } from "@/decorators";
import { urlsConfig } from "@/configs";
import {
	Event,
	Lobby,
	LobbyMatch,
	LobbyUser,
	Tournament,
	TournamentParticipant,
	User,
} from "@/entities";
import {
	EventTypeEnum,
	LobbyState,
	LobbyUserState,
	MatchFormat,
	ParticipantStatus,
	StageType,
	TeamSide,
	TournamentState,
} from "@/utils/enums";

import { KyselyBracketAdapter } from "../utils/classes/KyselyBracketAdapter";
import { buildSeedingPayload } from "../utils/functions/buildSeedingPayload";
import { Database } from "./Database";
import { EloService } from "./EloService";

@Service()
export class BracketService {
	private manager: BracketsManager;

	constructor(
		private readonly db: Database,
		private readonly eloService: EloService
	) {
		const adapter = new KyselyBracketAdapter("bm_");
		this.manager = new BracketsManager(adapter);
	}

	async getTournamentData(tournamentId: number) {
		return await this.manager.get.tournamentData(tournamentId);
	}

	async getCurrentStage(tournamentId: number) {
		const stage = await this.manager.get.currentStage(tournamentId);

		if (!stage) throw new NotFound(`Unable to find a stage for tournament with id ${tournamentId}`);

		return stage;
	}

	async initTechnicalBracket(
		tournamentId: number,
		name: string,
		type: StageType,
		size: number,
		matchFormat: MatchFormat,
		customFormatChildCount?: number | null,
		seeding?: IdSeeding,
		seedOrdering: string = "inner_outer"
	) {
		// `league` n'est pas un StageType brackets-manager (calendrier + classement maison).
		if (type === StageType.league) {
			throw new Conflict(
				"Le format championnat (league) n'utilise pas de bracket technique — il est géré par l'API unifiée."
			);
		}
		// Cast : StageType Achillea ⊇ brackets-model ; league exclu ci-dessus.
		const bracketType = type as "round_robin" | "single_elimination" | "double_elimination";
		return await this.manager.create.stage({
			tournamentId,
			name,
			type: bracketType,
			seeding,
			// round-robin (brackets-manager) exige `groupCount` (1 groupe = tout le monde
			// s'affronte) ; les formats à élimination utilisent l'ordonnancement de seed.
			settings:
				bracketType === "round_robin"
					? { size, groupCount: 1 }
					: {
							size,
							seedOrdering: [seedOrdering as "inner_outer"],
							consolationFinal: false,
						},
		});
	}

	async syncParticipantsToBracket(tournamentId: number) {
		// Seuls les inscrits ACTIFS entrent dans le bracket : ni la liste d'attente
		// (pas de place) ni les disqualifiés (place rendue) ne doivent occuper un slot.
		const participants = await this.db.em.find(
			TournamentParticipant,
			{ tournament: tournamentId, status: ParticipantStatus.ACTIVE },
			{ populate: ["user"], refresh: true }
		);

		for (const p of participants) {
			if (!p.bracketParticipantId)
				p.bracketParticipantId = (await this.manager.storage.insert("participant", {
					tournament_id: tournamentId,
					name: p.user.displayName,
				})) as number;
		}

		await this.db.em.flush();

		return participants;
	}

	private async resetStage(stageId: Id, tournamentId: number, seeding?: IdSeeding) {
		const tournament = await this.db.em.findOneOrFail(Tournament, {
			id: tournamentId,
			internalState: { $in: [TournamentState.PREPARING, TournamentState.PREREGISTERING] },
		});

		await this.manager.delete.stage(stageId);

		return await this.initTechnicalBracket(
			tournamentId,
			tournament.name,
			tournament.tournamentType,
			tournament.participantsNumber,
			tournament.matchFormat,
			tournament.customFormatChildCount,
			seeding,
			tournament.seedOrdering ?? "inner_outer"
		);
	}

	async makeSeeding(tournamentId: number, size: number) {
		const stage = await this.manager.get.currentStage(tournamentId);

		if (!stage)
			throw new NotFound(`Unable to find a stage to seed for tournament with id: ${tournamentId}`);

		await this.syncParticipantsToBracket(tournamentId);

		// Ordre d'inscription (id) pour le remplissage des slots non seedés — pas orderBy seed,
		// car le placement doit se faire par numéro de seed (seed N → index N-1).
		const participants = await this.db.em.find(
			TournamentParticipant,
			{ tournament: tournamentId, status: ParticipantStatus.ACTIVE },
			{ refresh: true, orderBy: { id: "ASC" } }
		);

		const seedingPayload = buildSeedingPayload(size, participants);

		const newStage = await this.resetStage(stage.id, tournamentId, seedingPayload);

		await this.manager.update.confirmSeeding(newStage.id);
	}

	private getChildCount(format: MatchFormat, customValue?: number | null): number {
		switch (format) {
			case MatchFormat.BO1:
				return 1;

			case MatchFormat.BO3:
				return 3;

			case MatchFormat.BO5:
				return 5;

			case MatchFormat.DOUBLE_LEG:
				return 2;

			case MatchFormat.CUSTOM:
				return customValue || 1;

			default:
				return 1;
		}
	}

	async generateLobbies(
		tournamentId: number,
		stageId: number,
		matchFormat: MatchFormat,
		customFormatChildCount?: number | null
	) {
		// 1. Fetch matches from manager (contains child_count, opponent1, opponent2)
		const matches: Match[] | null =
			(await this.manager.storage.select("match", { stage_id: stageId })) ?? [];

		// 2. Pre-fetch participants for mapping
		const participants = await this.db.em.find(
			TournamentParticipant,
			{ tournament: tournamentId },
			{ populate: ["user"] }
		);
		const participantsMap = new Map<number, TournamentParticipant>();
		participants.forEach((p) => {
			if (p.bracketParticipantId) participantsMap.set(p.bracketParticipantId, p);
		});

		for (const match of matches) {
			// Find existing lobby or create new one
			let lobby: Lobby | null = await this.db.em.findOne(
				Lobby,
				{ bracketMatchId: Number(match.id) },
				{ populate: ["lobbyMatches"] }
			);

			if (!lobby) {
				// Pas de Lobby tant que les deux camps ne sont pas déterminés : bye (opponent null)
				// ou tour futur TBD (opponent.id null). Un Lobby de bye/TBD resterait FRESH à vie
				// et empêcherait checkAndSetTournamentFinished de marquer le tournoi FINISHED.
				// (Un Lobby déjà créé — donc avec deux opposants présents — continue d'être syncé.)
				if (!match.opponent1?.id || !match.opponent2?.id) continue;

				lobby = new Lobby();
				lobby.bracketMatchId = Number(match.id);
				lobby.eventType = EventTypeEnum.TOURNAMENT;
				lobby.event = rel(Event, tournamentId);
				lobby.state = LobbyState.FRESH;
				lobby.matchFormat = matchFormat;
				lobby.customFormatChildCount = customFormatChildCount;

				const gamesCount = this.getChildCount(matchFormat, customFormatChildCount);

				for (let i = 1; i <= gamesCount; i++) {
					const game = new LobbyMatch();
					game.lobby = lobby;
					game.gameNumber = i;

					this.db.em.persist(game);
				}
				// -----------------------------------

				this.db.em.persist(lobby);
			}

			// 3. Sync Players (Handles TBD -> Player updates)
			await this.syncLobbyUser(lobby, match.opponent1, TeamSide.TEAM_1, participantsMap);
			await this.syncLobbyUser(lobby, match.opponent2, TeamSide.TEAM_2, participantsMap);
		}

		await this.db.em.flush();
	}

	private async syncLobbyUser(
		lobby: Lobby,
		opponent: any,
		side: TeamSide,
		participantMap: Map<number, TournamentParticipant>
	) {
		let lobbyUser = await this.db.em.findOne(
			LobbyUser,
			{ lobby, team: side },
			{ populate: ["user"] }
		);

		// CASE 1: The bracket slot is empty (TBD), but we have a user in DB?
		// This happens if an admin resets a match. We must remove the user.
		if (!opponent || !opponent.id) {
			if (lobbyUser) {
				this.db.em.remove(lobbyUser);
			}

			return;
		}

		const tournamentParticipant = participantMap.get(opponent.id);
		if (!tournamentParticipant) return;

		// CASE 2: Create new LobbyUser
		if (!lobbyUser) {
			lobbyUser = this.createLobbyUser(lobby, tournamentParticipant.user, side);
			this.db.em.persist(lobbyUser);
		} else {
			// CASE 3: Update existing (The slot was TBD or occupied by previous seeding)
			if (lobbyUser.user.id !== tournamentParticipant.user.id) {
				lobbyUser.user = tournamentParticipant.user;
				// Reset state because it's a new player in this slot
				lobbyUser.state = LobbyUserState.PENDING;
				lobbyUser.score = 0;
			}
		}
	}

	private createLobbyUser(lobby: Lobby, user: User, team: TeamSide) {
		const lu = new LobbyUser();
		lu.lobby = lobby;
		lu.user = user;
		lu.team = team;
		lu.state = LobbyUserState.PENDING;

		lobby.lobbyUsers.add(lu);

		return lu;
	}

	async checkAndPropagateLobbyResult(lobby: Lobby) {
		if (lobby.state === LobbyState.FINISHED || lobby.state === LobbyState.FORFEITED) return;

		const forfeit = lobby.lobbyUsers.getItems().filter((lu) => lu.forfeit);

		if (forfeit.length > 0) {
			let seriesWinner: TeamSide | null = null;
			let scoreT1 = 0;
			let scoreT2 = 0;

			const t1Forfeit = forfeit.some((u) => u.team === TeamSide.TEAM_1);
			const t2Forfeit = forfeit.some((u) => u.team === TeamSide.TEAM_2);

			if (t1Forfeit && !t2Forfeit) {
				seriesWinner = TeamSide.TEAM_2;
				scoreT2 = 1;
			} else if (t2Forfeit && !t1Forfeit) {
				seriesWinner = TeamSide.TEAM_1;
				scoreT1 = 1;
			} else if (t1Forfeit && t2Forfeit) {
				// Cas extrême au cas où
				throw new Conflict("Double forfait impossible, veuillez contacter un admin !");
			}

			if (seriesWinner) {
				lobby.state = LobbyState.FORFEITED;
				await this.propagateToManager(lobby, scoreT1, scoreT2, seriesWinner, true);
				await this.db.em.flush();

				return;
			}
		}

		// Re-fetch matches to be sure we have the latest state
		const matches = await this.db.em.find(
			LobbyMatch,
			{ lobby },
			{ orderBy: { gameNumber: "ASC" }, refresh: true }
		);

		const outcome = computeSeriesOutcome(lobby.matchFormat, matches);

		if (outcome.status === "pending") return;

		if (outcome.status === "tie") {
			// Égalité au cumul des deux manches (DOUBLE_LEG) : aucun départage automatique.
			// Sans ça le lobby ne serait jamais FINISHED et le tournoi se bloquerait. On passe
			// en litige pour résolution manuelle par un organisateur.
			lobby.state = LobbyState.CONTESTED;
			await this.db.em.flush();

			return;
		}

		lobby.state = LobbyState.FINISHED;

		await this.propagateToManager(lobby, outcome.scoreT1, outcome.scoreT2, outcome.winner, false);

		// Optional: Cancel/Delete remaining unplayed games?
		// Usually we just leave them as unplayed.

		await this.db.em.flush();
	}

	private async propagateToManager(
		lobby: Lobby,
		scoreT1: number,
		scoreT2: number,
		winningSide: TeamSide,
		isForfeit: boolean
	) {
		// Propager scores / forfaits sur les LobbyUser (source de vérité profil + Elo ranked).
		// Sans ça les stats tournoi restent à 0 et l'Elo rétroactif n'a rien à lire.
		if (!lobby.lobbyUsers.isInitialized()) {
			await this.db.em.populate(lobby, ["lobbyUsers"]);
		}
		for (const lu of lobby.lobbyUsers.getItems()) {
			lu.score = lu.team === TeamSide.TEAM_1 ? scoreT1 : scoreT2;
			lu.forfeit = isForfeit && lu.team !== winningSide;
			lu.state = LobbyUserState.FINISHED;
		}

		if (lobby.bracketMatchId != null) {
			if (isForfeit) {
				await this.manager.update.match({
					id: Number(lobby.bracketMatchId),
					opponent1: winningSide === TeamSide.TEAM_2 ? { forfeit: true } : { score: scoreT1 },
					opponent2: winningSide === TeamSide.TEAM_1 ? { forfeit: true } : { score: scoreT2 },
				});
			} else {
				await this.manager.update.match({
					id: Number(lobby.bracketMatchId),
					opponent1:
						winningSide === TeamSide.TEAM_1
							? { score: scoreT1, result: "win" }
							: { score: scoreT1 },
					opponent2:
						winningSide === TeamSide.TEAM_2
							? { score: scoreT2, result: "win" }
							: { score: scoreT2 },
				});
			}
		}

		await this.db.em.flush();

		// Match tournoi = match ranked (barème AP progressif). Erreur non bloquante pour le bracket.
		try {
			const result = await this.eloService.applyTournamentLobbyResult(lobby.id, this.db.em);
			if (result.applied) {
				console.info(`[BracketService] Elo ranked appliqué lobby#${lobby.id}`, result.deltas);
			}
		} catch (e) {
			console.warn(
				`[BracketService] Échec application Elo tournoi lobby#${lobby.id}:`,
				(e as Error)?.message
			);
		}

		const tournament = await this.db.em.findOneOrFail(Tournament, { id: lobby.event.id });

		if (lobby.bracketMatchId != null) {
			const currentStage = await this.manager.get.currentStage(lobby.event.id);
			if (currentStage) {
				await this.generateLobbies(
					lobby.event.id,
					Number(currentStage.id),
					tournament.matchFormat,
					tournament.customFormatChildCount
				);
			}
		}

		await this.checkAndSetTournamentFinished(tournament.id);
	}

	private async checkAndSetTournamentFinished(tournamentId: number) {
		const activeLobbiesCount = await this.db.em.count(Lobby, {
			event: tournamentId,
			state: { $nin: [LobbyState.FINISHED, LobbyState.FORFEITED, LobbyState.CANCELED] },
		});

		if (activeLobbiesCount > 0) return;

		const isBracketTournamentOngoing = await this.manager.get.currentStage(tournamentId);

		if (!isBracketTournamentOngoing) {
			const tournament = await this.db.em.findOneOrFail(
				Tournament,
				{ id: tournamentId },
				{ refresh: true }
			);
			if (tournament.internalState === TournamentState.ONGOING) {
				tournament.internalState = TournamentState.FINISHED;

				await this.db.em.flush();

			}
		}
	}

	/**
	 * Résout le classement final (dense rank brackets-manager : 1, 2, 3, 3, 4, 4, 4, 4, ...
	 * — même rang pour tout un palier d'éliminés) et le mappe aux `userId` locaux.
	 * Formats élimination uniquement (single / double). `null` si le classement n'est
	 * pas résoluble (pas de stage, format non éligible, standings vides...).
	 *
	 * Partagé par {@link applyPlacementPrizes} (bonus AP) et le classement circuit
	 * (the unified API circuit projection).
	 */
	async resolveFinalStandings(
		tournament: Tournament
	): Promise<{ userId: string; rank: number; bracketParticipantId: number }[] | null> {
		const type = tournament.tournamentType;
		if (type !== StageType.single_elimination && type !== StageType.double_elimination) return null;

		const stages =
			(await this.manager.storage.select("stage", { tournament_id: tournament.id })) ?? [];
		if (stages.length === 0) return null;

		// Dernière stage = phase finale (après groupes éventuels).
		const stage = stages[stages.length - 1];
		if (stage.type === "round_robin") return null;

		let standings: Array<{ id: number | string; rank: number }>;
		try {
			standings = await this.manager.get.finalStandings(stage.id);
		} catch {
			return null;
		}
		if (!standings?.length) return null;

		const participants = await this.db.em.find(
			TournamentParticipant,
			{ tournament: tournament.id },
			{ populate: ["user"] }
		);
		const userByBracketId = new Map<number, string>();
		for (const p of participants) {
			if (p.bracketParticipantId != null) {
				userByBracketId.set(Number(p.bracketParticipantId), p.user.id);
			}
		}

		return standings
			.map((s) => {
				const userId = userByBracketId.get(Number(s.id));
				if (!userId) return null;
				return { userId, rank: s.rank, bracketParticipantId: Number(s.id) };
			})
			.filter(
				(p): p is { userId: string; rank: number; bracketParticipantId: number } => p != null
			);
	}

	/**
	 * Stats matchs de la dernière stage d'un tournoi (matchs joués, buts, écarts,
	 * plus gros écart). `null` si pas de stage ou aucun match résolu. Fonctionne aussi
	 * en cours de tournoi (matchs déjà joués), pas besoin d'attendre la fin.
	 */
	async getMatchStats(tournament: Tournament): Promise<TournamentMatchStats | null> {
		// Match statistics are a public projection owned by the unified API. Keep
		// bracket-manager reads confined to lifecycle/lobby orchestration above.
		try {
			const response = await fetch(
				`${urlsConfig.unifiedApi.replace(/\/+$/u, "")}/v1/achillea/tournaments/${encodeURIComponent(String(tournament.id))}/summary`,
				{ headers: { accept: "application/json" } }
			);
			if (!response.ok) return null;
			const payload = (await response.json()) as {
				stats?: TournamentMatchStats | null;
			};
			return payload.stats ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Matchs joués (score renseigné des deux côtés) de la dernière stage d'un tournoi,
	 * en `bracketParticipantId` bruts (pas encore mappés à un `userId`) + `isFinal`
	 * (dernier round). Base pour les stats joueurs (buts, séries...) du hub stats
	 * circuit — `null` si pas de stage. `TournamentsService` fait le mapping vers
	 * les comptes via `tournament_participant`.
	 */
	async getRawMatches(tournament: Tournament): Promise<RawTournamentMatch[] | null> {
		const stages =
			(await this.manager.storage.select("stage", { tournament_id: tournament.id })) ?? [];
		if (stages.length === 0) return null;

		const stage = stages[stages.length - 1];
		const rounds: Array<{ id: Id; number: number }> =
			(await this.manager.storage.select("round", { stage_id: stage.id })) ?? [];
		const roundNumberById = new Map(rounds.map((r) => [r.id, r.number]));
		const maxRound = rounds.reduce((max, r) => Math.max(max, r.number), 0);

		const matches: Match[] =
			(await this.manager.storage.select("match", { stage_id: stage.id })) ?? [];

		return matches
			.filter(
				(m) =>
					m.opponent1?.score != null &&
					m.opponent2?.score != null &&
					m.opponent1?.id != null &&
					m.opponent2?.id != null
			)
			.map((m) => ({
				opponent1Id: Number(m.opponent1!.id),
				opponent2Id: Number(m.opponent2!.id),
				score1: m.opponent1!.score!,
				score2: m.opponent2!.score!,
				isFinal: roundNumberById.get(m.round_id) === maxRound,
			}));
	}
}

export interface RawTournamentMatch {
	opponent1Id: number;
	opponent2Id: number;
	score1: number;
	score2: number;
	isFinal: boolean;
}

export interface TournamentMatchup {
	winnerDisplayName: string;
	winnerAvatar: string;
	loserDisplayName: string;
	loserAvatar: string;
	scoreWinner: number;
	scoreLoser: number;
}

export interface TournamentMatchStats {
	matches: number;
	totalGoals: number;
	avgGoals: number;
	topScore: number;
	minMargin: number;
	maxMargin: number;
	biggestBlowout: TournamentMatchup | null;
	closestMatch: TournamentMatchup | null;
}
