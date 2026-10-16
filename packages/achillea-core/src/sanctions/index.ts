/**
 * Règles d'auto-escalade des sanctions (logique pure).
 *
 * Identique à `SanctionService.escalate` du bot, isolée du stockage : le
 * service bot compte les avertissements actifs (sur 30 jours) puis délègue la
 * décision d'escalade ici.
 */

import { SanctionType } from "@rosegriffon/achillea-types";

/** Fenêtre d'observation des avertissements pour l'escalade (30 jours, en secondes). */
export const ESCALATION_WINDOW_SEC = 30 * 24 * 60 * 60;

/** Décision d'escalade : type de sanction à appliquer + durée (secondes). */
export interface EscalationDecision {
	type: SanctionType;
	/** Durée de la sanction en secondes (`null` = permanente). */
	durationSec: number | null;
}

/** Un palier d'escalade : `threshold` avertissements actifs → `decision`. */
export interface EscalationTier {
	threshold: number;
	decision: EscalationDecision;
}

/**
 * Barème d'escalade Achilléa (du plus sévère au moins sévère) :
 *   8 warns actifs → ban 7 jours
 *   5 warns actifs → mute 24h
 *   3 warns actifs → mute 1h
 */
export const ESCALATION_TIERS: readonly EscalationTier[] = [
	{ threshold: 8, decision: { type: SanctionType.Ban, durationSec: 7 * 24 * 60 * 60 } },
	{ threshold: 5, decision: { type: SanctionType.Mute, durationSec: 24 * 60 * 60 } },
	{ threshold: 3, decision: { type: SanctionType.Mute, durationSec: 60 * 60 } },
] as const;

/**
 * Évalue l'escalade à appliquer pour un nombre d'avertissements actifs.
 * Retourne la décision du palier le plus élevé atteint, ou `null` si aucun
 * seuil n'est franchi.
 *
 * @param activeWarns Nombre d'avertissements actifs dans la fenêtre d'observation.
 */
export function evaluateEscalation(activeWarns: number): EscalationDecision | null {
	for (const tier of ESCALATION_TIERS) {
		if (activeWarns >= tier.threshold) return tier.decision;
	}
	return null;
}
