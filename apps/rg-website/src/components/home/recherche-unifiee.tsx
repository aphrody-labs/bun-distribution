"use client";

import { UnifiedSearchBar } from "@rosegriffon/app-shell";

/**
 * Barre de recherche de l'accueil — les trois domaines, sans quitter la page.
 *
 * `@rosegriffon/search` portait déjà la requête unifiée (articles, wiki,
 * e-sport en un seul `UNION ALL`), testée, et n'était appelé nulle part : la
 * barre du chrome se contentait de rediriger vers `/search`, qui
 * réimplémentait sa propre recherche par domaine.
 *
 * Ici les résultats arrivent pendant la frappe. `Entrée` mène toujours à
 * `/search` pour la liste complète — la boîte de l'accueil montre les douze
 * premiers, pas tout.
 */

export function RechercheUnifiee() {
	return (
		<UnifiedSearchBar
			placeholder="Chercher un joueur, une technique, un clan, un article…"
			className="h-11 max-w-none bg-surface-container-high/90"
		/>
	);
}
