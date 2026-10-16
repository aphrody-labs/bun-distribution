import type { ClanMemberDistinction, ClanMemberRole } from "../enums/clanMemberRole";
import type { MatchMode } from "../enums/eventEnums";
import type { UserRole } from "../enums/userRole";

/** Palier de rang tel qu'exposé sur un profil (clé FR + dégradé d'affichage). */
export interface RankDTO {
	elo: number;
	key: string;
	gradient: string[];
}

export interface UserDTO {
	id: string;
	/**
	 * Discriminant d'entité, présent sur les fiches publiques et absent de la
	 * session : optionnel pour que `SessionUserDTO` reste assignable.
	 */
	type?: string;
	username: string;
	/** Canonical Rose Griffon public profile slug when the Discord account is linked. */
	rgProfileUsername?: string;
	/**
	 * Champs présents uniquement sur la session de l'utilisateur courant.
	 *
	 * `GET /clans` imbrique un président réduit (identité et profil public) qui
	 * ne les porte pas. Les exiger faisait échouer la validation de la réponse
	 * ENTIÈRE, donc de tous les clans.
	 */
	sim?: number;
	avatar?: string;
	/**
	 * L'API historique sérialise l'absence de clan en `null` (et non en champ
	 * absent). Les deux formes sont donc recevables dans le contrat partagé.
	 */
	clanId?: number | null;
	soloRank?: RankDTO;
	duoRank?: RankDTO;
	lastInteract?: Date;
	role?: UserRole;
	currentLevel?: number;
	totalXp?: number;
	hasTwitch?: boolean;
	hasChallonge?: boolean;
	hasYoutube?: boolean;
}

export interface RankedModeStats {
	mode: MatchMode;
	total: number;
	wins: number;
	losses: number;
	draws: number;
	goalsScored: number;
	goalsReceived: number;
}

/** Stats agrégées d'un mode de compétition (interclans / tournois). */
export interface CompetitionStats {
	/** Nombre d'événements distincts (tournois / interclans) auxquels le joueur a participé. */
	total: number;
	/** Victoires d'équipe / de clan (contrib). */
	wins: number;
	/** Défaites d'équipe / de clan (contrib). */
	losses: number;
	/** Nuls d'équipe (si applicable). */
	draws: number;
	goalsScoredAvg: number;
	goalsReceivedAvg: number;
	/** Matchs individuels joués. */
	personalTotal: number;
	personalWins: number;
	personalLosses: number;
	personalDraws: number;
}

/** Appartenance de clan résumée, telle qu'embarquée dans un profil enrichi. */
export interface UserClanSummary {
	id: number;
	shortenedName: string;
	name: string;
	avatarUrl?: string;
	role: ClanMemberRole;
	distinctions: ClanMemberDistinction[];
}

export type EnrichedUserDTO = UserDTO & {
	clan?: UserClanSummary;
	interclans: CompetitionStats;
	/** Stats de matchs de tournoi (brackets / swiss). */
	tournaments: CompetitionStats;
	ranked: {
		solo: RankedModeStats;
		duo: RankedModeStats;
	};
	/** Éditable par le titulaire du profil (PUT /users/me/profile). */
	bio: string | null;
	twitchUrl: string | null;
};

/** Champs modifiables par le titulaire du profil. */
export interface UpdateUserProfilePayload {
	bio?: string | null;
	twitchUrl?: string | null;
}

/**
 * Utilisateur de session — ce que renvoie `/auth/me`.
 *
 * Même forme que `UserDTO` : l'API sert le même objet, `type` en moins. Alias
 * plutôt que type distinct, pour qu'un utilisateur de session puisse alimenter
 * n'importe quelle référence utilisateur (organisateur, manager, propriétaire).
 */
export type SessionUserDTO = UserDTO;

/** Rang tel qu'embarqué dans une session ou une suggestion. */
export type SessionRankDTO = RankDTO;

/** Vue minimale d'un utilisateur (avatar + libellé), suffisante pour une liste. */
export interface UserRef {
	id: string;
	username: string;
	displayName?: string;
	avatar?: string | null;
}

/** Identité affichable d'un joueur dans un rendu 2D/3D ou un classement. */
export interface User {
	id: string;
	name: string;
	rank: Rank;
	logo: string;
}

/** Palier de classement nommé (bornes Elo + dégradé). */
export interface Rank {
	label: string;
	minElo: number;
	maxElo: number;
	gradient: string[];
}
