/** Substitutions autorisées dans le message d'accueil configurable. */
export function remplirGabarit(
	gabarit: string,
	valeurs: { membre: string; serveur: string; compte: number }
): string {
	return gabarit
		.replaceAll("{membre}", valeurs.membre)
		.replaceAll("{serveur}", valeurs.serveur)
		.replaceAll("{compte}", String(valeurs.compte));
}
