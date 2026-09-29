// SPDX-License-Identifier: Apache-2.0
import { decideAccess } from "@shenron/auth/policy";

/**
 * Droit de contribution — constantes **client-safe** (aucun import server-only).
 *
 * Qui a le droit de proposer une correction, et sur quoi. Jusqu'ici la réponse
 * était en dur : « tout membre connecté », sur le wiki seulement. Un admin doit
 * pouvoir la restreindre à des rôles Discord ou à des personnes nommées — par
 * exemple ouvrir les databooks à une petite équipe de relecture pendant que le
 * wiki reste ouvert à tous.
 */

/** Périmètres réglables séparément. */
export const CONTRIBUTION_SCOPES = ["wiki", "databooks"] as const;
export type ContributionScope = (typeof CONTRIBUTION_SCOPES)[number];

export const SCOPE_LABELS: Record<ContributionScope, { label: string; hint: string }> = {
	wiki: {
		label: "Wiki",
		hint: "Fiches personnages, planètes, races, sagas, techniques, films, épisodes, jeux…",
	},
	databooks: {
		label: "Databooks",
		hint: "Fiches d'ouvrage et transcriptions des planches japonaises.",
	},
};

/**
 * `members`    → tout visiteur connecté (le comportement historique).
 * `restricted` → uniquement les porteurs d'un rôle listé OU les comptes listés.
 * `admin`      → personne hors staff (les admins éditent déjà en direct).
 */
export type ContributionMode = "members" | "restricted" | "admin";

export const MODE_LABELS: Record<ContributionMode, { label: string; hint: string }> = {
	members: {
		label: "Tous les membres connectés",
		hint: "N'importe quel compte Discord lié peut proposer une correction.",
	},
	restricted: {
		label: "Rôles ou comptes choisis",
		hint: "Seuls les porteurs d'un des rôles, ou les comptes nommés, peuvent proposer.",
	},
	admin: {
		label: "Personne (staff seulement)",
		hint: "Le bouton disparaît pour le public. Le staff continue d'éditer en direct.",
	},
};

export interface ScopeRule {
	mode: ContributionMode;
	/** Rôles Discord autorisés — signifiant uniquement en mode `restricted`. */
	roleIds: string[];
	/**
	 * Comptes Discord autorisés nommément — idem. On stocke l'identifiant
	 * **Discord** et non celui du compte du site : c'est ce que le sélecteur de
	 * l'admin sait désigner (il pioche dans les membres du serveur), et le site
	 * connaît le `discordId` de chaque session.
	 */
	discordIds: string[];
}

export type ContributionRights = Record<ContributionScope, ScopeRule>;

export const DEFAULT_SCOPE_RULE: ScopeRule = { mode: "members", roleIds: [], discordIds: [] };

export const DEFAULT_CONTRIBUTION_RIGHTS: ContributionRights = {
	wiki: { ...DEFAULT_SCOPE_RULE },
	databooks: { ...DEFAULT_SCOPE_RULE },
};

/** Périmètre dont relève une cible (table, colonne). */
export function scopeOf(table: string): ContributionScope {
	return table === "db_databooks" ? "databooks" : "wiki";
}

/**
 * Décision pure — testable sans DB ni session.
 *
 * `isAdmin` court-circuite tout : le staff n'a pas à se donner un rôle pour
 * relire son propre wiki. Le mode `restricted` est un OU, pas un ET : un rôle
 * suffit, un compte nommé suffit ; exiger les deux rendrait la liste de comptes
 * inutilisable pour quelqu'un qui n'est pas sur le serveur Discord.
 */
export function decideContribution(
	rule: ScopeRule,
	visitor: {
		isAdmin: boolean;
		authenticated: boolean;
		discordId?: string | null;
		roleIds?: string[];
	}
): boolean {
	// `restricted` sans rôle ni compte nommé ne laisse passer personne hors staff.
	return decideAccess(rule, visitor, { emptyRoles: "deny" }) === "allow";
}
