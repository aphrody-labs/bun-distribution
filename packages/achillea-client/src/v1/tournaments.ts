/**
 * `/tournaments` — cycle de vie complet d'un tournoi, circuit et hub de stats.
 *
 * Les entités transportées par ces routes viennent de MikroORM : une relation
 * peut arriver peuplée ou réduite à son identifiant. Les schémas s'appuient
 * donc sur les types d'attente `WireTournament` / `WireParticipant`, construits
 * par `Omit<…>` sur les DTO du contrat (cf. `pending-contracts.ts`).
 */

import { z } from "zod";

import type { SeedOrdering } from "@rosegriffon/achillea-types/domain/brackets";
import type { Paginated } from "@rosegriffon/achillea-types/domain/common";
import type {
	GameScoreDTO,
	GameValidatorDTO,
	LobbyDTO,
	LobbyMatchDTO,
	LobbyUserDataDTO,
	LobbyUserDTO,
} from "@rosegriffon/achillea-types/domain/lobby";
import type { TournamentListItem } from "@rosegriffon/achillea-types/domain/tournament";
import type {
	CircuitClanEntry,
	CircuitClanTag,
	CircuitLeaderboardEntry,
	CircuitPodiumEntry,
	CircuitRanking,
	CircuitTournamentSummary,
	NewTournamentDTO,
	PlayerCircuitProfile,
	PlayerTournamentHistoryEntry,
	StatsHub,
	StatsHubClanEntry,
	StatsHubPlayerEntry,
	StatsHubRecord,
	StatsHubTournamentHistoryEntry,
	TournamentEventActor,
	TournamentEventDTO,
	TournamentMatchStats,
	TournamentMatchup,
	TournamentSummary,
	TournamentTop10Entry,
} from "@rosegriffon/achillea-types/domain/tournament";
import {
	EventTypeEnum,
	LobbyState,
	LobbyUserState,
	MatchFormat,
	ParticipantStatus,
	ScoreReportPolicy,
	StageType,
	TeamSide,
	TournamentEventType,
	TournamentState,
} from "@rosegriffon/achillea-types/enums/eventEnums";

import {
	apiDateSchema,
	matchModeSchema,
	paginatedSchema,
	successResponseSchema,
	userDtoSchema,
} from "./common";
import {
	AchilleaResource,
	encodePathSegment,
	type AchilleaClientResult,
} from "./http";
import { organizationDtoSchema } from "./organizations";
import type {
	CancelTournamentResult,
	CloseTournamentResult,
	DisqualifyResult,
	OpenRegistrationsResult,
	ParticipantMutationResult,
	PlacementPrizesResult,
	RestoreTournamentResult,
	ScorePolicyResult,
	SeedBatchResult,
	SeedingResult,
	SuccessResponse,
	TournamentDetail,
	WireParticipant,
	WireTournament,
	WireTournamentSeries,
} from "./pending-contracts";

// ── Enums ───────────────────────────────────────────────────────────────────

export const eventTypeSchema = z.enum(EventTypeEnum) satisfies z.ZodType<EventTypeEnum>;
export const tournamentStateSchema = z.enum(TournamentState) satisfies z.ZodType<TournamentState>;
export const participantStatusSchema = z.enum(
	ParticipantStatus
) satisfies z.ZodType<ParticipantStatus>;
export const scoreReportPolicySchema = z.enum(
	ScoreReportPolicy
) satisfies z.ZodType<ScoreReportPolicy>;
export const stageTypeSchema = z.enum(StageType) satisfies z.ZodType<StageType>;
export const matchFormatSchema = z.enum(MatchFormat) satisfies z.ZodType<MatchFormat>;
export const tournamentEventTypeSchema = z.enum(
	TournamentEventType
) satisfies z.ZodType<TournamentEventType>;
export const lobbyStateSchema = z.enum(LobbyState) satisfies z.ZodType<LobbyState>;
export const lobbyUserStateSchema = z.enum(LobbyUserState) satisfies z.ZodType<LobbyUserState>;
export const teamSideSchema = z.enum(TeamSide) satisfies z.ZodType<TeamSide>;

/** `SeedOrdering` est une union de chaînes recopiée de `brackets-model`. */
export const seedOrderingSchema = z.enum([
	"natural",
	"reverse",
	"half_shift",
	"reverse_half_shift",
	"pair_flip",
	"inner_outer",
	"groups.effort_balanced",
	"groups.seed_optimized",
	"groups.bracket_optimized",
]) satisfies z.ZodType<SeedOrdering>;

// ── Entités ─────────────────────────────────────────────────────────────────

/** Relation MikroORM : objet peuplé ou simple identifiant. */
function entityRef<T>(schema: z.ZodType<T>): z.ZodType<number | T> {
	return z.union([z.number(), schema]);
}

export const tournamentSeriesSchema: z.ZodType<WireTournamentSeries> = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string(),
	logo: z.string(),
	organization: entityRef(organizationDtoSchema),
	tournaments: z.array(z.lazy(() => entityRef(tournamentSchema))).optional(),
});

export const tournamentListItemSchema: z.ZodType<TournamentListItem> = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string(),
	type: z.string(),
	status: z.string().nullable(),
	createdAt: apiDateSchema,
	updatedAt: apiDateSchema,
});

export const tournamentSchema: z.ZodType<WireTournament> = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string(),
	type: eventTypeSchema,
	createdAt: apiDateSchema,
	updatedAt: apiDateSchema,
	internalState: tournamentStateSchema,
	startsAt: apiDateSchema,
	grandFinalAt: apiDateSchema,
	series: z
		.lazy(() => entityRef(tournamentSeriesSchema))
		.nullable()
		.optional(),
	organization: entityRef(organizationDtoSchema),
	managers: z.array(entityRef(userDtoSchema)).optional(),
	participants: z.array(z.lazy(() => entityRef(participantSchema))).optional(),
	tournamentType: stageTypeSchema,
	// `null` tant que le format n'est pas figé : un tournoi en préparation n'a
	// pas encore de nombre de participants.
	participantsNumber: z.number().nullish(),
	seedOrdering: seedOrderingSchema.nullish(),
	matchFormat: matchFormatSchema.nullish(),
	customFormatChildCount: z.number().nullable().optional(),
	groupStageEnabled: z.boolean(),
	groupStageType: stageTypeSchema.nullable().optional(),
	logo: z.string(),
	// L'affiche est `null` tant que l'organisateur n'en a pas posé une : la
	// rendre obligatoire faisait tomber le tournoi entier faute d'image.
	affiche: z.string().nullish(),
	planning: z.string(),
	ruleset: z.string(),
	placementEloApplied: z.boolean().optional(),
	registrationOpensAt: z.string().nullable().optional(),
	registrationClosesAt: z.string().nullable().optional(),
	autoStart: z.boolean().optional(),
	discordRoleEnabled: z.boolean().optional(),
	scoreReportPolicy: scoreReportPolicySchema.optional(),
	discordRoleId: z.string().nullable().optional(),
	cancelReason: z.string().nullable().optional(),
	canceledAt: z.string().nullable().optional(),
	closedAt: z.string().nullable().optional(),
});

export const participantSchema: z.ZodType<WireParticipant> = z.object({
	id: z.number(),
	tournament: z.lazy(() => entityRef(tournamentSchema)),
	user: userDtoSchema,
	bracketParticipantId: z.number().nullable().optional(),
	seed: z.number().nullable().optional(),
	hasCheckedIn: z.boolean(),
	status: participantStatusSchema.optional(),
	registeredAt: z.string().optional(),
	waitlistPosition: z.number().nullable().optional(),
	statusReason: z.string().nullable().optional(),
});

/** `GET /tournaments/:id` renvoie un triplet, pas un objet. */
export const tournamentDetailSchema = z.tuple([
	tournamentSchema,
	z.array(participantSchema),
	z.unknown(),
]) satisfies z.ZodType<TournamentDetail>;

export const tournamentEventActorSchema = z.object({
	id: z.string(),
	username: z.string(),
	displayName: z.string(),
	avatar: z.string(),
}) satisfies z.ZodType<TournamentEventActor>;

export const tournamentEventDtoSchema = z.object({
	id: z.string(),
	type: tournamentEventTypeSchema,
	createdAt: z.string(),
	actor: tournamentEventActorSchema.nullable(),
	target: tournamentEventActorSchema.nullable(),
	payload: z.record(z.string(), z.unknown()).nullable(),
	reason: z.string().nullable(),
}) satisfies z.ZodType<TournamentEventDTO>;

// ── Lobbies ─────────────────────────────────────────────────────────────────

export const lobbyUserDataSchema = z.object({
	displayName: z.string(),
	id: z.string(),
	avatar: z.string(),
}) satisfies z.ZodType<LobbyUserDataDTO>;

export const lobbyUserSchema = z.object({
	id: z.number(),
	user: lobbyUserDataSchema,
	team: teamSideSchema,
	forfeit: z.boolean(),
	state: lobbyUserStateSchema,
}) satisfies z.ZodType<LobbyUserDTO>;

export const lobbyMatchSchema = z.object({
	id: z.number(),
	gameNumber: z.number(),
	scoreTeam1: z.number(),
	scoreTeam2: z.number(),
	team1Validated: z.boolean(),
	team2Validated: z.boolean(),
	adminValidated: z.boolean(),
}) satisfies z.ZodType<LobbyMatchDTO>;

export const lobbySchema = z.object({
	id: z.number(),
	mode: matchModeSchema,
	state: lobbyStateSchema,
	bracketMatchId: z.number().nullable().optional(),
	lobbyUsers: z.array(lobbyUserSchema),
	lobbyMatches: z.array(lobbyMatchSchema),
	hostUser: lobbyUserSchema.nullable(),
	matchFormat: matchFormatSchema.nullish(),
}) satisfies z.ZodType<LobbyDTO>;

// ── Circuit et hub statistiques ─────────────────────────────────────────────

export const circuitClanTagSchema = z.object({
	id: z.number(),
	name: z.string(),
	shortName: z.string(),
	avatar: z.string(),
}) satisfies z.ZodType<CircuitClanTag>;

export const circuitLeaderboardEntrySchema = z.object({
	userId: z.string(),
	displayName: z.string(),
	username: z.string(),
	avatar: z.string(),
	clan: circuitClanTagSchema.nullable(),
	tournamentsPlayed: z.number(),
	points: z.number(),
	tournaments: z.number(),
	wins: z.number(),
	podiums: z.number(),
	top4: z.number(),
	top8: z.number(),
	bestRank: z.number(),
	bestRankLabel: z.string(),
	tier: z.string(),
}) satisfies z.ZodType<CircuitLeaderboardEntry>;

export const circuitClanEntrySchema = z.object({
	id: z.number(),
	name: z.string(),
	shortName: z.string(),
	avatar: z.string(),
	points: z.number(),
	players: z.number(),
	tournamentsPlayed: z.number(),
	wins: z.number(),
	podiums: z.number(),
	tier: z.string(),
}) satisfies z.ZodType<CircuitClanEntry>;

export const circuitPodiumEntrySchema = z.object({
	rank: z.number(),
	rankLabel: z.string(),
	userId: z.string(),
	displayName: z.string(),
	avatar: z.string(),
}) satisfies z.ZodType<CircuitPodiumEntry>;

export const circuitTournamentSummarySchema = z.object({
	id: z.number(),
	name: z.string(),
	size: z.number(),
	grandFinalAt: z.string(),
	podium: z.array(circuitPodiumEntrySchema),
	standingsStatus: z.enum(["resolved", "unresolved"]),
}) satisfies z.ZodType<CircuitTournamentSummary>;

export const circuitRankingSchema = z.object({
	leaderboard: z.array(circuitLeaderboardEntrySchema),
	tournaments: z.array(circuitTournamentSummarySchema),
	clanRanking: z.array(circuitClanEntrySchema),
}) satisfies z.ZodType<CircuitRanking>;

export const tournamentTop10EntrySchema = z.object({
	rank: z.number(),
	rankLabel: z.string(),
	userId: z.string(),
	displayName: z.string(),
	avatar: z.string(),
	clan: circuitClanTagSchema.nullable(),
	points: z.number(),
	tier: z.string(),
	goalsScored: z.number(),
	goalsConceded: z.number(),
	goalAverage: z.number(),
}) satisfies z.ZodType<TournamentTop10Entry>;

export const tournamentMatchupSchema = z.object({
	winnerDisplayName: z.string(),
	winnerAvatar: z.string(),
	loserDisplayName: z.string(),
	loserAvatar: z.string(),
	scoreWinner: z.number(),
	scoreLoser: z.number(),
}) satisfies z.ZodType<TournamentMatchup>;

export const tournamentMatchStatsSchema = z.object({
	matches: z.number(),
	totalGoals: z.number(),
	avgGoals: z.number(),
	topScore: z.number(),
	minMargin: z.number(),
	maxMargin: z.number(),
	biggestBlowout: tournamentMatchupSchema.nullable(),
	closestMatch: tournamentMatchupSchema.nullable(),
}) satisfies z.ZodType<TournamentMatchStats>;

export const tournamentSummarySchema = z.object({
	top10: z.array(tournamentTop10EntrySchema),
	stats: tournamentMatchStatsSchema.nullable(),
}) satisfies z.ZodType<TournamentSummary>;

export const statsHubPlayerEntrySchema = circuitLeaderboardEntrySchema.extend({
	matchesPlayed: z.number(),
	matchWins: z.number(),
	matchLosses: z.number(),
	goalsScored: z.number(),
	goalsConceded: z.number(),
	goalDiff: z.number(),
	goalAverage: z.number(),
	bestStreak: z.number(),
}) satisfies z.ZodType<StatsHubPlayerEntry>;

export const statsHubClanEntrySchema = circuitClanEntrySchema.extend({
	goalsScored: z.number(),
	goalsConceded: z.number(),
	goalAverage: z.number(),
}) satisfies z.ZodType<StatsHubClanEntry>;

export const statsHubRecordSchema = z.object({
	value: z.number(),
	tournamentId: z.number(),
	tournamentName: z.string(),
	detail: z.string(),
}) satisfies z.ZodType<StatsHubRecord>;

export const statsHubTournamentHistoryEntrySchema = z.object({
	id: z.number(),
	name: z.string(),
	grandFinalAt: z.string(),
	size: z.number(),
	matches: z.number(),
	goals: z.number(),
	champion: z.string().nullable(),
	runnerUp: z.string().nullable(),
}) satisfies z.ZodType<StatsHubTournamentHistoryEntry>;

export const statsHubSchema = z.object({
	overview: z.object({
		totalTournaments: z.number(),
		totalMatches: z.number(),
		totalGoals: z.number(),
		avgGoalsPerMatch: z.number(),
		totalPlayers: z.number(),
		totalClans: z.number(),
	}),
	records: z.object({
		topScorer: statsHubPlayerEntrySchema.nullable(),
		mostTitles: statsHubPlayerEntrySchema.nullable(),
		mostTournaments: statsHubPlayerEntrySchema.nullable(),
		bestStreakPlayer: statsHubPlayerEntrySchema.nullable(),
		biggestTournament: z
			.object({ id: z.number(), name: z.string(), size: z.number() })
			.nullable(),
		highestScoringMatch: statsHubRecordSchema.nullable(),
		closestFinal: statsHubRecordSchema.nullable(),
		biggestBlowoutFinal: statsHubRecordSchema.nullable(),
	}),
	players: z.array(statsHubPlayerEntrySchema),
	clans: z.array(statsHubClanEntrySchema),
	tournamentHistory: z.array(statsHubTournamentHistoryEntrySchema),
	tournaments: z.array(circuitTournamentSummarySchema),
}) satisfies z.ZodType<StatsHub>;

export const playerTournamentHistoryEntrySchema = z.object({
	tournamentId: z.number(),
	tournamentName: z.string(),
	grandFinalAt: z.string(),
	size: z.number(),
	rank: z.number().nullable(),
	rankLabel: z.string(),
	points: z.number(),
	tier: z.string(),
	goalsScored: z.number(),
	goalsConceded: z.number(),
}) satisfies z.ZodType<PlayerTournamentHistoryEntry>;

export const playerCircuitProfileSchema = z.object({
	tournamentsPlayed: z.number(),
	points: z.number(),
	tier: z.string(),
	wins: z.number(),
	podiums: z.number(),
	top4: z.number(),
	top8: z.number(),
	bestRankLabel: z.string(),
	goalsScored: z.number(),
	goalsConceded: z.number(),
	goalAverage: z.number(),
	bestStreak: z.number(),
	history: z.array(playerTournamentHistoryEntrySchema),
}) satisfies z.ZodType<PlayerCircuitProfile>;

// ── Résultats de mutation ───────────────────────────────────────────────────

export const openRegistrationsResultSchema = z.object({
	success: z.boolean(),
	id: z.number(),
	internalState: tournamentStateSchema,
}) satisfies z.ZodType<OpenRegistrationsResult>;

export const scorePolicyResultSchema = z.object({
	success: z.boolean(),
	scoreReportPolicy: scoreReportPolicySchema,
	error: z.string().optional(),
}) satisfies z.ZodType<ScorePolicyResult>;

export const disqualifyResultSchema = z.object({
	success: z.boolean(),
	forfeitedLobbies: z.number().optional(),
	promoted: z.string().nullable().optional(),
	error: z.string().optional(),
}) satisfies z.ZodType<DisqualifyResult>;

export const participantMutationResultSchema = z.object({
	success: z.boolean(),
	participant: participantSchema.optional(),
	error: z.string().optional(),
}) satisfies z.ZodType<ParticipantMutationResult>;

export const closeTournamentResultSchema = z.object({
	success: z.boolean(),
	openLobbies: z.number().optional(),
	error: z.string().optional(),
}) satisfies z.ZodType<CloseTournamentResult>;

export const cancelTournamentResultSchema = z.object({
	success: z.boolean(),
	notified: z.number().optional(),
	error: z.string().optional(),
}) satisfies z.ZodType<CancelTournamentResult>;

export const restoreTournamentResultSchema = z.object({
	success: z.boolean(),
	internalState: tournamentStateSchema.optional(),
	error: z.string().optional(),
}) satisfies z.ZodType<RestoreTournamentResult>;

export const placementPrizesResultSchema = z.object({
	success: z.boolean(),
	applied: z.boolean().optional(),
	reason: z.string().optional(),
	deltas: z.record(z.string(), z.number()).optional(),
	tournamentSize: z.number().optional(),
	error: z.string().optional(),
}) satisfies z.ZodType<PlacementPrizesResult>;

export const seedingResultSchema = z.object({
	participantId: z.number(),
	seed: z.number().nullable(),
	previousSeed: z.number().nullable(),
	swappedWith: z.string().nullable(),
	bracketUpdated: z.boolean(),
}) satisfies z.ZodType<SeedingResult>;

export const seedBatchResultSchema = z.object({
	mode: z.string(),
	bracketUpdated: z.boolean(),
	assignments: z.array(z.unknown()).optional(),
	cleared: z.number().optional(),
}) satisfies z.ZodType<SeedBatchResult>;

export type TournamentListQuery = {
	page?: number;
	/** Taille de page du contrôleur RG actuel (1 à 50). */
	pageSize?: number;
	/** Alias de taille de page accepté par le contrôleur (1 à 50). */
	pagination?: number;
	organization?: number;
	/** Répété une fois par état (`states=Ongoing&states=Finished`). */
	states?: TournamentState[];
}

/** 35 routes. */
export class TournamentsResource extends AchilleaResource {
	/** `GET /tournaments` — liste paginée, filtrable par organisation et par état. */
	list(
		query: TournamentListQuery = {}
	): Promise<AchilleaClientResult<Paginated<TournamentListItem>>> {
		return this.http.get("/tournaments", paginatedSchema(tournamentListItemSchema), {
			query,
		});
	}

	/** `GET /tournaments/:id` — triplet `[tournoi, participants, données de bracket]`. */
	get(id: number): Promise<AchilleaClientResult<TournamentDetail>> {
		return this.http.get(`/tournaments/${encodePathSegment(id)}`, tournamentDetailSchema);
	}

	/** `GET /tournaments/:id/summary` — top 10 et statistiques de matchs. */
	summary(id: number): Promise<AchilleaClientResult<TournamentSummary>> {
		return this.http.get(`/tournaments/${encodePathSegment(id)}/summary`, tournamentSummarySchema);
	}

	/** `GET /tournaments/:id/events` — journal métier du tournoi. */
	events(id: number): Promise<AchilleaClientResult<TournamentEventDTO[]>> {
		return this.http.get(
			`/tournaments/${encodePathSegment(id)}/events`,
			z.array(tournamentEventDtoSchema)
		);
	}

	/** `GET /tournaments/circuit/ranking` — classement circuit joueurs et clans. */
	circuitRanking(): Promise<AchilleaClientResult<CircuitRanking>> {
		return this.http.get("/tournaments/circuit/ranking", circuitRankingSchema);
	}

	/** `GET /tournaments/circuit/stats` — hub statistiques all-time. */
	circuitStats(): Promise<AchilleaClientResult<StatsHub>> {
		return this.http.get("/tournaments/circuit/stats", statsHubSchema);
	}

	/** `GET /tournaments/circuit/players/:userId` — profil circuit d'un joueur. */
	circuitPlayer(userId: string): Promise<AchilleaClientResult<PlayerCircuitProfile>> {
		return this.http.get(
			`/tournaments/circuit/players/${encodePathSegment(userId)}`,
			playerCircuitProfileSchema
		);
	}

	/** `POST /tournaments/create/achillea` — création par une organisation. */
	create(payload: NewTournamentDTO): Promise<AchilleaClientResult<WireTournament>> {
		return this.http.post("/tournaments/create/achillea", tournamentSchema, payload);
	}

	/** `PUT /tournaments/:id/edit` — mise à jour complète (organisateurs). */
	update(
		id: number,
		payload: NewTournamentDTO
	): Promise<AchilleaClientResult<WireTournament>> {
		return this.http.put(`/tournaments/${encodePathSegment(id)}/edit`, tournamentSchema, payload);
	}

	/** `POST /tournaments/open-registrations/:id` — ouvre les inscriptions. */
	openRegistrations(id: number): Promise<AchilleaClientResult<OpenRegistrationsResult>> {
		return this.http.post(
			`/tournaments/open-registrations/${encodePathSegment(id)}`,
			openRegistrationsResultSchema
		);
	}

	/** `POST /tournaments/participate/:id` — inscription du compte connecté. */
	participate(id: number): Promise<AchilleaClientResult<WireParticipant>> {
		return this.http.post(
			`/tournaments/participate/${encodePathSegment(id)}`,
			participantSchema
		);
	}

	/** `POST /tournaments/unregister/:id` — désinscription du compte connecté. */
	unregister(id: number): Promise<AchilleaClientResult<unknown>> {
		return this.http.post(`/tournaments/unregister/${encodePathSegment(id)}`, z.unknown());
	}

	/** `POST /tournaments/:id/score-policy` — bascule « qui saisit les scores ». */
	setScorePolicy(
		id: number,
		policy: ScoreReportPolicy
	): Promise<AchilleaClientResult<ScorePolicyResult>> {
		return this.http.post(
			`/tournaments/${encodePathSegment(id)}/score-policy`,
			scorePolicyResultSchema,
			{ policy }
		);
	}

	/** `POST /tournaments/report-score` — saisie du score d'une manche. */
	reportScore(score: GameScoreDTO): Promise<AchilleaClientResult<unknown>> {
		return this.http.post("/tournaments/report-score", z.unknown(), { score });
	}

	/** `POST /tournaments/validate-score` — validation de la manche par un camp. */
	validateScore(gameValidation: GameValidatorDTO): Promise<AchilleaClientResult<unknown>> {
		return this.http.post("/tournaments/validate-score", z.unknown(), { gameValidation });
	}

	/** `POST /tournaments/unvalidate-score` — retire la validation d'un camp. */
	unvalidateScore(gameValidation: GameValidatorDTO): Promise<AchilleaClientResult<unknown>> {
		return this.http.post("/tournaments/unvalidate-score", z.unknown(), { gameValidation });
	}

	/** `POST /tournaments/remove-participant/:id` — retrait d'un inscrit. */
	removeParticipant(
		id: number,
		userId: string,
		reason?: string
	): Promise<AchilleaClientResult<unknown>> {
		return this.http.post(
			`/tournaments/remove-participant/${encodePathSegment(id)}`,
			z.unknown(),
			{ userId, reason }
		);
	}

	/** `POST /tournaments/:id/disqualify` — disqualification (motif obligatoire). */
	disqualifyParticipant(
		id: number,
		userId: string,
		reason: string
	): Promise<AchilleaClientResult<DisqualifyResult>> {
		return this.http.post(
			`/tournaments/${encodePathSegment(id)}/disqualify`,
			disqualifyResultSchema,
			{ userId, reason }
		);
	}

	/** `POST /tournaments/:id/reinstate` — annule une disqualification. */
	reinstateParticipant(
		id: number,
		userId: string
	): Promise<AchilleaClientResult<ParticipantMutationResult>> {
		return this.http.post(
			`/tournaments/${encodePathSegment(id)}/reinstate`,
			participantMutationResultSchema,
			{ userId }
		);
	}

	/** `POST /tournaments/:id/promote-participant` — promotion depuis la liste d'attente. */
	promoteParticipant(
		id: number,
		userId: string
	): Promise<AchilleaClientResult<ParticipantMutationResult>> {
		return this.http.post(
			`/tournaments/${encodePathSegment(id)}/promote-participant`,
			participantMutationResultSchema,
			{ userId }
		);
	}

	/** `POST /tournaments/:id/close` — clôture manuelle (`force` passe outre les matchs ouverts). */
	close(id: number, force = false): Promise<AchilleaClientResult<CloseTournamentResult>> {
		return this.http.post(
			`/tournaments/${encodePathSegment(id)}/close`,
			closeTournamentResultSchema,
			{ force }
		);
	}

	/** `POST /tournaments/:id/cancel` — annulation ; l'entité reste consultable. */
	cancel(id: number, reason: string): Promise<AchilleaClientResult<CancelTournamentResult>> {
		return this.http.post(
			`/tournaments/${encodePathSegment(id)}/cancel`,
			cancelTournamentResultSchema,
			{ reason }
		);
	}

	/** `POST /tournaments/:id/restore` — restaure un tournoi annulé. */
	restore(id: number): Promise<AchilleaClientResult<RestoreTournamentResult>> {
		return this.http.post(
			`/tournaments/${encodePathSegment(id)}/restore`,
			restoreTournamentResultSchema
		);
	}

	/** `POST /tournaments/:id/apply-placement-prizes` — verse le bonus AP podium. */
	applyPlacementPrizes(id: number): Promise<AchilleaClientResult<PlacementPrizesResult>> {
		return this.http.post(
			`/tournaments/${encodePathSegment(id)}/apply-placement-prizes`,
			placementPrizesResultSchema
		);
	}

	/** `POST /tournaments/set-participant-seeding/:id` — place un inscrit à une seed. */
	setParticipantSeeding(
		id: number,
		participant: Pick<WireParticipant, "id" | "seed">
	): Promise<AchilleaClientResult<SeedingResult>> {
		return this.http.post(
			`/tournaments/set-participant-seeding/${encodePathSegment(id)}`,
			seedingResultSchema,
			{ participant }
		);
	}

	/** `POST /tournaments/seed-by-ranked/:id` — seeding 1..N par Elo solo décroissant. */
	seedByRanked(id: number): Promise<AchilleaClientResult<SeedBatchResult>> {
		return this.http.post(
			`/tournaments/seed-by-ranked/${encodePathSegment(id)}`,
			seedBatchResultSchema
		);
	}

	/** `POST /tournaments/seed-random/:id` — mélange aléatoire des seeds. */
	seedRandom(id: number): Promise<AchilleaClientResult<SeedBatchResult>> {
		return this.http.post(
			`/tournaments/seed-random/${encodePathSegment(id)}`,
			seedBatchResultSchema
		);
	}

	/** `POST /tournaments/clear-seeds/:id` — retire toutes les seeds. */
	clearSeeds(id: number): Promise<AchilleaClientResult<SeedBatchResult>> {
		return this.http.post(
			`/tournaments/clear-seeds/${encodePathSegment(id)}`,
			seedBatchResultSchema
		);
	}

	/** `POST /tournaments/generate-bracket/:id` — génère l'arbre du tournoi. */
	generateBracket(id: number): Promise<AchilleaClientResult<SuccessResponse>> {
		return this.http.post(
			`/tournaments/generate-bracket/${encodePathSegment(id)}`,
			successResponseSchema
		);
	}

	/** `POST /tournaments/add-managers/:id` — ajoute des organisateurs. */
	addManagers(
		id: number,
		managers: Array<{ id: string }>
	): Promise<AchilleaClientResult<SuccessResponse>> {
		return this.http.post(
			`/tournaments/add-managers/${encodePathSegment(id)}`,
			successResponseSchema,
			managers
		);
	}

	/** `POST /tournaments/remove-manager/:id` — retire un organisateur. */
	removeManager(
		id: number,
		manager: { id: string }
	): Promise<AchilleaClientResult<SuccessResponse>> {
		return this.http.post(
			`/tournaments/remove-manager/${encodePathSegment(id)}`,
			successResponseSchema,
			manager
		);
	}

	/** `PUT /tournaments/start/:id` — démarre le tournoi. */
	start(id: number): Promise<AchilleaClientResult<SuccessResponse>> {
		return this.http.put(`/tournaments/start/${encodePathSegment(id)}`, successResponseSchema);
	}

	/** `PUT /tournaments/next-phase/:id` — avance à la phase suivante. */
	nextPhase(id: number): Promise<AchilleaClientResult<SuccessResponse>> {
		return this.http.put(
			`/tournaments/next-phase/${encodePathSegment(id)}`,
			successResponseSchema
		);
	}

	/** `GET /tournaments/lobbies/:id` — lobbies du tournoi. */
	lobbies(id: number): Promise<AchilleaClientResult<LobbyDTO[]>> {
		return this.http.get(`/tournaments/lobbies/${encodePathSegment(id)}`, z.array(lobbySchema));
	}

	/** `GET /tournaments/lobby/:id` — détail d'un lobby. */
	lobby(id: number): Promise<AchilleaClientResult<LobbyDTO>> {
		return this.http.get(`/tournaments/lobby/${encodePathSegment(id)}`, lobbySchema);
	}
}
