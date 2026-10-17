/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Règles d'exécution des tâches cron : types, troncature, seuil d'alerte.
 *
 * POURQUOI CE MODULE EXISTE
 * Le démon ne tenait qu'un objet `metrics` en mémoire, perdu à chaque
 * redémarrage : impossible de dire « la sauvegarde a échoué toutes les nuits
 * depuis six semaines », ce qui s'est pourtant produit (cf. `tasks/db.ts`).
 * Les tâches tournent désormais en fonctions serverless, sans mémoire entre deux
 * appels : l'historique persisté (`public.cron_executions`) est la SEULE source
 * des échecs consécutifs, et la décision d'alerte est calculée à partir de lui.
 *
 * Ce module est volontairement PUR (aucun accès réseau, base ou disque) : la
 * lecture de l'historique vit dans `executions-postgres.ts`, l'envoi Discord
 * dans `alertes-cron.ts`. La règle anti-spam, elle, ne vit qu'ici.
 */

/** D'où vient un déclenchement. Recopié tel quel dans la colonne `origine`. */
export type OrigineExecution = "planifie" | "manuel" | "cli" | "pont";

/** Ce que l'exécuteur consigne à la fin d'une exécution. */
export interface ResultatExecution {
  nom: string;
  /** Instant de début, en millisecondes epoch. */
  debutLe: number;
  dureeMs: number;
  succes: boolean;
  /** Message d'erreur brut ; il sera tronqué avant tout stockage. */
  erreur?: string;
  origine: OrigineExecution;
  /** Vrai quand l'échec vient du délai maximal, pas de la tâche elle-même. */
  expiree?: boolean;
}

/**
 * Décision d'alerte d'une exécution terminée.
 *
 * ANTI-SPAM : la série d'échecs ne produit qu'UNE seule `alerte` (au passage du
 * seuil), et le retour à la normale exactement UNE `retablissement`. Une tâche
 * qui échoue toutes les 5 minutes pendant une nuit n'écrit donc pas 288
 * messages dans le salon.
 */
export type DecisionAlerte =
  | { type: "aucune" }
  | { type: "alerte"; nom: string; echecsConsecutifs: number; erreur: string | null }
  | { type: "retablissement"; nom: string; echecsPrecedents: number; dureeMs: number };

/** Longueur maximale conservée d'un message d'erreur (base ET alerte). */
export const LONGUEUR_ERREUR_MAX = 500;

/**
 * Nombre d'échecs consécutifs déclenchant l'alerte.
 *
 * Trois et pas un : `stats:achillea` tourne tous les quarts d'heure et dépend
 * d'un SSH vers un autre VPS ; un échec isolé est du bruit réseau, trois de
 * suite sont une panne. Réglable par `CRON_ALERTE_SEUIL_ECHECS`.
 */
export const SEUIL_ALERTE_DEFAUT = 3;

export function seuilAlerte(env: Record<string, string | undefined> = Bun.env): number {
  const brut = Number.parseInt(env.CRON_ALERTE_SEUIL_ECHECS ?? "", 10);
  return Number.isFinite(brut) && brut > 0 ? brut : SEUIL_ALERTE_DEFAUT;
}

/** Tronque un message pour la base et pour Discord, en signalant la coupe. */
export function tronquerErreur(erreur: string | undefined | null): string | null {
  if (!erreur) return null;
  const propre = erreur.replace(/\s+/g, " ").trim();
  if (propre.length === 0) return null;
  return propre.length > LONGUEUR_ERREUR_MAX ? `${propre.slice(0, LONGUEUR_ERREUR_MAX - 1)}…` : propre;
}

/**
 * Décision d'alerte d'une exécution, d'après l'historique qui la précède.
 *
 * `echecsPrecedents` compte les échecs consécutifs juste AVANT cette exécution
 * (depuis le dernier succès). L'unicité par série découle de l'arithmétique :
 * l'alerte part quand la série atteint EXACTEMENT le seuil, le rétablissement
 * quand un succès suit une série qui l'avait atteint. Aucun état à garder.
 */
export function decisionDepuisHistorique(
  resultat: Pick<ResultatExecution, "nom" | "succes" | "erreur" | "dureeMs">,
  echecsPrecedents: number,
  seuil = seuilAlerte(),
): DecisionAlerte {
  if (resultat.succes) {
    return echecsPrecedents >= seuil
      ? { type: "retablissement", nom: resultat.nom, echecsPrecedents, dureeMs: resultat.dureeMs }
      : { type: "aucune" };
  }
  const echecsConsecutifs = echecsPrecedents + 1;
  return echecsConsecutifs === seuil
    ? { type: "alerte", nom: resultat.nom, echecsConsecutifs, erreur: tronquerErreur(resultat.erreur) }
    : { type: "aucune" };
}

/** Rend une durée en français court, pour les messages d'alerte. */
export function formaterDuree(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const secondes = ms / 1000;
  if (secondes < 90) return `${secondes.toFixed(1)} s`;
  const minutes = secondes / 60;
  if (minutes < 90) return `${minutes.toFixed(1)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}
