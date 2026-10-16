import type { UserRole } from "../enums/userRole";

import type { SessionRankDTO } from "./user";

/** Alias historique de `SessionRankDTO` (mêmes champs, même origine). */
export type SuggestionRank = SessionRankDTO;

/** Entrée d'autocomplétion globale (barre de recherche clans + joueurs). */
export interface Suggestion {
	id: string;
	type: "clan" | "user";
	label: string;
	sim: number;
	clanShortName?: string;
	avatar?: string;
	soloRank: SuggestionRank;
	duoRank: SuggestionRank;
	lastInteract?: Date;
	role?: UserRole;
	currentLevel?: number;
	totalXp?: number;
	hasTwitch?: boolean;
	hasChallonge?: boolean;
	hasYoutube?: boolean;
}
