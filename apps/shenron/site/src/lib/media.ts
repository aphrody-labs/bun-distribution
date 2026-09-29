/**
 * Helpers médias PURS et client-safe (aucun import server) — partagés par les
 * pages films/épisodes/chronologie et leurs modales d'aperçu.
 */

/**
 * Retire les mentions de source du dataset (« (Source : ANN) », « [Écrit par
 * MAL Rewrite] », « (Sources: Wikipédia) »…) en fin de synopsis. Boucle pour les
 * balises empilées. À appliquer AUSSI aux épisodes (pas seulement aux films).
 */
export function stripSourceTags(s: string | null | undefined): string | null {
	if (!s) return s ?? null;
	let out = s;
	let prev: string;
	do {
		prev = out;
		// Emphase markdown optionnelle autour du parenthétique : `_(Source : Kitsu.)_`,
		// `*(…)*`, `**(…)**` ou nu `(…)`. Ancré en fin de chaîne.
		out = out.replace(
			/\s*[_*]{0,2}\s*[([]\s*(?:sources?|écrit par)[^)\]]*[)\]]\s*[_*]{0,2}\s*$/i,
			""
		);
	} while (out !== prev);
	return out.trimEnd();
}

type Player = { lang?: "vf" | "vostfr" };

/**
 * Disponibilité VF/VOSTFR depuis la colonne jsonb `players`. **Garde
 * `Array.isArray`** : `players` peut être un scalaire corrompu (piège jsonb
 * documenté) — `(x ?? []).some` planterait alors tout le rendu (500 films,
 * notFound chronologie, erreur streamée post-shell épisodes). Ici : dégradation
 * silencieuse (pas de badge) plutôt que crash.
 */
export function langBadges(players: unknown): { hasVf: boolean; hasVostfr: boolean } {
	const arr = Array.isArray(players) ? (players as Player[]) : [];
	return {
		hasVf: arr.some((p) => p?.lang === "vf"),
		hasVostfr: arr.some((p) => p?.lang === "vostfr"),
	};
}
