/**
 * Signalement des échecs d'appel à l'API Achilléa.
 *
 * POURQUOI CE FICHIER EXISTE
 * Les pages Achilléa faisaient toutes `.catch(() => {})`, et ne testaient que
 * `if (res.ok)` sans branche `else`. Conséquence mesurée en production : les
 * schémas de validation du client ne correspondaient plus à ce que l'API
 * renvoie — 42 clans, 9 tournois, 1 109 joueurs classés et une saison entière
 * de ligue étaient REJETÉS côté client, et les pages affichaient « 0 clan
 * trouvé », « Aucun tournoi », « 0 joueur classé ».
 *
 * Le plus coûteux n'était pas le défaut : c'était son invisibilité. Console
 * vide, aucune requête en échec, aucun indicateur. Le site paraissait
 * simplement désert, et personne ne pouvait faire la différence entre « il n'y
 * a rien » et « on n'arrive pas à le lire ».
 *
 * Toute lecture qui échoue passe désormais par ici.
 */

/** Forme minimale d'un résultat du client Achilléa. */
interface ResultatEchec {
	ok: false;
	kind?: string;
	detail?: unknown;
	status?: number;
}

/**
 * Journalise un échec de lecture, et rend un message affichable.
 *
 * Le message rendu distingue les trois causes que l'utilisateur peut
 * comprendre — connexion requise, service indisponible, réponse inattendue —
 * parce qu'elles n'appellent pas la même réaction de sa part. Le détail
 * technique, lui, va dans la console : c'est là qu'on le cherche.
 */
export function signalerEchec(contexte: string, resultat: unknown): string {
	const echec = resultat as ResultatEchec;
	const genre = echec?.kind ?? "inconnu";

	console.error(`[achillea] ${contexte} — échec (${genre})`, echec?.detail ?? echec);

	if (genre === "unauthorized" || echec?.status === 401) {
		return "Connecte-toi pour voir ces données.";
	}
	if (genre === "invalid_response") {
		// Ce cas précis veut dire que le serveur a répondu, mais que le contrat
		// du client ne décrit plus sa réponse. Le dire explicitement évite de
		// chercher une panne réseau qui n'existe pas.
		return "Le service a répondu dans un format inattendu. Les données existent mais n'ont pas pu être lues.";
	}
	if (genre === "network" || genre === "timeout") {
		return "Service momentanément injoignable.";
	}
	return "Impossible de charger ces données pour le moment.";
}

/** Variante pour un `catch` : journalise l'exception et rend un message. */
export function signalerException(contexte: string, cause: unknown): string {
	console.error(`[achillea] ${contexte} — exception`, cause);
	return "Impossible de charger ces données pour le moment.";
}
