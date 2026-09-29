/**
 * site-menu — les destinations du menu mobile.
 *
 * La barre du bas garde une liste FIXE de quatre entrées : elles portent chacune
 * un glyphe dessiné et une position musculaire (le pouce les atteint sans
 * regarder). Ce n'est pas une liste de rubriques, c'est un organe de navigation.
 *
 * En revanche la feuille « Plus » est **dérivée de la carte du site**
 * (`lib/site-map.ts`) : c'était une liste écrite à la main, et elle avait
 * divergé — ni `/wiki/personnages`, ni `/wiki/contribuer`, ni le fil d'actualité
 * n'y figuraient, alors que des rubriques refermées y restaient. Désormais, une
 * rubrique ouverte depuis `/admin/lancement` apparaît dans le menu sans toucher
 * à ce fichier.
 *
 * Client-safe : `site-map` ne lit ni base ni secret, et le filtrage par accès
 * réel reste à la charge de l'appelant (la feuille « Plus » est rendue dans un
 * îlot client, qui ne peut pas lire la configuration d'accès).
 */
import { destinationsOf, type Journey } from "@/lib/site-map";

export const MOBILE_PRIMARY_DESTINATIONS = [
	{ href: "/", label: "Accueil" },
	{ href: "/wiki", label: "Wiki" },
	{ href: "/wiki/episodes", label: "Épisodes" },
	{ href: "/wiki/films", label: "Films" },
] as const;

/** Parcours présentés dans la feuille « Plus », dans cet ordre. */
const MORE_JOURNEYS: readonly Journey[] = [
	"encyclopedie",
	"archives",
	"oeuvres",
	"communaute",
	"participer",
	"espace",
];

const PRIMARY_HREFS = new Set<string>(MOBILE_PRIMARY_DESTINATIONS.map((d) => d.href));

export interface MenuDestination {
	href: string;
	label: string;
	/** Phrase de situation affichée sous le libellé. */
	note: string;
}

/**
 * Le reste des rubriques. Les quatre entrées de la barre du bas sont retirées
 * (elles seraient présentées deux fois), et l'espace membre est conservé : la
 * feuille est le seul endroit où un mobile atteint `/dashboard`.
 */
export const MOBILE_MORE_DESTINATIONS: readonly MenuDestination[] = MORE_JOURNEYS.flatMap((j) =>
	destinationsOf(j)
		.filter(
			(d) =>
				!PRIMARY_HREFS.has(d.href) &&
				d.audience !== "staff" &&
				d.href !== "/sources/dragon-ball"
		)
		.map((d) => ({ href: d.href, label: d.label, note: d.blurb ?? "" }))
);

export const MOBILE_MENU_DESTINATIONS: readonly MenuDestination[] = [
	...MOBILE_PRIMARY_DESTINATIONS.map((d) => ({ href: d.href, label: d.label, note: "" })),
	...MOBILE_MORE_DESTINATIONS,
];
