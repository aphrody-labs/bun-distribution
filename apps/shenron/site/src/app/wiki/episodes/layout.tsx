/**
 * Layout du catalogue Épisodes avec slot parallèle `@modal` + route
 * d'interception `@modal/(.)[id]` : cliquer une vignette depuis la landing
 * `/wiki/episodes` (statique) ou une vue série `/wiki/episodes/serie/[series]`
 * (statique) ouvre l'aperçu en modale sans quitter le catalogue. Accès
 * direct/refresh de `/wiki/episodes/[id]` = fiche pleine page. Cf.
 * `wiki/films/layout.tsx`. L'interception ne marche QUE parce que ces routes
 * sont statiques (pas de `searchParams`).
 */
export default function EpisodesLayout({
	children,
	modal,
}: {
	children: React.ReactNode;
	modal: React.ReactNode;
}) {
	return (
		<>
			{children}
			{modal}
		</>
	);
}
