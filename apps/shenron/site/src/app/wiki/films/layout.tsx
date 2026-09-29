/**
 * Layout du catalogue Films avec un SLOT PARALLÈLE `@modal`. Combiné à la route
 * d'interception `@modal/(.)[slug]`, cliquer une affiche depuis `/wiki/films`
 * ouvre l'aperçu en modale par-dessus le catalogue (le `children` = catalogue
 * reste monté). Accès direct / rechargement de `/wiki/films/[slug]` = fiche
 * pleine page (le slot rend `default.tsx` → null). Pass-through, aucun style.
 */
export default function FilmsLayout({
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
