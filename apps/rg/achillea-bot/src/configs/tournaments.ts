import {
	DEFAULT_MAX_OPEN_TOURNAMENTS_PER_ORG,
	DEFAULT_PUBLICATION_WINDOW,
} from "@rosegriffon/achillea-core";

/**
 * Règles de création des tournois — les `X` laissés ouverts par le cadrage.
 *
 * Surchargeables par variables d'environnement pour être ajustées sans redéploiement
 * de code (le cadrage annonçait « on rentrera plus dans les détails dès qu'on voudra
 * le dev » : figer les valeurs en dur obligerait à un cycle complet à chaque essai).
 */
function positiveNumber(raw: string | undefined, fallback: number): number {
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const tournamentRulesConfig = {
	publicationWindow: {
		minLeadDays: positiveNumber(
			process.env.TOURNAMENT_MIN_LEAD_DAYS,
			DEFAULT_PUBLICATION_WINDOW.minLeadDays
		),
		maxLeadDays: positiveNumber(
			process.env.TOURNAMENT_MAX_LEAD_DAYS,
			DEFAULT_PUBLICATION_WINDOW.maxLeadDays
		),
	},
	maxOpenTournamentsPerOrganization: positiveNumber(
		process.env.TOURNAMENT_MAX_OPEN_PER_ORG,
		DEFAULT_MAX_OPEN_TOURNAMENTS_PER_ORG
	),
};
