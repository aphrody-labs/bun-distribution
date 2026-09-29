import {
	Enum,
	Format,
	MaxLength,
	MinLength,
	Nullable,
	Property,
	Required,
	Url,
} from "@tsed/schema";
import type { SeedOrdering } from "brackets-model";

import { TournamentSeries } from "@/entities";
import type { UserDTO } from "@/services";
import { MatchFormat, ScoreReportPolicy, StageType } from "@/utils/enums";

import type { OrganizationDTO } from "./organizationDTO";

/** Ts.ED edge adapter; the serialized shape is mirrored by the shared contract. */
export class NewTournamentDTO {
	@Property()
	@Required()
	@MinLength(3)
	@MaxLength(30)
	name: string;

	@Property()
	@Required()
	@MinLength(15)
	@MaxLength(1500)
	description: string;

	@Property()
	@Nullable(TournamentSeries)
	series?: TournamentSeries | null;

	@Property()
	@Required()
	organization: OrganizationDTO | number;

	@Property()
	@Required()
	managers: UserDTO[];

	@Enum(StageType)
	@Required()
	tournamentType: StageType;

	// Puissances de 2 pour brackets-manager (single/double elim)
	@Enum(4, 8, 16, 32, 64, 128, 256, 512, 1024)
	@Required()
	participantsNumber: number;

	// 🔥 LA MAGIE Ts.ED
	// 1. Le type TypeScript est Date
	// 2. @Format("date-time") valide que le JSON entrant est une ISO String
	// 3. Ts.ED convertit automatiquement la string en objet Date à la désérialisation
	@Format("date-time")
	@Required()
	startsAt: Date;

	@Format("date-time")
	@Required()
	grandFinalAt: Date;

	/**
	 * Planning automatisé (facultatif) — voir `docs/plan-tournois.md`, lot G.
	 * Absent = tournoi conduit à la main, comme avant.
	 */
	@Format("date-time")
	@Nullable(Date)
	registrationOpensAt?: Date | null;

	@Format("date-time")
	@Nullable(Date)
	registrationClosesAt?: Date | null;

	/** Démarrage automatique du tournoi à `startsAt`. */
	@Property()
	autoStart?: boolean;

	/**
	 * Qui saisit les scores : les joueurs de chaque match, ou le staff seul.
	 * Absent = `players`, le comportement d'avant l'option.
	 */
	@Enum(ScoreReportPolicy)
	@Nullable(String)
	scoreReportPolicy?: ScoreReportPolicy | null;

	/**
	 * Créer et distribuer un rôle Discord aux inscrits (case à cocher du formulaire).
	 * Réservé aux tournois organisés sur le serveur Achillea.
	 */
	@Property()
	discordRoleEnabled?: boolean;

	/**
	 * Dérogation explicite aux règles de publication (délai minimum, plafond de
	 * tournois ouverts). Vérifiée côté contrôleur : SuperAdmin uniquement.
	 */
	@Property()
	bypassRules?: boolean;

	@Property()
	groupStageEnabled: boolean;

	@Enum(StageType)
	@Nullable(StageType)
	groupStageType?: StageType | null;

	@Property()
	@Required()
	@Url() // CDN / image distante
	logo: string;

	@Property()
	@Required()
	@Url() // CDN / image distante
	affiche: string;

	/** Lien ou texte libre (le form front n'impose pas une URL). */
	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(500)
	planning: string;

	/** Lien ou texte libre (le form front n'impose pas une URL). */
	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(500)
	ruleset: string;

	@Property()
	@Required()
	seedOrdering: SeedOrdering;

	@Enum(MatchFormat)
	@Required()
	matchFormat: MatchFormat;

	@Property()
	@Nullable(Number)
	customFormatChildCount: number | null;
}
