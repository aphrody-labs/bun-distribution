import {
	Collection,
	EntityRepository,
	EntityRepositoryType,
	raw,
	type FilterQuery,
	type FindOptions,
	type Rel,
} from "@mikro-orm/core";
import { Entity, Enum, ManyToMany, ManyToOne, Property } from "@mikro-orm/decorators/legacy";
import type { SeedOrdering } from "brackets-model";

import {
	EventTypeEnum,
	MatchFormat,
	ScoreReportPolicy,
	StageType,
	TournamentState,
} from "@/utils/enums";

import { Event } from "./Event";
import { Organization } from "./Organization";
import { Ruleset } from "./Ruleset";
import { TournamentParticipant } from "./TournamentParticipant";
import { TournamentSeries } from "./TournamentSeries";
import { User } from "./User";

@Entity({ repository: () => TournamentRepository, discriminatorValue: EventTypeEnum.TOURNAMENT })
export class Tournament extends Event {
	[EntityRepositoryType]?: TournamentRepository;

	@Enum(() => TournamentState)
	internalState: TournamentState = TournamentState.PENDING;

	@ManyToOne(() => TournamentSeries, { nullable: true, deleteRule: "cascade" })
	series?: Rel<TournamentSeries> | null;

	@ManyToOne(() => Organization)
	organization!: Rel<Organization>;

	@ManyToMany(() => User)
	managers = new Collection<User>(this);

	@ManyToMany(() => TournamentParticipant)
	participants = new Collection<TournamentParticipant>(this);

	@Enum(() => StageType)
	tournamentType!: StageType;

	@Property()
	participantsNumber!: number;

	@Property()
	startsAt!: Date;

	@Property()
	grandFinalAt!: Date;

	@Property({ default: false })
	groupStageEnabled: boolean = false;

	@Enum({ items: () => StageType, nullable: true })
	groupStageType?: StageType | null;

	@Property()
	logo!: string;

	@Property()
	affiche!: string;

	@Property()
	planning!: string;

	@Property()
	ruleset!: string;

	/**
	 * FK vers la table ruleset (T-3.1).
	 * Nullable pour rollback : l'ancienne colonne texte `ruleset` est conservée.
	 * Initialisée à "legacy" lors de la migration Migration20260426000000.
	 */
	@ManyToOne(() => Ruleset, { nullable: true, deleteRule: "set null" })
	rulesetEntity?: Rel<Ruleset> | null;

	@Property()
	seedOrdering!: SeedOrdering;

	@Enum(() => MatchFormat)
	matchFormat: MatchFormat;

	@Property({ nullable: true })
	customFormatChildCount?: number | null;

	/**
	 * Qui saisit les scores : les joueurs eux-mêmes (défaut historique) ou le staff seul.
	 *
	 * Modifiable en cours de tournoi — c'est précisément là que l'arbitrage se pose :
	 * un organisateur qui voit les saisies partir en litige referme la vanne sans avoir
	 * à recréer quoi que ce soit.
	 */
	@Enum(() => ScoreReportPolicy)
	scoreReportPolicy: ScoreReportPolicy = ScoreReportPolicy.PLAYERS;

	/**
	 * True une fois le bonus AP podium (top 4) versé sur user_elo.
	 * Idempotence going-forward + script rétroactif.
	 */
	@Property({ default: false })
	placementEloApplied: boolean = false;

	// ── Planning automatisé ──────────────────────────────────────────────────
	// `planning` (ci-dessus) reste le texte libre affiché aux joueurs. Les dates
	// ci-dessous pilotent les transitions automatiques (cron `PhaseTransitions`) :
	// nulles = tournoi conduit à la main, comportement historique inchangé.

	/** Ouverture automatique des inscriptions (Pending → Preregistering). */
	@Property({ nullable: true })
	registrationOpensAt?: Date | null;

	/** Fermeture automatique + génération du bracket (Preregistering → Preparing). */
	@Property({ nullable: true })
	registrationClosesAt?: Date | null;

	/** Démarrage automatique à `startsAt` (Preparing → Ongoing). */
	@Property({ default: false })
	autoStart: boolean = false;

	// ── Rôle Discord du tournoi ──────────────────────────────────────────────

	/**
	 * Case à cocher du formulaire : créer et distribuer un rôle Discord aux inscrits.
	 *
	 * Désactivé par défaut, à la demande du cadrage — le rôle n'a de sens que pour les
	 * tournois organisés sur le serveur Achillea. En créer un pour le tournoi d'une
	 * organisation tierce polluerait la liste des rôles sans servir à personne.
	 */
	@Property({ default: false })
	discordRoleEnabled: boolean = false;

	/** Rôle attribué automatiquement aux inscrits (null = pas encore créé ou désactivé). */
	@Property({ nullable: true })
	discordRoleId?: string | null;

	/** Serveur portant `discordRoleId` — un rôle n'a de sens que dans sa guilde. */
	@Property({ nullable: true })
	discordGuildId?: string | null;

	// ── Clôture / annulation ─────────────────────────────────────────────────

	/** Motif d'annulation, affiché sur la page du tournoi annulé. */
	@Property({ nullable: true, length: 500 })
	cancelReason?: string | null;

	@Property({ nullable: true })
	canceledAt?: Date | null;

	/** Clôture manuelle par un organisateur (null si passage automatique en Finished). */
	@Property({ nullable: true })
	closedAt?: Date | null;
}

export class TournamentRepository extends EntityRepository<Tournament> {
	async getAllTournaments(
		page?: number,
		pagination?: number,
		organizationId?: number,
		states?: TournamentState[]
	): Promise<[Tournament[], number]> {
		// 1. Construction dynamique du filtre (WHERE)
		const where: FilterQuery<Tournament> = {};

		if (organizationId) {
			where.organization = organizationId;
		}

		if (states && states.length > 0) {
			where.internalState = { $in: states };
		} else {
			where.internalState = {
				$in: [
					TournamentState.PREREGISTERING,
					TournamentState.PREPARING,
					TournamentState.ONGOING,
					TournamentState.FINISHED,
				],
			};
		}

		const options: FindOptions<Tournament> = {
			orderBy: {
				startsAt: "DESC",
			},
			populate: ["organization"] as any, // <--- C'est ici qu'on charge l'entité liée !
			refresh: true,
		};

		if (pagination && page) {
			options.limit = pagination;
			options.offset = pagination * (page - 1);
		}

		// 3. Appel unique (plus propre)
		// Cast nécessaire : FilterQuery<Tournament> produit une union trop large en MikrORM v7
		// à cause du discriminateur hérité d'Event ; le comportement reste identique.
		return this.findAndCount(where as Parameters<typeof this.findAndCount>[0], options);
	}
}
