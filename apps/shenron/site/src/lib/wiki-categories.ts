// SPDX-License-Identifier: Apache-2.0

/**
 * Source unique des catégories de l'univers wiki (client-safe — aucun import
 * server-only). Partagée par `WikiCategoryNav` (server, pages d'index) et
 * `UniverseTabs` (client, page Univers) pour éviter la divergence des listes.
 * `countKey` mappe sur `dbUniverse.counts()`.
 *
 * `group` : `"media"` = les SUPPORTS, en lien direct dans la barre principale
 * (films, épisodes, chronologie, manga, databooks, jeux) → on ne les re-liste
 * pas dans la nav du wiki, ce serait un doublon. `"encyclopedia"` = les notions
 * de la fiction, regroupées dans l'unique déroulant « Univers » de la barre et
 * surfacées ici. Ce découpage est le même que celui de `NavGroup`
 * (`lib/wiki-launch.ts`) : deux listes qui divergent, c'est une rubrique qui
 * disparaît des deux côtés.
 */
export type WikiCategory = {
	key: string;
	label: string;
	href: string;
	countKey: string;
	group: "encyclopedia" | "media";
};

export const WIKI_CATEGORIES: WikiCategory[] = [
	{
		key: "personnages",
		label: "Personnages",
		href: "/wiki/personnages",
		countKey: "characters",
		group: "encyclopedia",
	},
	{ key: "races", label: "Races", href: "/wiki/races", countKey: "races", group: "encyclopedia" },
	{
		key: "transformations",
		label: "Transformations",
		href: "/wiki/transformations",
		countKey: "transformations",
		group: "encyclopedia",
	},
	{
		key: "techniques",
		label: "Techniques",
		href: "/wiki/techniques",
		countKey: "techniques",
		group: "encyclopedia",
	},
	{ key: "sagas", label: "Sagas", href: "/wiki/sagas", countKey: "sagas", group: "encyclopedia" },
	{
		key: "puissances",
		label: "Puissances & Scouter",
		href: "/wiki/puissances",
		countKey: "powerLevels",
		group: "encyclopedia",
	},
	{
		key: "objets",
		label: "Objets & Technologies",
		href: "/wiki/objets",
		countKey: "items",
		group: "encyclopedia",
	},
	{
		key: "lieux",
		label: "Lieux & Sanctuaires",
		href: "/wiki/lieux",
		countKey: "locations",
		group: "encyclopedia",
	},
	{
		key: "evenements",
		label: "Événements",
		href: "/wiki/evenements",
		countKey: "timelineEvents",
		group: "media",
	},
	{
		key: "musiques",
		label: "Musiques & OST",
		href: "/wiki/musiques",
		countKey: "soundtracks",
		group: "media",
	},
	{ key: "films", label: "Films", href: "/wiki/films", countKey: "movies", group: "media" },
	{
		key: "episodes",
		label: "Épisodes",
		href: "/wiki/episodes",
		countKey: "episodes",
		group: "media",
	},
	{ key: "manga", label: "Manga", href: "/wiki/manga", countKey: "mangaVolumes", group: "media" },
	{ key: "jeux", label: "Jeux", href: "/wiki/jeux", countKey: "games", group: "media" },
	{
		key: "databooks",
		label: "Databooks",
		href: "/wiki/databooks",
		countKey: "databooks",
		group: "media",
	},
];

/** Catégories à surfacer dans la nav du wiki (hors navbar → pas de doublon). */
export const ENCYCLOPEDIA_CATEGORIES = WIKI_CATEGORIES.filter((c) => c.group === "encyclopedia");
