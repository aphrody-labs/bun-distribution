/**
 * PFC (Pierre-Feuille-Ciseaux) — logique pure, sans dépendance Discord.
 * Utilisé à la fois par :
 *   - la commande slash `/pfc` (apps/shenron/bot/src/commands/games/Pfc.ts)
 *   - l'endpoint REST `POST /api/games/pfc/play` (depuis le site)
 *
 * Mêmes règles, mêmes constantes économiques, source de vérité unique.
 */

export type PfcChoice = "pierre" | "feuille" | "ciseaux";

export const PFC_CHOICES = ["pierre", "feuille", "ciseaux"] as const;

const BEATS: Record<PfcChoice, PfcChoice> = {
	pierre: "ciseaux",
	feuille: "pierre",
	ciseaux: "feuille",
};

export type PfcResult = "win" | "lose" | "draw";

/** Décide le coup du bot adverse (uniform random). */
export function decideBotChoice(): PfcChoice {
	return PFC_CHOICES[Math.floor(Math.random() * PFC_CHOICES.length)]!;
}

/** Résout un round : retourne le résultat du point de vue de `player`. */
export function resolvePfc(player: PfcChoice, opponent: PfcChoice): PfcResult {
	if (player === opponent) return "draw";
	return BEATS[player] === opponent ? "win" : "lose";
}

/** Vrai si `choice` est une valeur PfcChoice valide (pour les inputs API). */
export function isPfcChoice(choice: unknown): choice is PfcChoice {
	return typeof choice === "string" && (PFC_CHOICES as readonly string[]).includes(choice);
}
