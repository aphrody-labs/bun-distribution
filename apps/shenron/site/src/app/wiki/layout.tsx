export default function WikiLayout({ children }: { children: React.ReactNode }) {
	// Une seule racine pour les 52 routes du wiki : les pages gardent leur
	// composition propre (grille, lecteur, fiche), mais héritent toutes du même
	// fond, de la même cadence et des mêmes variables de conteneur. Le sidebar
	// reste absent : il doublonnerait le menu principal.
	return <div data-wiki-surface>{children}</div>;
}
