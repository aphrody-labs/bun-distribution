import {
	canReportTournamentScore,
	checkOpenTournamentsLimit,
	checkPublicationWindow,
	userIsTournamentOrganizer,
} from "@rosegriffon/achillea-core";
import { rel } from "@mikro-orm/core";
import { BadRequest, Conflict, NotFound, NotImplemented, Unauthorized } from "@tsed/exceptions";

import type { NewTournamentDTO } from "@/api/models/dtos";
import { tournamentRulesConfig, urlsConfig } from "@/configs";
import { env } from "@/env";
import { Service } from "@/decorators";
import {
	Clan,
	ClanMember,
	Lobby,
	LobbyMatch,
	Notification,
	Organization,
	OrganizationManager,
	Tournament,
	TournamentParticipant,
	TournamentPhase,
	User,
	UserView,
} from "@/entities";
// Chemin direct, hors baril : `@/entities` est pris dans un cycle
// (services -> utils/functions -> services) et, evalue a mi-parcours, n'a pas
// encore publie `TournamentEvent` — d'ou le « SyntaxError: Export named
// 'TournamentEvent' not found » qui faisait echouer deux fichiers de tests.
import { TournamentEvent } from "@/entities/TournamentEvent";
import {
	EventTypeEnum,
	LobbyState,
	OrganizationState,
	ParticipantStatus,
	PhaseStatus,
	ScoreReportPolicy,
	StageType,
	TeamSide,
	TournamentEventType,
	TournamentState,
	UserRole,
} from "@/utils/enums";
import { NotificationCategory, NotificationType } from "@/utils/enums/notifications";
import { resolveDependency } from "@/utils/functions";

import type { ParticipantDTO } from "../api/models/dtos/participantDTO";
import { logOnSuperAdminChannel } from "../utils/functions/messager";
import { BracketService } from "./BracketService";
import { ChallongeService } from "./ChallongeService";
import { Database } from "./Database";
import { Logger } from "./Logger";
import { NotificationService } from "./NotificationService";
import { SwissStageService } from "./SwissStageService";
import { TournamentEventService } from "./TournamentEventService";
import { TournamentRoleService } from "./TournamentRoleService";
import type { UserDTO } from "./UserService";
import { UserService } from "./UserService";
import {
	isLeagueTournamentType,
	isSupportedTournamentType,
	parseScoreReportPolicy,
} from "./tournament-policies";

export {
	BRACKET_TOURNAMENT_TYPES,
	LEAGUE_TOURNAMENT_TYPES,
	isLeagueTournamentType,
	isSupportedTournamentType,
	parseScoreReportPolicy,
} from "./tournament-policies";

@Service() // À adapter selon ton framework (NestJS: @Injectable())
export class TournamentsService {
	constructor(
		private readonly challongeService: ChallongeService,
		private db: Database,
		private userService: UserService,
		private bracketService: BracketService,
		private swissStageService: SwissStageService,
		private events: TournamentEventService,
		private roles: TournamentRoleService
	) {}

	/**
	 * Règles de création (cadrage) : délai de publication et plafond de tournois
	 * ouverts par organisation. `bypass` réservé aux SuperAdmin (tournoi de test,
	 * rattrapage) — la dérogation est journalisée par l'appelant.
	 */
	private async assertCreationRules(
		organizationId: number,
		startsAt: Date,
		bypass: boolean
	): Promise<{ bypassedRules: string[] }> {
		const violations = [
			checkPublicationWindow(startsAt, new Date(), tournamentRulesConfig.publicationWindow),
			checkOpenTournamentsLimit(
				await this.db.em.count(Tournament, {
					organization: organizationId,
					internalState: {
						$in: [
							TournamentState.PENDING,
							TournamentState.PREREGISTERING,
							TournamentState.PREPARING,
							TournamentState.ONGOING,
						],
					},
				}),
				tournamentRulesConfig.maxOpenTournamentsPerOrganization
			),
		].filter((v) => v !== null);

		if (violations.length === 0) return { bypassedRules: [] };

		if (!bypass) throw new BadRequest(violations.map((v) => v.message).join(" "));

		return { bypassedRules: violations.map((v) => v.rule) };
	}

	async createTournament(
		dto: NewTournamentDTO,
		options: { actorId?: string; bypassRules?: boolean } = {}
	): Promise<Tournament> {
		if (!isSupportedTournamentType(dto.tournamentType))
			throw new NotImplemented(
				`Type de tournoi non supporté : ${dto.tournamentType}. Supportés : élimination simple/double, round-robin, championnat/league (le format suisse a son propre flux).`
			);

		// Ts.ED @Format("date-time") ne convertit pas toujours en Date sous bun/express —
		// MikroORM 7 refuse d'assigner une string ISO à un champ Date (ValidationError).
		const startsAt = dto.startsAt instanceof Date ? dto.startsAt : new Date(dto.startsAt);
		const grandFinalAt =
			dto.grandFinalAt instanceof Date ? dto.grandFinalAt : new Date(dto.grandFinalAt);

		if (Number.isNaN(startsAt.getTime()) || Number.isNaN(grandFinalAt.getTime()))
			throw new BadRequest("Dates de tournoi invalides.");

		if (startsAt <= new Date())
			throw new BadRequest("Un tournoi ne peut pas être planifié dans le passé.");

		if (startsAt >= grandFinalAt)
			throw new BadRequest(
				"La phase finale d'un tournoi ne peut pas précéder le début du tournoi."
			);

		const organizationId =
			typeof dto.organization === "number" ? dto.organization : Number(dto.organization.id);

		const { bypassedRules } = await this.assertCreationRules(
			organizationId,
			startsAt,
			options.bypassRules === true
		);

		const schedule = this.parseScheduleFields(dto, startsAt);

		const created = await this.db.em.transactional(async (em) => {
			try {
				// 1. Création de l'entité
				const tournament = new Tournament();

				// Mapping simple
				tournament.name = dto.name;
				tournament.description = dto.description;
				tournament.series = dto.series ?? null;

				const orgId =
					typeof dto.organization === "number" ? dto.organization : Number(dto.organization.id);
				tournament.organization = em.getReference(Organization, orgId);

				tournament.tournamentType = dto.tournamentType;
				tournament.participantsNumber = dto.participantsNumber;
				tournament.seedOrdering = dto.seedOrdering;
				tournament.matchFormat = dto.matchFormat;
				tournament.customFormatChildCount = dto.customFormatChildCount;
				tournament.groupStageEnabled = dto.groupStageEnabled;
				tournament.groupStageType = dto.groupStageType;
				tournament.logo = dto.logo;
				tournament.affiche = dto.affiche;
				tournament.planning = dto.planning;
				tournament.ruleset = dto.ruleset;

				tournament.startsAt = startsAt;
				tournament.grandFinalAt = grandFinalAt;

				// Planning automatisé — nul = tournoi conduit à la main (comportement d'origine).
				tournament.registrationOpensAt = schedule.registrationOpensAt;
				tournament.registrationClosesAt = schedule.registrationClosesAt;
				tournament.autoStart = schedule.autoStart;
				tournament.discordRoleEnabled = schedule.discordRoleEnabled;
				tournament.scoreReportPolicy = parseScoreReportPolicy(dto.scoreReportPolicy);

				await em.persist(tournament).flush();

				// Lie les TOs sélectionnés au formulaire (sinon dto.managers est ignoré
				// et les organisateurs choisis à la création sont perdus).
				if (dto.managers?.length) {
					const managerIds = dto.managers.map((m) => m.id);
					const managerUsers = await em.find(User, { id: { $in: managerIds } });
					for (const u of managerUsers) tournament.managers.add(u);
					await em.flush();
				}

				// Championnat (league) : pas de bracket technique brackets-manager —
				// Le calendrier et le classement des ligues sont gérés par l'API unifiée.
				if (!isLeagueTournamentType(tournament.tournamentType)) {
					await this.bracketService.initTechnicalBracket(
						tournament.id,
						tournament.name,
						tournament.tournamentType,
						tournament.participantsNumber,
						tournament.matchFormat,
						tournament.customFormatChildCount,
						undefined,
						tournament.seedOrdering ?? "inner_outer"
					);
				}

				return tournament;
			} catch (error) {
				const err = error as Error & {
					code?: string;
					detail?: string;
					constraint?: string;
					cause?: unknown;
				};
				console.error(
					"Erreur création tournoi, rollback implicite (rien n'est sauvé en DB locale): " +
						JSON.stringify(
							{
								name: err?.name,
								message: err?.message,
								code: err?.code,
								detail: err?.detail,
								constraint: err?.constraint,
								cause:
									err?.cause instanceof Error
										? { name: err.cause.name, message: err.cause.message }
										: err?.cause,
								stack: err?.stack?.split("\n").slice(0, 12),
							},
							null,
							2
						)
				);
				// MikroORM ValidationError / contraintes → 400 lisible plutôt qu'un 500 opaque.
				if (err?.name === "ValidationError") {
					throw new BadRequest(err.message || "Données de tournoi invalides.");
				}
				throw error;
			}
		});

		await this.events.log({
			tournamentId: created.id,
			type: TournamentEventType.CREATED,
			actorId: options.actorId ?? null,
			payload: {
				name: created.name,
				type: created.tournamentType,
				size: created.participantsNumber,
				startsAt: created.startsAt,
				// Une dérogation aux règles de publication doit rester lisible après coup.
				bypassedRules: bypassedRules.length ? bypassedRules : undefined,
			},
		});

		return created;
	}

	/**
	 * Dates de planning issues du formulaire.
	 *
	 * Tolère l'absence (tournoi conduit à la main) et les incohérences évidentes :
	 * une fermeture d'inscriptions après le début du tournoi n'automatiserait rien de
	 * sensé, autant l'ignorer que produire un tournoi qui se bloque tout seul.
	 */
	private parseScheduleFields(
		dto: Partial<NewTournamentDTO>,
		startsAt: Date
	): {
		registrationOpensAt: Date | null;
		registrationClosesAt: Date | null;
		autoStart: boolean;
		discordRoleEnabled: boolean;
	} {
		const toDate = (value: unknown): Date | null => {
			if (value == null || value === "") return null;
			const date = value instanceof Date ? value : new Date(value as string);
			return Number.isNaN(date.getTime()) ? null : date;
		};

		const opensAt = toDate((dto as Record<string, unknown>).registrationOpensAt);
		let closesAt = toDate((dto as Record<string, unknown>).registrationClosesAt);

		if (closesAt && closesAt > startsAt) closesAt = null;
		if (opensAt && closesAt && opensAt >= closesAt) closesAt = null;

		return {
			registrationOpensAt: opensAt,
			registrationClosesAt: closesAt,
			autoStart: (dto as Record<string, unknown>).autoStart === true,
			discordRoleEnabled: (dto as Record<string, unknown>).discordRoleEnabled === true,
		};
	}

	async getTournaments(
		page: number,
		pageSize: number,
		organizationId?: number,
		states?: TournamentState[]
	): Promise<[Tournament[], number]> {
		const [tournaments, total] = await this.db.em
			.getRepository(Tournament)
			.getAllTournaments(page, pageSize, organizationId, states);

		return [tournaments, total];
	}

	async toDTO(
		participant: TournamentParticipant,
		waitlistPosition: number | null = null
	): Promise<ParticipantDTO> {
		return {
			id: participant.id,
			tournament: participant.tournament,
			bracketParticipantId: participant.bracketParticipantId,
			seed: participant.seed,
			hasCheckedIn: participant.hasCheckedIn,
			status: participant.status,
			registeredAt: participant.registeredAt,
			waitlistPosition,
			statusReason: participant.statusReason ?? null,
			user: await this.userService.getUserDTO(participant.user.id),
		} as ParticipantDTO;
	}

	async getUserSide(userId: string, lobbyId: number) {
		const lobby = await this.db.em.findOneOrFail(
			Lobby,
			{ id: lobbyId },
			{
				populate: ["lobbyMatches", "lobbyUsers", "event"],
			}
		);

		const isTO = await this.isTournamentOrganizerSafe(userId, lobby.event.id);

		const side = isTO ? "ADMIN" : lobby.getUserSide(userId);

		if (!side) throw new Unauthorized("Vous n'êtes pas autorisé à effectuer cette action");

		if (
			!canReportTournamentScore(await this.scoreReportPolicyForLobby(lobby), {
				isOrganizer: isTO,
				isLobbyPlayer: !isTO,
			})
		)
			throw new Unauthorized("Les scores de ce tournoi sont saisis par les organisateurs.");

		return side;
	}

	/**
	 * Mise à jour complète d'un tournoi (contenu + images + structure si Pending).
	 * - Toujours : name, description, logo, affiche, planning, ruleset
	 * - Si Pending (0 inscrits) : type, taille, format, dates, seedOrdering + rebuild bracket technique
	 * - Si inscriptions ouvertes mais pas encore Ongoing : dates, format de match (sans rebuild)
	 */
	async updateTournament(tournamentId: number, dto: NewTournamentDTO): Promise<Tournament> {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ populate: ["managers"], refresh: true }
		);
		if (!tournament) throw new NotFound("Tournoi introuvable.");

		if (
			tournament.internalState === TournamentState.FINISHED ||
			tournament.internalState === TournamentState.CANCELED
		) {
			throw new BadRequest("Impossible de modifier un tournoi terminé ou annulé.");
		}

		const startsAt = dto.startsAt instanceof Date ? dto.startsAt : new Date(dto.startsAt as any);
		const grandFinalAt =
			dto.grandFinalAt instanceof Date ? dto.grandFinalAt : new Date(dto.grandFinalAt as any);

		if (Number.isNaN(startsAt.getTime()) || Number.isNaN(grandFinalAt.getTime()))
			throw new BadRequest("Dates de tournoi invalides.");
		if (startsAt >= grandFinalAt)
			throw new BadRequest(
				"La phase finale d'un tournoi ne peut pas précéder le début du tournoi."
			);

		// Contenu toujours éditable
		tournament.name = dto.name;
		tournament.description = dto.description;
		tournament.logo = dto.logo;
		tournament.affiche = dto.affiche;
		tournament.planning = dto.planning;
		tournament.ruleset = dto.ruleset;
		// Politique de saisie des scores : éditable jusqu'au bout, y compris tournoi en
		// cours — c'est le moment où l'organisateur a le plus de raisons de la changer.
		tournament.scoreReportPolicy = parseScoreReportPolicy(
			dto.scoreReportPolicy,
			tournament.scoreReportPolicy
		);

		// Capacité et bracket ne regardent que les inscrits actifs (ni liste d'attente ni DQ).
		const participantsCount = await this.db.em.count(TournamentParticipant, {
			tournament: tournamentId,
			status: ParticipantStatus.ACTIVE,
		});
		const isPendingEmpty =
			tournament.internalState === TournamentState.PENDING && participantsCount === 0;
		const isPreStart =
			tournament.internalState === TournamentState.PENDING ||
			tournament.internalState === TournamentState.PREREGISTERING ||
			tournament.internalState === TournamentState.PREPARING;

		if (isPreStart) {
			// Dates : autorisées tant que le tournoi n'a pas démarré
			if (startsAt > new Date()) {
				tournament.startsAt = startsAt;
				tournament.grandFinalAt = grandFinalAt;
			} else if (tournament.internalState === TournamentState.PENDING) {
				// En planification, refuse une date passée
				throw new BadRequest("Un tournoi ne peut pas être planifié dans le passé.");
			}
			// Sinon on garde les dates existantes si déjà passées (en cours de préparation)
			tournament.matchFormat = dto.matchFormat;
			tournament.customFormatChildCount = dto.customFormatChildCount;
			tournament.seedOrdering = dto.seedOrdering;
			tournament.groupStageEnabled = dto.groupStageEnabled ?? false;
			tournament.groupStageType = dto.groupStageType ?? null;

			// Planning automatisé : modifiable tant que le tournoi n'a pas démarré.
			const schedule = this.parseScheduleFields(dto, tournament.startsAt);
			tournament.registrationOpensAt = schedule.registrationOpensAt;
			tournament.registrationClosesAt = schedule.registrationClosesAt;
			tournament.autoStart = schedule.autoStart;
			tournament.discordRoleEnabled = schedule.discordRoleEnabled;
		}

		const typeChanged = dto.tournamentType !== tournament.tournamentType;
		const sizeChanged = dto.participantsNumber !== tournament.participantsNumber;
		const allowedSizes = [4, 8, 16, 32, 64, 128, 256, 512, 1024] as const;
		let capacityIncreased = false;

		// Type de tournoi : uniquement en planification vide
		if (typeChanged) {
			if (!isPendingEmpty) {
				throw new BadRequest(
					"Le type de tournoi n'est modifiable qu'en planification, sans inscrits."
				);
			}
			if (!isSupportedTournamentType(dto.tournamentType)) {
				throw new NotImplemented(`Type de tournoi non supporté : ${dto.tournamentType}`);
			}
			tournament.tournamentType = dto.tournamentType;
		}

		// Taille : libre en planification vide ; ensuite ↑ seulement (inscriptions / préparation)
		if (sizeChanged) {
			const newSize = Number(dto.participantsNumber);
			if (!allowedSizes.includes(newSize as (typeof allowedSizes)[number])) {
				throw new BadRequest(
					`Taille invalide (${newSize}). Valeurs autorisées : ${allowedSizes.join(", ")}.`
				);
			}

			if (isPendingEmpty) {
				tournament.participantsNumber = newSize;
			} else if (isPreStart) {
				if (newSize < tournament.participantsNumber) {
					throw new BadRequest(
						`Impossible de réduire la capacité (${tournament.participantsNumber} → ${newSize}). Augmentation uniquement.`
					);
				}
				if (newSize === tournament.participantsNumber) {
					// no-op
				} else if (newSize < participantsCount) {
					throw new BadRequest(
						`La capacité (${newSize}) ne peut pas être inférieure au nombre d'inscrits (${participantsCount}).`
					);
				} else {
					const previous = tournament.participantsNumber;
					tournament.participantsNumber = newSize;
					capacityIncreased = true;
					// Si le tournoi était plein (PREPARING), rouvrir les inscriptions
					if (
						tournament.internalState === TournamentState.PREPARING &&
						participantsCount < newSize
					) {
						tournament.internalState = TournamentState.PREREGISTERING;
					}
					console.info(
						`[updateTournament] capacité #${tournamentId}: ${previous} → ${newSize}` +
							(tournament.internalState === TournamentState.PREREGISTERING
								? " (inscriptions rouvertes)"
								: "")
					);
				}
			} else {
				throw new BadRequest(
					"La capacité n'est plus modifiable une fois le tournoi démarré, terminé ou annulé."
				);
			}
		}

		await this.db.em.flush();

		// Rebuild bracket technique si structure changée en planification vide
		// ou si la capacité augmente (nouveaux slots vides dans le seeding).
		if (isPendingEmpty && (typeChanged || sizeChanged)) {
			await this.rebuildTechnicalBracket(tournament);
		} else if (capacityIncreased) {
			try {
				await this.bracketService.makeSeeding(tournament.id, tournament.participantsNumber);
			} catch (e) {
				// Pas de stage encore (début d'inscriptions) : OK, se reconstruira plus tard
				console.warn(`[updateTournament] makeSeeding après ↑ capacité :`, (e as Error)?.message);
			}
		}

		await this.events.log({
			tournamentId: tournament.id,
			type: TournamentEventType.UPDATED,
			payload: {
				name: tournament.name,
				startsAt: tournament.startsAt,
				size: tournament.participantsNumber,
				typeChanged,
				sizeChanged,
			},
		});

		await this.db.em.refresh(tournament, { populate: ["organization", "managers"] });
		return tournament;
	}

	/** Supprime le stage technique existant et en recrée un pour le tournoi. */
	private async rebuildTechnicalBracket(tournament: Tournament) {
		try {
			const stage = await this.bracketService.getCurrentStage(tournament.id).catch(() => null);
			if (stage) {
				// delete.stage via makeSeeding path — resetStage privé ; on passe par storage delete
				const data = await this.bracketService.getTournamentData(tournament.id);
				for (const s of data.stage ?? []) {
					// brackets-manager delete
					await (this.bracketService as any).manager?.delete?.stage?.(s.id);
				}
			}
		} catch (e) {
			console.warn("[updateTournament] cleanup stage:", (e as Error)?.message);
		}

		// Fallback SQL cleanup si l'API brackets-manager échoue
		try {
			const em = this.db.em;
			const stages = await em.execute<{ id: number }[]>(
				`SELECT id FROM bm_stage WHERE tournament_id = ?`,
				[tournament.id],
				"all"
			);
			const stageIds = stages.map((s) => s.id);
			if (stageIds.length) {
				const ph = stageIds.map(() => "?").join(",");
				await em.execute(`DELETE FROM bm_match_game WHERE stage_id IN (${ph})`, stageIds);
				await em.execute(`DELETE FROM bm_match WHERE stage_id IN (${ph})`, stageIds);
				await em.execute(`DELETE FROM bm_round WHERE stage_id IN (${ph})`, stageIds);
				await em.execute(`DELETE FROM bm_group WHERE stage_id IN (${ph})`, stageIds);
				await em.execute(`DELETE FROM bm_stage WHERE tournament_id = ?`, [tournament.id]);
				await em.execute(`DELETE FROM bm_participant WHERE tournament_id = ?`, [tournament.id]);
			}
		} catch (e) {
			console.warn("[updateTournament] SQL stage cleanup:", (e as Error)?.message);
		}

		await this.bracketService.initTechnicalBracket(
			tournament.id,
			tournament.name,
			tournament.tournamentType,
			tournament.participantsNumber,
			tournament.matchFormat,
			tournament.customFormatChildCount,
			undefined,
			tournament.seedOrdering ?? "inner_outer"
		);
	}

	async openRegistrations(tournamentId: number, actorId?: string) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);

		if (!tournament) {
			throw new NotFound("Tournoi introuvable.");
		}

		if (tournament.internalState !== TournamentState.PENDING) {
			throw new BadRequest("Les inscriptions ont déjà été ouvertes ou sont cloturées.");
		}

		tournament.internalState = TournamentState.PREREGISTERING;

		await this.db.em.flush();

		// Le rôle Discord est créé à l'ouverture, pas à la création : un tournoi encore
		// en planification (voire abandonné) ne doit pas polluer la liste des rôles du
		// serveur. L'échec Discord n'empêche pas l'ouverture des inscriptions.
		await this.roles.ensureRole(tournament);

		await this.events.log({
			tournamentId,
			type: TournamentEventType.REGISTRATIONS_OPENED,
			actorId: actorId ?? null,
		});
	}

	async register(tournamentId: number, userId: string) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);

		if (!tournament) {
			throw new NotFound("Tournoi introuvable.");
		}

		if (
			tournament.internalState !== TournamentState.PREREGISTERING &&
			tournament.internalState !== TournamentState.PREPARING
		) {
			throw new BadRequest("Les inscriptions sont fermées.");
		}

		const signupCap = tournament.participantsNumber;
		const participantsCount = await this.db.em.count(TournamentParticipant, {
			tournament: tournamentId,
			status: ParticipantStatus.ACTIVE,
		});

		const participates = await this.db.em.findOne(
			TournamentParticipant,
			{ tournament: tournamentId, user: userId },
			{ refresh: true }
		);
		if (participates) {
			if (participates.status === ParticipantStatus.WAITLISTED)
				throw new Conflict("Vous êtes déjà sur la liste d'attente de ce tournoi.");
			if (participates.status === ParticipantStatus.DISQUALIFIED)
				throw new Conflict("Vous avez été disqualifié de ce tournoi : contactez un organisateur.");
			throw new Conflict("Vous êtes déjà inscrit pour ce tournoi.");
		}

		// Tournoi complet : liste d'attente plutôt que refus sec. Le joueur garde son
		// rang d'arrivée et sera promu automatiquement à la première place libérée.
		const isFull = Boolean(signupCap) && participantsCount >= signupCap;

		const newParticipant = new TournamentParticipant();
		newParticipant.tournament = rel(Tournament, tournamentId);
		newParticipant.user = rel(User, userId);
		newParticipant.registeredAt = new Date();
		newParticipant.status = isFull ? ParticipantStatus.WAITLISTED : ParticipantStatus.ACTIVE;

		this.db.em.persist(newParticipant);

		// Persiste immédiatement le participant. Sans ce flush, dans le cas PREREGISTERING
		// non plein, aucune des deux branches ci-dessous ne flushe : l'écriture ne partait
		// qu'au prochain flush AUTO d'une requête ultérieure (non déterministe). On aligne
		// le comportement sur unregister/openRegistrations (flush explicite).
		await this.db.em.flush();

		if (isFull) {
			// Rien d'autre à faire : pas de rôle, pas de seeding tant que le joueur
			// n'occupe pas une place réelle.
			await this.events.log({
				tournamentId,
				type: TournamentEventType.PARTICIPANT_WAITLISTED,
				actorId: userId,
				targetId: userId,
			});

			return newParticipant;
		}

		await this.roles.assign(tournament, userId);

		await this.events.log({
			tournamentId,
			type: TournamentEventType.PARTICIPANT_REGISTERED,
			actorId: userId,
			targetId: userId,
		});

		try {
			if (
				participantsCount + 1 >= signupCap &&
				tournament.internalState === TournamentState.PREREGISTERING
			) {
				tournament.internalState = TournamentState.PREPARING;

				await this.db.em.flush();

				await this.bracketService.makeSeeding(tournamentId, tournament.participantsNumber);
			} else if (tournament.internalState === TournamentState.PREPARING) {
				await this.bracketService.makeSeeding(tournamentId, tournament.participantsNumber);
			}
		} catch (error) {
			console.error(error);
			const logger = await resolveDependency(Logger);
			await logOnSuperAdminChannel(logger, {
				content: `Une erreur de génération des brackets est survenue pour le tournoi ${tournament.name}, veuillez prévenir les organisateurs.`,
			});
		}

		return newParticipant;
	}

	async unregister(tournamentId: number, userId: string) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);

		if (!tournament) {
			throw new NotFound("Tournoi introuvable.");
		}

		if (
			tournament.internalState !== TournamentState.PREREGISTERING &&
			tournament.internalState !== TournamentState.PREPARING
		) {
			throw new BadRequest("Les inscriptions sont fermées, veuillez déclarer forfait.");
		}

		const participates = await this.db.em.findOne(
			TournamentParticipant,
			{ tournament: tournamentId, user: userId },
			{ refresh: true }
		);
		if (!participates) {
			throw new Conflict("Vous n'êtes pas inscrit pour ce tournoi.");
		}

		const wasActive = participates.status === ParticipantStatus.ACTIVE;

		this.db.em.remove(participates);

		try {
			await this.db.em.flush();
			if (tournament.internalState === TournamentState.PREPARING)
				await this.bracketService.makeSeeding(tournamentId, tournament.participantsNumber);
		} catch (error) {
			console.error(error);
			throw new BadRequest(`Impossible de se désinscrire du tournoi`);
		}

		await this.roles.unassign(tournament, userId);

		await this.events.log({
			tournamentId,
			type: TournamentEventType.PARTICIPANT_UNREGISTERED,
			actorId: userId,
			targetId: userId,
		});

		// La place n'est rendue que si elle était réellement occupée.
		if (wasActive) await this.promoteNextFromWaitlist(tournament);
	}

	async removeUser(tournamentId: number, userId: string, actorId?: string, reason?: string) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);

		if (!tournament) {
			throw new NotFound("Tournoi introuvable.");
		}

		if (
			tournament.internalState !== TournamentState.PREPARING &&
			tournament.internalState !== TournamentState.PREREGISTERING
		) {
			throw new BadRequest(
				"Il est impossible de retirer un participant hors des phases d'inscriptions ou de préparation. Utilise la disqualification une fois le tournoi lancé."
			);
		}

		const participates = await this.db.em.findOne(
			TournamentParticipant,
			{ tournament: tournamentId, user: userId },
			{ refresh: true }
		);
		if (!participates) {
			throw new BadRequest("Cet utilisateur n'est pas inscrit pour ce tournoi.");
		}

		const wasActive = participates.status === ParticipantStatus.ACTIVE;

		this.db.em.remove(participates);

		try {
			await this.db.em.flush();
			if (
				tournament.internalState === TournamentState.PREPARING ||
				tournament.internalState === TournamentState.PREREGISTERING
			) {
				try {
					await this.bracketService.makeSeeding(tournamentId, tournament.participantsNumber);
				} catch (e) {
					console.warn(`[removeUser] makeSeeding reporté :`, (e as Error)?.message);
				}
			}
		} catch (error) {
			console.error(error);
			throw new BadRequest(`Impossible de retirer ce participant du tournoi`);
		}

		await this.roles.unassign(tournament, userId);

		await this.events.log({
			tournamentId,
			type: TournamentEventType.PARTICIPANT_REMOVED,
			actorId: actorId ?? null,
			targetId: userId,
			reason: reason ?? null,
		});

		if (wasActive) await this.promoteNextFromWaitlist(tournament);
	}

	// ── Liste d'attente ────────────────────────────────────────────────────────

	/**
	 * Promeut le premier joueur de la liste d'attente si une place est libre.
	 *
	 * Appelée après chaque libération de place (désinscription, retrait,
	 * disqualification). Idempotente et silencieuse : sans liste d'attente ou sans
	 * place libre, elle ne fait rien. Ne remonte jamais d'erreur — une promotion
	 * ratée ne doit pas annuler le retrait qui l'a déclenchée.
	 */
	private async promoteNextFromWaitlist(
		tournament: Tournament,
		actorId?: string
	): Promise<TournamentParticipant | null> {
		try {
			if (
				tournament.internalState !== TournamentState.PREREGISTERING &&
				tournament.internalState !== TournamentState.PREPARING
			) {
				return null;
			}

			const activeCount = await this.db.em.count(TournamentParticipant, {
				tournament: tournament.id,
				status: ParticipantStatus.ACTIVE,
			});
			if (activeCount >= tournament.participantsNumber) return null;

			const next = await this.db.em.findOne(
				TournamentParticipant,
				{ tournament: tournament.id, status: ParticipantStatus.WAITLISTED },
				{ populate: ["user"], orderBy: { registeredAt: "ASC" }, refresh: true }
			);
			if (!next) return null;

			next.status = ParticipantStatus.ACTIVE;
			next.statusChangedAt = new Date();
			next.statusActorId = actorId ?? null;
			await this.db.em.flush();

			await this.roles.assign(tournament, next.user.id);

			await this.events.log({
				tournamentId: tournament.id,
				type: TournamentEventType.PARTICIPANT_PROMOTED,
				actorId: actorId ?? null,
				targetId: next.user.id,
			});

			await this.notifyWaitlistPromotion(tournament, next.user.id);

			await this.tryRebuildBracket(tournament, "promoteNextFromWaitlist");

			return next;
		} catch (error) {
			console.warn(
				`[promoteNextFromWaitlist] promotion impossible (tournoi ${tournament.id}) :`,
				(error as Error)?.message
			);
			return null;
		}
	}

	/**
	 * Notification in-app au joueur concerné. Jamais bloquante : un joueur non
	 * notifié reste un joueur promu (ou disqualifié), l'inverse serait absurde.
	 */
	private async notifyParticipant(
		userId: string,
		type: NotificationType,
		title: string,
		message: string,
		payload: Record<string, unknown>
	): Promise<void> {
		try {
			const notifications = await resolveDependency(NotificationService);

			const notification = new Notification();
			notification.title = title;
			notification.message = message;
			notification.type = type;
			notification.category = NotificationCategory.TOURNAMENT;
			notification.payload = payload;

			await this.db.em.persist(notification).flush();
			await notifications.sendUserNotification(userId, notification);
		} catch (error) {
			console.info(
				`[notifyParticipant] notification non envoyée à ${userId} :`,
				(error as Error)?.message
			);
		}
	}

	private async notifyWaitlistPromotion(tournament: Tournament, userId: string): Promise<void> {
		await this.notifyParticipant(
			userId,
			NotificationType.TOURNAMENT_WAITLIST_PROMOTED,
			"Une place s'est libérée",
			`Tu passes de la liste d'attente aux inscrits du tournoi ${tournament.name}.`,
			{ tournamentId: tournament.id, tournamentName: tournament.name }
		);
	}

	/** Promotion manuelle d'un joueur de la liste d'attente par un organisateur. */
	async promoteFromWaitlist(tournamentId: number, userId: string, actorId?: string) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);
		if (!tournament) throw new NotFound("Tournoi introuvable.");

		const participant = await this.db.em.findOne(
			TournamentParticipant,
			{ tournament: tournamentId, user: userId },
			{ populate: ["user"], refresh: true }
		);
		if (!participant) throw new BadRequest("Cet utilisateur n'est pas inscrit à ce tournoi.");
		if (participant.status !== ParticipantStatus.WAITLISTED)
			throw new BadRequest("Ce joueur n'est pas sur la liste d'attente.");

		const activeCount = await this.db.em.count(TournamentParticipant, {
			tournament: tournamentId,
			status: ParticipantStatus.ACTIVE,
		});
		if (activeCount >= tournament.participantsNumber)
			throw new Conflict(
				`Le tournoi est complet (${activeCount}/${tournament.participantsNumber}). Retire un inscrit avant de promouvoir.`
			);

		participant.status = ParticipantStatus.ACTIVE;
		participant.statusChangedAt = new Date();
		participant.statusActorId = actorId ?? null;
		await this.db.em.flush();

		await this.roles.assign(tournament, userId);

		await this.events.log({
			tournamentId,
			type: TournamentEventType.PARTICIPANT_PROMOTED,
			actorId: actorId ?? null,
			targetId: userId,
		});

		await this.notifyWaitlistPromotion(tournament, userId);
		await this.tryRebuildBracket(tournament, "promoteFromWaitlist");

		return this.toDTO(participant);
	}

	// ── Disqualification ───────────────────────────────────────────────────────

	/**
	 * Disqualifie un participant.
	 *
	 * Avant le démarrage, la place est rendue (et donc réattribuée depuis la liste
	 * d'attente). Une fois le tournoi lancé, le bracket doit continuer d'avancer :
	 * les lobbies non terminés du joueur passent en forfait et la propagation normale
	 * du bracket fait le reste — aucune logique d'avancement parallèle n'est écrite
	 * ici, sous peine de diverger du chemin nominal.
	 */
	async disqualifyParticipant(
		tournamentId: number,
		userId: string,
		reason: string,
		actorId?: string
	) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);
		if (!tournament) throw new NotFound("Tournoi introuvable.");

		if (
			tournament.internalState === TournamentState.CANCELED ||
			tournament.internalState === TournamentState.FINISHED
		) {
			throw new BadRequest("Ce tournoi est terminé ou annulé.");
		}

		const trimmedReason = (reason ?? "").trim();
		if (trimmedReason.length < 3)
			throw new BadRequest("Un motif de disqualification est obligatoire (3 caractères minimum).");

		const participant = await this.db.em.findOne(
			TournamentParticipant,
			{ tournament: tournamentId, user: userId },
			{ populate: ["user"], refresh: true }
		);
		if (!participant) throw new BadRequest("Cet utilisateur n'est pas inscrit à ce tournoi.");
		if (participant.status === ParticipantStatus.DISQUALIFIED)
			throw new Conflict("Ce joueur est déjà disqualifié.");

		const wasActive = participant.status === ParticipantStatus.ACTIVE;

		participant.status = ParticipantStatus.DISQUALIFIED;
		participant.statusChangedAt = new Date();
		participant.statusReason = trimmedReason.slice(0, 500);
		participant.statusActorId = actorId ?? null;
		participant.seed = null;
		await this.db.em.flush();

		await this.roles.unassign(tournament, userId);

		await this.events.log({
			tournamentId,
			type: TournamentEventType.PARTICIPANT_DISQUALIFIED,
			actorId: actorId ?? null,
			targetId: userId,
			reason: trimmedReason,
		});

		if (tournament.internalState === TournamentState.ONGOING) {
			const forfeited = await this.forfeitOpenLobbiesOf(tournament, userId);
			return { disqualified: true, forfeitedLobbies: forfeited, promoted: null };
		}

		// Avant démarrage : la place est libérée, le bracket rejoué sans le disqualifié.
		await this.tryRebuildBracket(tournament, "disqualifyParticipant");
		const promoted = wasActive ? await this.promoteNextFromWaitlist(tournament, actorId) : null;

		return {
			disqualified: true,
			forfeitedLobbies: 0,
			promoted: promoted ? promoted.user.id : null,
		};
	}

	/**
	 * Annule une disqualification. Le joueur redevient inscrit si une place est libre,
	 * sinon il repart en liste d'attente — jamais au-delà de la capacité.
	 */
	async reinstateParticipant(tournamentId: number, userId: string, actorId?: string) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);
		if (!tournament) throw new NotFound("Tournoi introuvable.");

		const participant = await this.db.em.findOne(
			TournamentParticipant,
			{ tournament: tournamentId, user: userId },
			{ populate: ["user"], refresh: true }
		);
		if (!participant) throw new BadRequest("Cet utilisateur n'est pas inscrit à ce tournoi.");
		if (participant.status !== ParticipantStatus.DISQUALIFIED)
			throw new BadRequest("Ce joueur n'est pas disqualifié.");

		if (tournament.internalState === TournamentState.ONGOING)
			throw new BadRequest(
				"Impossible de réintégrer un joueur en cours de tournoi : ses matchs ont déjà été propagés dans le bracket."
			);

		const activeCount = await this.db.em.count(TournamentParticipant, {
			tournament: tournamentId,
			status: ParticipantStatus.ACTIVE,
		});

		participant.status =
			activeCount < tournament.participantsNumber
				? ParticipantStatus.ACTIVE
				: ParticipantStatus.WAITLISTED;
		participant.statusChangedAt = new Date();
		participant.statusReason = null;
		participant.statusActorId = actorId ?? null;
		await this.db.em.flush();

		if (participant.status === ParticipantStatus.ACTIVE) {
			await this.roles.assign(tournament, userId);
			await this.tryRebuildBracket(tournament, "reinstateParticipant");
		}

		await this.events.log({
			tournamentId,
			type: TournamentEventType.PARTICIPANT_REINSTATED,
			actorId: actorId ?? null,
			targetId: userId,
			payload: { status: participant.status },
		});

		return this.toDTO(participant);
	}

	/**
	 * Passe en forfait tous les lobbies non terminés d'un joueur et laisse le bracket
	 * se propager. Renvoie le nombre de lobbies traités.
	 */
	private async forfeitOpenLobbiesOf(tournament: Tournament, userId: string): Promise<number> {
		const lobbies = await this.db.em.find(
			Lobby,
			{
				event: tournament.id,
				state: { $nin: [LobbyState.FINISHED, LobbyState.FORFEITED, LobbyState.CANCELED] },
				lobbyUsers: { user: userId },
			},
			{ populate: ["lobbyUsers", "lobbyMatches"], refresh: true }
		);

		let handled = 0;

		for (const lobby of lobbies) {
			try {
				for (const lobbyUser of lobby.lobbyUsers.getItems()) {
					if (lobbyUser.user.id === userId) lobbyUser.forfeit = true;
				}

				// Toutes les manches sont tranchées d'un coup : une série laissée à
				// moitié validée bloquerait `computeSeriesOutcome` en `pending`, donc
				// le bracket, alors que le vainqueur est connu.
				for (const match of lobby.lobbyMatches.getItems()) {
					if (match.isValidated) continue;
					const disqualifiedSide = lobby.getUserSide(userId);
					match.scoreTeam1 = disqualifiedSide === TeamSide.TEAM_1 ? 0 : 1;
					match.scoreTeam2 = disqualifiedSide === TeamSide.TEAM_2 ? 0 : 1;
					match.adminValidated = true;
				}

				await this.db.em.flush();
				await this.bracketService.checkAndPropagateLobbyResult(lobby);
				handled++;
			} catch (error) {
				console.warn(
					`[forfeitOpenLobbiesOf] lobby ${lobby.id} non traité :`,
					(error as Error)?.message
				);
			}
		}

		return handled;
	}

	/** Seeding autorisé en inscriptions + préparation uniquement. */
	private assertSeedingEditable(tournament: Tournament): void {
		if (
			tournament.internalState !== TournamentState.PREREGISTERING &&
			tournament.internalState !== TournamentState.PREPARING
		) {
			throw new BadRequest(
				"Le seeding n'est modifiable qu'en phase d'inscriptions ou de préparation (avant le démarrage)."
			);
		}
	}

	/**
	 * Rebuild le bracket technique après un changement de seeds.
	 * No-op pour league (pas de stage brackets-manager). Silent si stage absent.
	 */
	private async tryRebuildBracket(tournament: Tournament, context: string): Promise<boolean> {
		if (isLeagueTournamentType(tournament.tournamentType)) return false;
		try {
			await this.bracketService.makeSeeding(tournament.id, tournament.participantsNumber);
			return true;
		} catch (e) {
			console.warn(`[${context}] makeSeeding reporté :`, (e as Error)?.message);
			return false;
		}
	}

	private participantLabel(p: TournamentParticipant): string {
		return p.user?.displayName || p.user?.username || p.user?.id || `#${p.id}`;
	}

	/**
	 * Assigne seed 1..N dans l'ordre fourni (capacité max = participantsNumber).
	 * Reset d'abord pour éviter les collisions pendant l'assignation.
	 */
	private async assignSequentialSeeds(
		participantsInOrder: TournamentParticipant[],
		cap: number
	): Promise<void> {
		for (const p of participantsInOrder) {
			p.seed = null;
		}
		await this.db.em.flush();

		participantsInOrder.forEach((p, i) => {
			p.seed = i < cap ? i + 1 : null;
		});
		await this.db.em.flush();
	}

	private async loadSoloEloMap(userIds: string[]): Promise<Map<string, number>> {
		if (userIds.length === 0) return new Map();
		const views = await this.db.em.find(UserView, { id: { $in: userIds } });
		const eloByUser = new Map<string, number>();
		for (const v of views) {
			eloByUser.set(v.id, v.solo_elo ?? 0);
		}
		return eloByUser;
	}

	/**
	 * Met à jour la seed d'un participant.
	 * Si la seed cible est prise → **swap** automatique (comportement TO standard).
	 * Seed 0 / null / vide → retire la seed.
	 */
	async setParticipantSeeding(tournamentId: number, participantDTO: ParticipantDTO) {
		// Path param = source de vérité. Le nested tournament du body peut être partiel.
		const dtoTournamentId =
			participantDTO.tournament != null
				? typeof participantDTO.tournament === "object"
					? Number((participantDTO.tournament as { id?: number }).id)
					: Number(participantDTO.tournament)
				: null;
		if (
			dtoTournamentId != null &&
			!Number.isNaN(dtoTournamentId) &&
			dtoTournamentId !== tournamentId
		) {
			throw new BadRequest("Attempting to edit seeding of the wrong tournament !");
		}

		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);
		if (!tournament) throw new NotFound("Tournoi introuvable.");
		this.assertSeedingEditable(tournament);

		const participant = await this.db.em.findOne(
			TournamentParticipant,
			{ id: participantDTO.id, tournament: tournamentId },
			{ refresh: true, populate: ["user"] }
		);
		if (!participant) throw new NotFound("Participant introuvable dans ce tournoi.");
		if (participant.status !== ParticipantStatus.ACTIVE)
			throw new BadRequest(
				"Seuls les inscrits actifs peuvent recevoir une seed (ni liste d'attente ni disqualifiés)."
			);

		const newSeed =
			participantDTO.seed != null && Number(participantDTO.seed) > 0
				? Number(participantDTO.seed)
				: null;

		if (newSeed != null && newSeed > tournament.participantsNumber) {
			throw new BadRequest(`La seed doit être entre 1 et ${tournament.participantsNumber}.`);
		}

		let swappedWith: string | null = null;
		const previousSeed = participant.seed ?? null;

		if (newSeed != null) {
			const occupant = await this.db.em.findOne(
				TournamentParticipant,
				{
					seed: newSeed,
					tournament: tournamentId,
					id: { $ne: participant.id },
				},
				{ refresh: true, populate: ["user"] }
			);

			if (occupant) {
				// Swap : l'occupant reçoit l'ancienne seed (peut être null).
				occupant.seed = previousSeed;
				swappedWith = this.participantLabel(occupant);
			}
		}

		participant.seed = newSeed;
		await this.db.em.flush();

		const bracketUpdated = await this.tryRebuildBracket(tournament, "setParticipantSeeding");

		await this.events.log({
			tournamentId,
			type: TournamentEventType.SEEDING_CHANGED,
			targetId: participant.user.id,
			payload: { mode: "manual", seed: participant.seed, previousSeed, swappedWith },
		});

		return {
			participantId: participant.id,
			seed: participant.seed,
			previousSeed,
			swappedWith,
			bracketUpdated,
		};
	}

	/**
	 * Attribue seed 1..N selon le classement ranked solo (ELO décroissant).
	 * Écrase le seeding existant. Utile pour les TOs (ex. Evo).
	 */
	async seedByRanked(tournamentId: number) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);
		if (!tournament) throw new NotFound("Tournoi introuvable.");
		this.assertSeedingEditable(tournament);

		// Seuls les inscrits actifs sont seedés : donner une seed à un joueur en liste
		// d'attente la lui ferait perdre à la promotion suivante.
		const participants = await this.db.em.find(
			TournamentParticipant,
			{ tournament: tournamentId, status: ParticipantStatus.ACTIVE },
			{ refresh: true, populate: ["user"] }
		);

		if (participants.length === 0) {
			throw new BadRequest("Aucun participant à seed.");
		}

		const eloByUser = await this.loadSoloEloMap(participants.map((p) => p.user.id));

		const sorted = [...participants].sort((a, b) => {
			const ea = eloByUser.get(a.user.id) ?? 0;
			const eb = eloByUser.get(b.user.id) ?? 0;
			if (eb !== ea) return eb - ea;
			return this.participantLabel(a).localeCompare(this.participantLabel(b), "fr");
		});

		await this.assignSequentialSeeds(sorted, tournament.participantsNumber);
		const bracketUpdated = await this.tryRebuildBracket(tournament, "seedByRanked");

		await this.events.log({
			tournamentId,
			type: TournamentEventType.SEEDING_CHANGED,
			payload: { mode: "ranked", seeded: sorted.length },
		});

		return {
			mode: "ranked" as const,
			bracketUpdated,
			assignments: sorted.map((p) => ({
				id: p.id,
				seed: p.seed,
				userId: p.user.id,
				username: this.participantLabel(p),
				soloElo: eloByUser.get(p.user.id) ?? 0,
			})),
		};
	}

	/** Mélange aléatoire des seeds 1..N (Fisher–Yates). */
	async seedRandom(tournamentId: number) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);
		if (!tournament) throw new NotFound("Tournoi introuvable.");
		this.assertSeedingEditable(tournament);

		const participants = await this.db.em.find(
			TournamentParticipant,
			{ tournament: tournamentId, status: ParticipantStatus.ACTIVE },
			{ refresh: true, populate: ["user"] }
		);

		if (participants.length === 0) {
			throw new BadRequest("Aucun participant à seed.");
		}

		const shuffled = [...participants];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}

		await this.assignSequentialSeeds(shuffled, tournament.participantsNumber);
		const bracketUpdated = await this.tryRebuildBracket(tournament, "seedRandom");

		await this.events.log({
			tournamentId,
			type: TournamentEventType.SEEDING_CHANGED,
			payload: { mode: "random", seeded: shuffled.length },
		});

		return {
			mode: "random" as const,
			bracketUpdated,
			assignments: shuffled.map((p) => ({
				id: p.id,
				seed: p.seed,
				userId: p.user.id,
				username: this.participantLabel(p),
			})),
		};
	}

	/** Retire toutes les seeds (slots = ordre d'inscription au prochain rebuild). */
	async clearSeeds(tournamentId: number) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);
		if (!tournament) throw new NotFound("Tournoi introuvable.");
		this.assertSeedingEditable(tournament);

		const participants = await this.db.em.find(
			TournamentParticipant,
			{ tournament: tournamentId },
			{ refresh: true }
		);

		for (const p of participants) {
			p.seed = null;
		}
		await this.db.em.flush();

		const bracketUpdated = await this.tryRebuildBracket(tournament, "clearSeeds");

		await this.events.log({
			tournamentId,
			type: TournamentEventType.SEEDING_CHANGED,
			payload: { mode: "clear", cleared: participants.length },
		});

		return {
			mode: "clear" as const,
			bracketUpdated,
			cleared: participants.length,
		};
	}

	async generateBracket(tournamentId: number) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);

		if (!tournament) {
			throw new NotFound("Tournoi introuvable.");
		}

		await this.bracketService.makeSeeding(tournamentId, tournament.participantsNumber);

		if (tournament.internalState !== TournamentState.PREPARING) {
			tournament.internalState = TournamentState.PREPARING;

			await this.db.em.flush();
		}

		await this.events.log({
			tournamentId,
			type: TournamentEventType.BRACKET_GENERATED,
			payload: { participants: await this.countActiveParticipants(tournamentId) },
		});

		return await this.bracketService.getTournamentData(tournamentId);
	}

	async startTournament(tournamentId: number) {
		// 1. Récupération
		const tournament = await this.db.em.findOne(Tournament, { id: tournamentId });

		if (!tournament) throw new NotFound("Tournament not found");

		// (Optionnel) Permettre à un admin de forcer le démarrage même si la date n'est pas atteinte ?
		// Si tu veux être strict, garde cette ligne :
		if (tournament.startsAt && tournament.startsAt > new Date()) {
			throw new BadRequest("Le tournoi ne peut pas démarrer avant la date prévue.");
		}

		// Vérification qu'il est bien en phase de préparation (existe pour bracket manager)
		if (tournament.internalState !== TournamentState.PREPARING) {
			throw new BadRequest(
				"La phase de préparation du tournoi n'est pas terminée, le tournoi a déjà démarré ou est terminé."
			);
		}

		try {
			tournament.internalState = TournamentState.ONGOING;
			await this.db.em.flush();

			const phases = await this.db.em.find(
				TournamentPhase,
				{ tournament: tournamentId, status: PhaseStatus.Pending },
				{ orderBy: { index: "ASC" } }
			);

			if (phases.length > 0) {
				const participants = await this.db.em.find(
					TournamentParticipant,
					{ tournament: tournamentId },
					{ populate: ["user"] }
				);
				const users = participants.map((p) => p.user).filter((u): u is User => u != null);
				await this.swissStageService.startSwiss(phases[0], users);
			} else {
				const stage = await this.bracketService.getCurrentStage(tournamentId);
				await this.bracketService.generateLobbies(
					tournamentId,
					Number(stage.id),
					tournament.matchFormat,
					tournament.customFormatChildCount
				);
			}

			await this.events.log({
				tournamentId,
				type: TournamentEventType.TOURNAMENT_STARTED,
				payload: { participants: await this.countActiveParticipants(tournamentId) },
			});

			return tournament;
		} catch (error: any) {
			console.error(error);
			throw new BadRequest("Impossible de démarrer le tournoi.");
		}
	}

	async countActiveParticipants(tournamentId: number): Promise<number> {
		return this.db.em.count(TournamentParticipant, {
			tournament: tournamentId,
			status: ParticipantStatus.ACTIVE,
		});
	}

	// ── Clôture / annulation ───────────────────────────────────────────────────

	/**
	 * Clôture manuelle d'un tournoi par un organisateur.
	 *
	 * Le passage automatique en `Finished` (dernier lobby terminé) reste le chemin
	 * nominal ; cette route sert aux cas que le bracket ne sait pas trancher seul :
	 * finale jouée hors ligne, abandon collectif, édition arrêtée en cours. Refuse
	 * par défaut s'il reste des lobbies ouverts — `force` lève ce garde-fou, et le
	 * journal garde trace du forçage.
	 */
	async closeTournament(tournamentId: number, actorId?: string, force = false) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);
		if (!tournament) throw new NotFound("Tournoi introuvable.");

		if (tournament.internalState === TournamentState.FINISHED)
			throw new Conflict("Ce tournoi est déjà terminé.");
		if (tournament.internalState === TournamentState.CANCELED)
			throw new BadRequest("Ce tournoi est annulé : restaure-le avant de le clôturer.");
		if (tournament.internalState !== TournamentState.ONGOING)
			throw new BadRequest("Seul un tournoi en cours peut être clôturé.");

		const openLobbies = await this.db.em.count(Lobby, {
			event: tournamentId,
			state: { $nin: [LobbyState.FINISHED, LobbyState.FORFEITED, LobbyState.CANCELED] },
		});

		if (openLobbies > 0 && !force) {
			throw new Conflict(
				`${openLobbies} match(s) ne sont pas terminés. Termine-les ou force la clôture.`
			);
		}

		tournament.internalState = TournamentState.FINISHED;
		tournament.closedAt = new Date();
		await this.db.em.flush();

		// Bonus AP podium : même chemin que la clôture automatique, idempotent par
		// `placementEloApplied`. Un échec ici (format non éligible, standings non
		// résolvables) ne doit pas empêcher la clôture demandée.
		let placementPrizes: unknown = null;
		try {
			const response = await fetch(`${urlsConfig.unifiedApi}/v1/achillea/tournaments/internal/${tournamentId}/apply-placement-prizes`, {
				method: "POST",
				headers: env.API_ADMIN_TOKEN ? { Authorization: `Bearer ${env.API_ADMIN_TOKEN}` } : undefined,
			});
			if (!response.ok) throw new Error(`Unified placement API returned ${response.status}`);
			placementPrizes = await response.json();
		} catch (error) {
			console.warn(`[closeTournament] bonus podium reporté :`, (error as Error)?.message);
		}

		await this.events.log({
			tournamentId,
			type: TournamentEventType.TOURNAMENT_CLOSED,
			actorId: actorId ?? null,
			payload: { forced: force, openLobbies, placementPrizes },
		});

		return { success: true, openLobbies, forced: force, placementPrizes };
	}

	/**
	 * Annule un tournoi : l'état passe à `Canceled`, **rien n'est supprimé**.
	 * Les listes publiques excluent déjà cet état (`getAllTournaments`), le tournoi
	 * reste consultable par ses organisateurs et par l'historique.
	 */
	async cancelTournament(tournamentId: number, reason: string, actorId?: string) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);
		if (!tournament) throw new NotFound("Tournoi introuvable.");

		if (tournament.internalState === TournamentState.CANCELED)
			throw new Conflict("Ce tournoi est déjà annulé.");
		if (tournament.internalState === TournamentState.FINISHED)
			throw new BadRequest("Un tournoi terminé ne peut plus être annulé.");

		const trimmedReason = (reason ?? "").trim();
		if (trimmedReason.length < 3)
			throw new BadRequest("Un motif d'annulation est obligatoire (3 caractères minimum).");

		const previousState = tournament.internalState;

		tournament.internalState = TournamentState.CANCELED;
		tournament.cancelReason = trimmedReason.slice(0, 500);
		tournament.canceledAt = new Date();
		await this.db.em.flush();

		// Prévenir les inscrits avant de démonter le rôle : après suppression, plus
		// aucun moyen de savoir qui était concerné côté Discord.
		const participants = await this.db.em.find(
			TournamentParticipant,
			{ tournament: tournamentId, status: { $ne: ParticipantStatus.DISQUALIFIED } },
			{ populate: ["user"] }
		);

		for (const participant of participants) {
			await this.notifyParticipant(
				participant.user.id,
				NotificationType.TOURNAMENT_CANCELED,
				"Tournoi annulé",
				`Le tournoi ${tournament.name} a été annulé : ${trimmedReason}`,
				{ tournamentId, tournamentName: tournament.name, reason: trimmedReason }
			);
		}

		await this.roles.deleteRole(tournament, `Tournoi ${tournament.name} annulé`);

		await this.events.log({
			tournamentId,
			type: TournamentEventType.TOURNAMENT_CANCELED,
			actorId: actorId ?? null,
			reason: trimmedReason,
			payload: { previousState, notified: participants.length },
		});

		return { success: true, notified: participants.length };
	}

	/**
	 * Restaure un tournoi annulé dans l'état qui précédait l'annulation.
	 *
	 * Sans cette route, revenir sur une annulation demanderait une écriture SQL à la
	 * main — exactement ce que le cadrage voulait éviter en conservant les tournois
	 * annulés en base plutôt que de les supprimer.
	 */
	async restoreTournament(tournamentId: number, actorId?: string) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ refresh: true }
		);
		if (!tournament) throw new NotFound("Tournoi introuvable.");

		if (tournament.internalState !== TournamentState.CANCELED)
			throw new BadRequest("Ce tournoi n'est pas annulé.");

		// L'état d'origine est relu dans le journal : le déduire des dates donnerait
		// un résultat faux pour un tournoi annulé après un report.
		const cancelEvent = await this.db.em.findOne(
			TournamentEvent,
			{ tournament: tournamentId, type: TournamentEventType.TOURNAMENT_CANCELED },
			{ orderBy: { createdAt: "DESC" } }
		);
		const previousState = (cancelEvent?.payload as { previousState?: TournamentState } | null)
			?.previousState;

		tournament.internalState =
			previousState && previousState !== TournamentState.CANCELED
				? previousState
				: TournamentState.PENDING;
		tournament.cancelReason = null;
		tournament.canceledAt = null;
		await this.db.em.flush();

		// Le rôle a été supprimé à l'annulation : il est recréé si le tournoi retrouve
		// une phase où des inscrits existent.
		if (
			tournament.internalState === TournamentState.PREREGISTERING ||
			tournament.internalState === TournamentState.PREPARING ||
			tournament.internalState === TournamentState.ONGOING
		) {
			const roleId = await this.roles.ensureRole(tournament);
			if (roleId) {
				const actives = await this.db.em.find(
					TournamentParticipant,
					{ tournament: tournamentId, status: ParticipantStatus.ACTIVE },
					{ populate: ["user"] }
				);
				for (const participant of actives) {
					await this.roles.assign(tournament, participant.user.id);
				}
			}
		}

		await this.events.log({
			tournamentId,
			type: TournamentEventType.TOURNAMENT_RESTORED,
			actorId: actorId ?? null,
			payload: { restoredTo: tournament.internalState },
		});

		return { success: true, internalState: tournament.internalState };
	}

	async isTournamentOrganizer(userId: string, tournamentId: number) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ populate: ["organization", "managers"], refresh: true }
		);

		if (!tournament) throw new NotFound("Tournament not found");

		// SuperAdmin : accès ops complet (création de tournoi test, etc.)
		const actor = await this.db.em.findOne(User, { id: userId });
		if (actor && (actor.role ?? 0) >= UserRole.SuperAdministrator) return true;

		const organization = tournament.organization;
		const organizationManagers = await this.db.em.find(OrganizationManager, { organization });
		const tournamentOrganizers = tournament.managers.getItems();

		if (
			userIsTournamentOrganizer(
				organization.owner.id,
				organizationManagers.map((om) => om.user.id),
				tournamentOrganizers.map((to) => to.id),
				userId
			)
		)
			return true;

		throw new Unauthorized("Vous n'êtes pas autorisé à effectuer cette action.");
	}

	/**
	 * Bascule « qui saisit les scores » sans repasser par le formulaire complet.
	 *
	 * L'arbitrage se fait tournoi lancé, entre deux matchs : demander à l'organisateur
	 * de rouvrir le dialogue d'édition et de re-valider dates, images et règlement pour
	 * un seul bouton radio serait absurde. Autorisée jusqu'à la clôture — après, plus
	 * aucun score n'est saisissable de toute façon.
	 */
	async setScoreReportPolicy(
		tournamentId: number,
		policy: ScoreReportPolicy,
		actorId?: string
	): Promise<Tournament> {
		const tournament = await this.db.em.findOne(Tournament, { id: tournamentId });
		if (!tournament) throw new NotFound("Tournoi introuvable.");

		if (
			tournament.internalState === TournamentState.FINISHED ||
			tournament.internalState === TournamentState.CANCELED
		)
			throw new BadRequest("Impossible de modifier un tournoi terminé ou annulé.");

		if (tournament.scoreReportPolicy === policy) return tournament;

		tournament.scoreReportPolicy = policy;
		await this.db.em.flush();

		await this.events.log({
			tournamentId,
			type: TournamentEventType.UPDATED,
			actorId: actorId ?? null,
			payload: { scoreReportPolicy: policy },
		});

		return tournament;
	}

	/**
	 * Variante prédicat d'`isTournamentOrganizer`, qui est un **garde** : elle lève un
	 * 401 dès que l'appelant n'est pas organisateur. L'utiliser dans un `const isTO =
	 * await ...` faisait échouer toute la requête au lieu de basculer sur le chemin
	 * joueur — la saisie de score par les joueurs ne pouvait jamais aboutir.
	 */
	async isTournamentOrganizerSafe(userId: string, tournamentId: number): Promise<boolean> {
		try {
			return await this.isTournamentOrganizer(userId, tournamentId);
		} catch (error) {
			if (error instanceof Unauthorized || error instanceof NotFound) return false;
			throw error;
		}
	}

	/**
	 * Politique de saisie des scores du tournoi qui porte ce lobby.
	 * Hors tournoi (ranked, interclan), rien à restreindre : `PLAYERS`.
	 */
	private async scoreReportPolicyForLobby(lobby: Lobby): Promise<ScoreReportPolicy> {
		if (lobby.eventType !== EventTypeEnum.TOURNAMENT) return ScoreReportPolicy.PLAYERS;

		const tournament = await this.db.em.findOne(Tournament, { id: lobby.event.id });

		return tournament?.scoreReportPolicy ?? ScoreReportPolicy.PLAYERS;
	}

	async isTournamentOrganizationManager(userId: string, tournamentId: number) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ populate: ["organization", "managers"], refresh: true }
		);

		if (!tournament) throw new NotFound("Tournament not found");

		const actor = await this.db.em.findOne(User, { id: userId });
		if (actor && (actor.role ?? 0) >= UserRole.SuperAdministrator) return true;

		const organization = tournament.organization;
		const organizationManagers = await this.db.em.find(OrganizationManager, { organization });

		if (organization.owner.id === userId) return true;
		if (organizationManagers.some((om) => om.user.id === userId)) return true;
		// TO rattaché au tournoi
		if (tournament.managers.getItems().some((m) => m.id === userId)) return true;

		throw new Unauthorized("Vous n'êtes pas autorisé à effectuer cette action.");
	}

	async isOrganizationManager(userId: string, organizationId: number) {
		const organization = await this.db.em.findOne(
			Organization,
			{ id: organizationId },
			{ populate: ["managers"] }
		);

		if (!organization) throw new NotFound("Organization not found");

		const actor = await this.db.em.findOne(User, { id: userId });
		if (actor && (actor.role ?? 0) >= UserRole.SuperAdministrator) return true;

		if (organization.owner.id === userId) return true;
		if (organization.managers.getItems().some((om) => om.user.id === userId)) return true;

		throw new Unauthorized("Vous n'êtes pas autorisé à effectuer cette action.");
	}

	/**
	 * Une organisation ne peut ouvrir des tournois qu'une fois validée.
	 *
	 * Sans ce contrôle, n'importe qui créerait une organisation puis publierait dans la
	 * foulée : la validation deviendrait décorative, alors que c'est elle qui distingue
	 * une organisation réelle d'une inscription de passage.
	 */
	async assertOrganizationCanHostTournaments(organizationId: number): Promise<void> {
		const organization = await this.db.em.findOne(Organization, { id: organizationId });
		if (!organization) throw new NotFound("Organisation introuvable.");

		if (organization.state !== OrganizationState.Approved) {
			throw new Unauthorized(
				"Cette organisation n'est pas encore validée : elle ne peut pas ouvrir de tournoi."
			);
		}
	}

	async addManagers(tournamentId: number, usersDto: UserDTO[], actorId?: string) {
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ populate: ["managers"] }
		);

		if (!tournament) throw new NotFound("Tournoi introuvable.");

		// On récupère tous les IDs
		const userIds = usersDto.map((u) => u.id);

		// On charge tous les utilisateurs d'un coup (1 seule requête SQL au lieu de N)
		const users = await this.db.em.find(User, { id: { $in: userIds } });

		// On vérifie si certains utilisateurs du DTO n'ont pas été trouvés en DB
		if (users.length !== usersDto.length) {
			throw new NotFound("Certains utilisateurs n'ont pas été trouvés.");
		}

		// On utilise ta logique unitaire
		for (const user of users) {
			this.linkManagerToTournament(tournament, user);
		}

		await this.db.em.flush();

		for (const user of users) {
			await this.events.log({
				tournamentId,
				type: TournamentEventType.ORGANIZER_ADDED,
				actorId: actorId ?? null,
				targetId: user.id,
			});
		}
	}

	/**
	 * Logique purement métier : lie l'entité User à l'entité Tournament
	 * Note: Pas besoin d'async ici si l'utilisateur est déjà chargé
	 */
	private linkManagerToTournament(tournament: Tournament, user: User) {
		if (!tournament.managers.contains(user)) {
			tournament.managers.add(user);
		} else {
			// Optionnel : on peut ignorer silencieusement au lieu de throw
			// si on est dans un ajout massif.
			throw new Conflict(`L'utilisateur ${user.id} est déjà manager.`);
		}
	}

	async removeManager(tournamentId: number, userId: string, actorId?: string): Promise<void> {
		// 1. Récupérer le tournoi avec ses managers
		const tournament = await this.db.em.findOne(
			Tournament,
			{ id: tournamentId },
			{ populate: ["managers"] }
		);

		if (!tournament) {
			throw new NotFound("Tournoi introuvable.");
		}

		// 2. Récupérer l'utilisateur
		const user = await this.db.em.findOne(User, { id: userId });
		if (!user) {
			throw new NotFound("Utilisateur introuvable.");
		}

		// 3. Vérifier si l'utilisateur est bien un manager de ce tournoi
		if (!tournament.managers.contains(user)) {
			throw new BadRequest("Cet utilisateur n'est pas un manager de ce tournoi.");
		}

		// 4. Retirer de la collection
		tournament.managers.remove(user);

		// 5. Sauvegarder les changements
		await this.db.em.flush();

		await this.events.log({
			tournamentId,
			type: TournamentEventType.ORGANIZER_REMOVED,
			actorId: actorId ?? null,
			targetId: userId,
		});
	}

	async validateGame(lobbyMatchId: number, side: TeamSide | "ADMIN") {
		const game = await this.db.em.findOneOrFail(
			LobbyMatch,
			{ id: lobbyMatchId },
			{ populate: ["lobby"] }
		);

		if (game.lobby.state === LobbyState.FINISHED || game.lobby.state === LobbyState.FORFEITED)
			throw new BadRequest("Ce lobby est déjà terminé.");

		if (game.isValidated) throw new Conflict("Ce match est déjà validé.");

		// 1. Apply the signature
		if (side === TeamSide.TEAM_1) game.team1Validated = true;
		if (side === TeamSide.TEAM_2) game.team2Validated = true;
		if (side === "ADMIN") {
			game.adminValidated = true;
		}

		await this.db.em.persist(game).flush();

		// 2. Trigger the check immediately
		await this.events.log({
			tournamentId: game.lobby.event.id,
			type: TournamentEventType.SCORE_VALIDATED,
			payload: {
				lobbyId: game.lobby.id,
				gameNumber: game.gameNumber,
				side: side === "ADMIN" ? "admin" : side,
				scoreTeam1: game.scoreTeam1,
				scoreTeam2: game.scoreTeam2,
			},
		});

		// If this specific game became valid, it might end the series.
		if (game.isValidated) {
			await this.bracketService.checkAndPropagateLobbyResult(game.lobby);
		}
	}

	async unvalidateGame(lobbyMatchId: number, side: TeamSide | "ADMIN") {
		const game = await this.db.em.findOneOrFail(
			LobbyMatch,
			{ id: lobbyMatchId },
			{ populate: ["lobby"] }
		);

		if (game.lobby.state === LobbyState.FINISHED || game.lobby.state === LobbyState.FORFEITED)
			throw new BadRequest("Ce match est déjà terminé.");

		// RESET VALIDATION automatically to prevent cheating
		if (side === "ADMIN") {
			game.adminValidated = false;
			game.team1Validated = false;
			game.team2Validated = false;
		}
		if (side === TeamSide.TEAM_1) game.team1Validated = false;
		if (side === TeamSide.TEAM_2) game.team2Validated = false;

		await this.db.em.flush();
	}

	async reportGameScore(
		lobbyId: number,
		gameNumber: number,
		score1: number,
		score2: number,
		userId: string
	) {
		// 1. Load Lobby with its matches
		// We need the collection to calculate the total score later
		const lobby = await this.db.em.findOneOrFail(
			Lobby,
			{ id: lobbyId },
			{
				populate: ["lobbyMatches", "lobbyUsers", "event"],
			}
		);

		if (lobby.state === LobbyState.FINISHED || lobby.state === LobbyState.FORFEITED)
			throw new BadRequest("Ce match est déjà terminé.");

		// 2. Find the specific game (LobbyMatch)
		// Note: getItems() works because we populated 'lobbyMatches'
		const matchGame = lobby.lobbyMatches.getItems().find((m) => m.gameNumber === gameNumber);

		if (!matchGame) throw new BadRequest("Game not found");

		const isTO = await this.isTournamentOrganizerSafe(userId, lobby.event.id);
		if (matchGame.isValidated && matchGame.adminValidated && !isTO)
			throw new Unauthorized("Ce score a déjà été validé par un administrateur");

		const side = isTO ? "ADMIN" : lobby.getUserSide(userId);

		if (!side) throw new Unauthorized("Vous n'êtes pas autorisé à effectuer cette action");

		if (
			!canReportTournamentScore(await this.scoreReportPolicyForLobby(lobby), {
				isOrganizer: isTO,
				isLobbyPlayer: !isTO,
			})
		)
			throw new Unauthorized("Les scores de ce tournoi sont saisis par les organisateurs.");

		// 3. Update the individual game score
		matchGame.scoreTeam1 = score1;
		matchGame.scoreTeam2 = score2;

		// Fresh → Ongoing dès la 1re saisie, puis Pending validation tant que non validé.
		if (lobby.state === LobbyState.FRESH || lobby.state === LobbyState.ONGOING) {
			lobby.state = LobbyState.PENDING_VALIDATION;
		}

		matchGame.team1Validated = false;
		matchGame.team2Validated = false;
		matchGame.adminValidated = false;

		await this.db.em.flush();

		await this.events.log({
			tournamentId: lobby.event.id,
			type: TournamentEventType.SCORE_REPORTED,
			actorId: userId,
			payload: {
				lobbyId,
				gameNumber,
				scoreTeam1: score1,
				scoreTeam2: score2,
				reportedBy: isTO ? "organizer" : "player",
			},
		});
	}

	// /**
	//  * Ajoute le résultat d'une manche (Map/Game) au Lobby
	//  */
	// async addGameResult(lobbyId: number, scoreTeam1: number, scoreTeam2: number) {
	// 	const lobby = await this.db.em.findOne(Lobby, { id: lobbyId }, { populate: ['lobbyMatches'] })
	// 	if (!lobby) throw new NotFound('Lobby introuvable')
	//
	// 	if (lobby.state === LobbyState.FINISHED) throw new BadRequest('Ce lobby est déjà terminé.')
	//
	// 	// Vérification BO3 : Est-ce nécessaire de jouer cette manche ?
	// 	let winsT1 = 0
	// 	let winsT2 = 0
	// 	lobby.lobbyMatches.getItems().forEach((m) => {
	// 		if (m.scoreTeam1 > m.scoreTeam2) winsT1++
	// 		else if (m.scoreTeam2 > m.scoreTeam1) winsT2++
	// 	})
	//
	// 	if (winsT1 >= 2 || winsT2 >= 2) {
	// 		throw new BadRequest(`Le BO3 est déjà terminé (score ${winsT1}-${winsT2}). Impossible d'ajouter une manche.`)
	// 	}
	//
	// 	const match = new LobbyMatch()
	// 	match.lobby = lobby
	// 	match.gameNumber = lobby.lobbyMatches.count() + 1
	// 	match.scoreTeam1 = scoreTeam1
	// 	match.scoreTeam2 = scoreTeam2
	//
	// 	this.db.em.persist(match)
	//
	// 	// On ne flush pas le Lobby entier, juste le match, mais flush() s'occupe du contexte
	// 	await this.db.em.flush()
	//
	// 	return match
	// }

	// async validateResult(lobbyId: number, userId: string, scoreInput: number) {
	// 	// On doit populate 'lobbyMatches' pour faire la vérification
	// 	const lobby = await this.db.em.findOne(Lobby, { id: lobbyId }, { populate: ['lobbyUsers', 'event', 'lobbyMatches'] })
	// 	if (!lobby) throw new NotFound('Lobby introuvable')
	//
	// 	const currentUser = lobby.lobbyUsers.getItems().find(lu => lu.user.id === userId)
	// 	const canEdit = !!currentUser || await this.isTournamentOrganizer(userId, lobby.event.id)
	// 	if (!canEdit) throw new Unauthorized('Vous n\'appartenez pas à ce Lobby')
	//
	// 	// --- NOUVEAU : Vérification de cohérence avec LobbyMatch ---
	// 	const matches = lobby.lobbyMatches.getItems()
	// 	if (matches.length > 0) {
	// 		// Si des matchs détaillés existent, on calcule le score réel
	// 		let calculatedScore = 0
	// 		if (currentUser.team === TeamSide.TEAM_1) {
	// 			calculatedScore = matches.filter(m => m.scoreTeam1 > m.scoreTeam2).length
	// 		} else {
	// 			calculatedScore = matches.filter(m => m.scoreTeam2 > m.scoreTeam1).length
	// 		}
	//
	// 		// On rejette si l'utilisateur essaie de valider un score différent du calcul
	// 		if (calculatedScore !== scoreInput) {
	// 			throw new BadRequest(`Le score déclaré (${scoreInput}) ne correspond pas aux matchs joués (${calculatedScore}).`)
	// 		}
	// 	}
	// 	// -----------------------------------------------------------
	//
	// 	// 1. Validation métier BO3
	// 	if (scoreInput > 2) throw new BadRequest('Dans un BO3, le score maximum est de 2 victoires.')
	//
	// 	currentUser.score = scoreInput
	// 	currentUser.validatedResult = true
	// 	currentUser.state = LobbyUserState.READY
	//
	// 	await this.db.em.flush()
	//
	// 	// 2. Vérification de l'adversaire
	// 	const opponent = currentUser.getOpponents()[0]
	//
	// 	if (opponent?.validatedResult) {
	// 		// Logique de cohérence entre les deux joueurs
	// 		const isConsistent = (currentUser.score === 2 || opponent.score === 2) && (currentUser.score + opponent.score <= 3)
	//
	// 		// Sécurité supplémentaire : si on a des LobbyMatch, on vérifie que le total correspond
	// 		// ex: match fini 2-1, les joueurs doivent valider 2 et 1.
	// 		const totalMatchesPlayed = matches.length
	// 		if (totalMatchesPlayed > 0 && (currentUser.score + opponent.score !== totalMatchesPlayed)) {
	// 			// Cas rare où les joueurs sont d'accord entre eux (ex: 1-0) mais qu'il y a 3 matchs en base
	// 			// On peut décider de bloquer ou laisser passer, ici je bloque pour la sécurité
	// 			return { status: 'conflict', message: 'Les scores validés ne correspondent pas au nombre de matchs joués.' }
	// 		}
	//
	// 		if (!isConsistent) {
	// 			lobby.state = LobbyState.CONTESTED
	// 			await this.db.em.flush()
	//
	// 			return { status: 'conflict', message: 'Les scores soumis ne sont pas cohérents pour un BO3.' }
	// 		}
	//
	// 		// 3. Finalisation
	// 		await this.finalizeLobby(lobby.id)
	// 	}
	//
	// 	return { status: 'waiting_opponent' }
	// }
	//
	// async finalizeLobby(lobbyId: number) {
	// 	// 1. Charger le lobby avec matchs, utilisateurs et infos tournoi
	// 	const lobby = await this.db.em.findOne(Lobby, { id: lobbyId }, { populate: ['lobbyMatches', 'lobbyUsers', 'event'] })
	// 	if (!lobby) throw new NotFound('Lobby introuvable')
	//
	// 	const event = lobby.event as Tournament
	//
	// 	// Récupération des équipes
	// 	const p1 = lobby.lobbyUsers.getItems().find(u => u.team === TeamSide.TEAM_1)!
	// 	const p2 = lobby.lobbyUsers.getItems().find(u => u.team === TeamSide.TEAM_2)!
	//
	// 	// 2. Calculer les scores et le gagnant basé sur LobbyMatch (Priorité 1)
	// 	const sortedMatches = lobby.lobbyMatches.getItems().sort((a, b) => a.gameNumber - b.gameNumber)
	//
	// 	let winsP1 = 0
	// 	let winsP2 = 0
	// 	let scoreSetP1 = ''
	// 	let scoreSetP2 = ''
	//
	// 	if (sortedMatches.length > 0) {
	// 		// Mode "Détaillé"
	// 		sortedMatches.forEach((m) => {
	// 			if (m.scoreTeam1 > m.scoreTeam2) winsP1++
	// 			else if (m.scoreTeam2 > m.scoreTeam1) winsP2++
	// 		})
	// 		scoreSetP1 = sortedMatches.map(m => m.scoreTeam1).join(',')
	// 		scoreSetP2 = sortedMatches.map(m => m.scoreTeam2).join(',')
	// 	} else {
	// 		// Mode "Fallback" (si pas de matchs détaillés, on prend le score déclaré par les joueurs)
	// 		winsP1 = p1.score
	// 		winsP2 = p2.score
	// 		scoreSetP1 = p1.score.toString()
	// 		scoreSetP2 = p2.score.toString()
	// 	}
	//
	// 	const p1Advancing = winsP1 > winsP2
	// 	const p2Advancing = winsP2 > winsP1
	//
	// 	// Sécurité : Si égalité ou pas de vainqueur clair en BO3
	// 	if (!p1Advancing && !p2Advancing) {
	// 		console.error(`Tentative de finalisation d'un lobby sans vainqueur clair (ID: ${lobbyId})`)
	// 		lobby.state = LobbyState.CONTESTED
	// 		await this.db.em.flush()
	//
	// 		return
	// 	}
	//
	// 	// 3. Payload Challonge V2
	// 	const payload: ChallongeUpdatedMatchPayload = {
	// 		data: {
	// 			type: 'Match',
	// 			attributes: {
	// 				match: [
	// 					{
	// 						participant_id: p1.challongeId!,
	// 						score_set: scoreSetP1,
	// 						advancing: p1Advancing,
	// 					},
	// 					{
	// 						participant_id: p2.challongeId!,
	// 						score_set: scoreSetP2,
	// 						advancing: p2Advancing,
	// 					},
	// 				],
	// 				tie: false, // Toujours false en bracket simple
	// 			},
	// 		},
	// 	}
	//
	// 	try {
	// 		// 4. Envoi à Challonge
	// 		await this.challongeService.updateMatch('', lobby.challongeId!, payload)
	//
	// 		lobby.state = LobbyState.FINISHED
	// 		await this.db.em.flush()
	//
	// 		// 5. Génération des lobbies suivants
	// 		await this.syncLobbiesFromChallonge(lobby.event.id)
	// 	} catch (error: any) {
	// 		console.error('Erreur Challonge Update:', error.response?.data || error.message)
	// 		// On passe en CONTESTED pour qu'un admin vérifie manuellement sur Challonge ou en DB
	// 		lobby.state = LobbyState.CONTESTED
	// 		await this.db.em.flush()
	// 		throw new BadRequest('Erreur lors de la synchronisation avec Challonge. Le match est passé en conflit.')
	// 	}
	// }

	async getTournamentLobby(lobbyId: number): Promise<Lobby> {
		return await this.db.em.findOneOrFail(
			Lobby,
			{ bracketMatchId: lobbyId },
			{
				populate: ["lobbyUsers.user", "lobbyMatches", "hostUser.user"],
				orderBy: { lobbyMatches: { gameNumber: "ASC" } },
			}
		);
	}

	async getTournamentLobbies(tournamentId: number): Promise<Lobby[]> {
		// 1. Récupération avec toutes les relations nécessaires
		return await this.db.em.find(
			Lobby,
			{ event: tournamentId },
			{
				// On charge les utilisateurs, leur profil, et l'historique des manches
				populate: ["lobbyUsers.user", "lobbyMatches", "hostUser.user"],
				// On trie : d'abord les matchs en cours, puis par ID
				orderBy: { state: "ASC", id: "ASC" },
			}
		);
	}

}

/** Points/résultats — uniquement les tournois élimination dont le classement final est résolu. */
