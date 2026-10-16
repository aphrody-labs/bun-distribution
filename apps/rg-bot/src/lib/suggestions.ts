/**
 * Boîte à suggestions — le noyau, sans Discord ni base.
 *
 * ── LE VOTE N'EST PAS CHEZ NOUS ────────────────────────────────────────────
 * Une suggestion se vote, et le réflexe est d'écrire une table
 * `(suggestion, membre, valeur)`. C'est exactement ce que la ligne rouge des
 * sondages interdit (`lib/sondage-format.ts`) : une table nominative de votes,
 * chez nous, pour toujours, sur un serveur où tout le monde se connaît.
 *
 * Le vote passe donc par les RÉACTIONS Discord. Discord tient le registre ;
 * nous ne lisons que les compteurs, au moment où le staff tranche. Ce module
 * ne connaît que des NOMBRES — jamais un votant.
 *
 * ── MODULE PUR ─────────────────────────────────────────────────────────────
 * Aucune E/S, aucun `discord.js`.
 */

/** Les deux réactions de vote. Unicode : les deux bots servent deux serveurs. */
export const REACTION_POUR = "👍";
export const REACTION_CONTRE = "👎";

// ─── États ──────────────────────────────────────────────────────────────────

export const ETATS_SUGGESTION = ["ouverte", "acceptee", "refusee", "faite"] as const;

export type EtatSuggestion = (typeof ETATS_SUGGESTION)[number];

export function estEtatSuggestion(valeur: unknown): valeur is EtatSuggestion {
	return typeof valeur === "string" && (ETATS_SUGGESTION as readonly string[]).includes(valeur);
}

interface Habillage {
	libelle: string;
	/** Intention d'embed, au sens de `lib/ui/theme.ts`. */
	intention: "marque" | "succes" | "echec" | "info";
}

const HABILLAGES: Readonly<Record<EtatSuggestion, Habillage>> = Object.freeze({
	acceptee: { intention: "succes", libelle: "✅ Retenue" },
	faite: { intention: "info", libelle: "🎉 Faite" },
	ouverte: { intention: "marque", libelle: "🗳️ En vote" },
	refusee: { intention: "echec", libelle: "❌ Écartée" },
});

export function libelleEtatSuggestion(etat: string): string {
	return estEtatSuggestion(etat) ? HABILLAGES[etat].libelle : "⚪ État inconnu";
}

export function intentionEtatSuggestion(etat: string): Habillage["intention"] {
	return estEtatSuggestion(etat) ? HABILLAGES[etat].intention : "marque";
}

/**
 * Transitions permises.
 *
 * Une suggestion écartée peut être ROUVERTE : le staff change d'avis, et il ne
 * doit pas avoir à demander à l'auteur de la reproposer. Une suggestion `faite`
 * est terminale — ce qui est fait est fait.
 */
const TRANSITIONS: Readonly<Record<EtatSuggestion, readonly EtatSuggestion[]>> = Object.freeze({
	acceptee: ["faite", "refusee", "ouverte"],
	faite: [],
	ouverte: ["acceptee", "refusee"],
	refusee: ["ouverte", "acceptee"],
});

export function transitionSuggestionPermise(depuis: string, vers: string): boolean {
	if (!estEtatSuggestion(depuis) || !estEtatSuggestion(vers)) {
		return false;
	}
	return TRANSITIONS[depuis].includes(vers);
}

export function refusTransitionSuggestion(depuis: string, vers: string): string {
	if (depuis === "faite") {
		return "Cette suggestion est marquée comme faite : il n'y a plus rien à décider.";
	}
	if (depuis === vers) {
		return `Cette suggestion est déjà « ${libelleEtatSuggestion(depuis)} ».`;
	}
	return `Passage impossible de « ${libelleEtatSuggestion(depuis)} » à « ${libelleEtatSuggestion(vers)} ».`;
}

// ─── Texte ──────────────────────────────────────────────────────────────────

export const LONGUEUR_SUGGESTION = 1_000;
export const LONGUEUR_MOTIF_SUGGESTION = 500;
/** En dessous, ce n'est pas une suggestion : c'est un message. */
export const LONGUEUR_MINIMALE = 12;

function nettoyer(brut: unknown, limite: number): string | null {
	if (typeof brut !== "string") {
		return null;
	}
	// Les retours à la ligne sont CONSERVÉS (contrairement au sujet d'un ticket) :
	// une suggestion argumentée en a besoin, et elle vit dans une description
	// d'embed, qui les accepte.
	const propre = brut.replaceAll(/[ \t]+/g, " ").trim();
	if (propre.length === 0) {
		return null;
	}
	return propre.length <= limite ? propre : `${propre.slice(0, limite - 1)}…`;
}

export type ResultatProposition =
	| { ok: true; texte: string }
	| { ok: false; erreur: string };

/**
 * Valide une proposition.
 *
 * La longueur MINIMALE est la seule règle un peu sévère, et elle est là pour
 * une raison : une boîte à suggestions qui accepte « plus d'emojis » devient
 * une liste de phrases qu'on ne peut ni discuter ni mettre en œuvre, et le
 * staff cesse de la lire.
 */
export function validerProposition(brut: unknown): ResultatProposition {
	const texte = nettoyer(brut, LONGUEUR_SUGGESTION);
	if (!texte) {
		return { erreur: "Écris ta suggestion : le champ est vide.", ok: false };
	}
	if (texte.length < LONGUEUR_MINIMALE) {
		return {
			erreur:
				`Trop courte (${texte.length} caractères, ${LONGUEUR_MINIMALE} minimum). ` +
				"Dis ce que tu proposes ET pourquoi — c'est ce qui permet d'en discuter.",
			ok: false,
		};
	}
	return { ok: true, texte };
}

export function motifSuggestionPropre(brut: unknown): string | null {
	return nettoyer(brut, LONGUEUR_MOTIF_SUGGESTION);
}

// ─── Numérotation et affichage ──────────────────────────────────────────────

export function prochainNumeroSuggestion(dernier: number | null | undefined): number {
	const valeur = typeof dernier === "number" && Number.isFinite(dernier) ? Math.floor(dernier) : 0;
	return Math.max(1, valeur + 1);
}

export function referenceSuggestion(numero: number): string {
	const borne = Number.isFinite(numero) ? Math.max(0, Math.floor(numero)) : 0;
	return `#${String(borne).padStart(3, "0")}`;
}

/**
 * Score d'une suggestion, à partir des compteurs de réactions.
 *
 * ── LE MOINS UN QUI COMPTE ─────────────────────────────────────────────────
 * Le bot pose lui-même les deux réactions pour amorcer le vote : ses propres
 * clics sont donc dans les compteurs, et il faut les retirer. Sans ça, une
 * suggestion sans aucun vote humain s'affiche « 1 pour, 1 contre » — et une
 * suggestion à 3 pour / 0 contre paraît à 4/1.
 */
export function score(pour: number, contre: number, botAReagi = true): {
	pour: number;
	contre: number;
	total: number;
	ecart: number;
} {
	const retrait = botAReagi ? 1 : 0;
	const p = Math.max(0, Math.floor(pour) - retrait);
	const c = Math.max(0, Math.floor(contre) - retrait);
	return { contre: c, ecart: p - c, pour: p, total: p + c };
}

/** `12 pour · 3 contre · +9` — la ligne de résultat, toujours la même. */
export function libelleScore(resultat: ReturnType<typeof score>): string {
	const signe = resultat.ecart > 0 ? "+" : "";
	return `${REACTION_POUR} ${resultat.pour} · ${REACTION_CONTRE} ${resultat.contre} · ${signe}${resultat.ecart}`;
}
