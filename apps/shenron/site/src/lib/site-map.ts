/**
 * site-map — la carte du site, **dérivée** du registre d'accès, jamais recopiée.
 *
 * Le problème résolu ici : la liste des destinations du site existait en cinq
 * exemplaires divergents — `lib/wiki-launch.ts` (le registre d'accès, seul à
 * jour), `components/SiteFooter.tsx` (trois colonnes écrites en dur),
 * `lib/site-menu.ts` (menu mobile), `app/sitemap.ts` (deux tableaux de chemins
 * figés) et la home. Ouvrir une rubrique depuis `/admin/lancement` la faisait
 * apparaître dans la nav… mais pas au sitemap, pas au pied de page, pas dans le
 * menu mobile. Inversement, le pied de page annonçait des rubriques refermées.
 *
 * Règle posée : **`ALL_ENTRIES` (wiki-launch) est la source de vérité des
 * rubriques**, et ce module n'y ajoute que ce que le registre ne peut pas porter
 * — les pages qui ne sont pas *gatables* (mentions légales, espace membre,
 * documentation d'API) et l'ordre de présentation par parcours.
 *
 * Client-safe : aucun import server-only, aucun accès base. Le filtrage par
 * accès réel se fait par l'appelant avec `isPathPublic()`, exactement comme la
 * nav et le sitemap le font déjà.
 */
import { ALL_ENTRIES, type LaunchCategory } from "@/lib/wiki-launch";

/**
 * Parcours du site — les grandes intentions d'un visiteur, dans l'ordre où on
 * les lui propose. Ce ne sont pas des dossiers d'URL : `/news` et `/tierlists`
 * vivent à la racine mais appartiennent au parcours « communauté ».
 */
const JOURNEYS = [
	"decouvrir",
	"encyclopedie",
	"oeuvres",
	"archives",
	"communaute",
	"participer",
	"espace",
	"legal",
] as const;
export type Journey = (typeof JOURNEYS)[number];

export interface JourneyMeta {
	key: Journey;
	label: string;
	/** Ce que le visiteur vient y chercher — sert de chapô de section. */
	blurb: string;
}

const JOURNEY_META: Record<Journey, JourneyMeta> = {
	decouvrir: {
		key: "decouvrir",
		label: "Découvrir",
		blurb: "Les portes d'entrée du site : l'accueil, la recherche, une fiche au hasard.",
	},
	encyclopedie: {
		key: "encyclopedie",
		label: "Encyclopédie",
		blurb: "Les fiches de fond : personnages, races, transformations, techniques, lieux.",
	},
	oeuvres: {
		key: "oeuvres",
		label: "Œuvres & diffusion",
		blurb: "Ce qui se regarde : épisodes, films, jeux, et la chronologie qui les relie.",
	},
	archives: {
		key: "archives",
		label: "Livres & archives",
		blurb: "Les sources : manga, databooks officiels, mots de Toriyama et doctrine canon.",
	},
	communaute: {
		key: "communaute",
		label: "Communauté",
		blurb: "L'actualité, les classements, les tier lists, la boutique et les mini-jeux.",
	},
	participer: {
		key: "participer",
		label: "Participer",
		blurb: "Corriger une fiche, proposer une source, écrire avec la communauté.",
	},
	espace: {
		key: "espace",
		label: "Mon espace",
		blurb: "Profil, favoris, progression et réglages du compte.",
	},
	legal: {
		key: "legal",
		label: "Le site",
		blurb: "À propos, sources, licence et confidentialité.",
	},
};

/** Public visé par une destination — conditionne son annonce aux moteurs. */
type Audience = "public" | "member" | "staff";

export interface SiteDestination {
	href: string;
	label: string;
	blurb?: string;
	journey: Journey;
	audience: Audience;
	/** Clé du registre d'accès quand la destination en dépend. */
	entryKey?: string;
	/** Priorité sitemap (0 = hors sitemap : page privée ou sans valeur d'index). */
	priority: number;
	/** Fréquence de changement annoncée au sitemap. */
	changeFrequency?: "daily" | "weekly" | "monthly" | "yearly";
	/** Lien externe (Discord) — hors sitemap, hors gating. */
	external?: boolean;
}

/**
 * Rattachement d'une famille de navigation du registre à un parcours. Le
 * registre raisonne en « où le montrer dans le menu », la carte en « que vient
 * chercher le visiteur » : les deux coïncident presque, `communaute` près.
 */
const GROUP_TO_JOURNEY: Record<string, Journey> = {
	wiki: "encyclopedie",
	univers: "encyclopedie",
	oeuvres: "oeuvres",
	archives: "archives",
	communaute: "communaute",
};

/** Rubriques du registre qui relèvent de la participation, pas de la détente. */
const PARTICIPATION_KEYS = new Set(["modifications", "contribuer", "corriger", "tools"]);

/** Destinations hors registre : elles ne sont pas refermables, donc pas gatables. */
const EXTRA_DESTINATIONS: readonly SiteDestination[] = [
	{
		href: "/",
		label: "Accueil",
		blurb: "Le sommaire vivant du site.",
		journey: "decouvrir",
		audience: "public",
		priority: 1,
		changeFrequency: "daily",
	},
	{
		href: "/plan-du-site",
		label: "Plan du site",
		blurb: "Toutes les destinations, parcours par parcours.",
		journey: "decouvrir",
		audience: "public",
		priority: 0.3,
		changeFrequency: "monthly",
	},
	{
		href: "/news/fil",
		label: "Fil d'actualité",
		blurb: "Les parutions de la rédaction et les discussions, dans l'ordre où elles arrivent.",
		journey: "communaute",
		audience: "public",
		priority: 0.7,
		changeFrequency: "daily",
	},
	{
		href: "/dashboard",
		label: "Mon espace",
		blurb: "Progression, favoris et activité.",
		journey: "espace",
		audience: "member",
		priority: 0,
	},
	{
		href: "/favoris",
		label: "Mes favoris",
		blurb: "Les fiches mises de côté.",
		journey: "espace",
		audience: "member",
		priority: 0,
	},
	{
		href: "/profil/me",
		label: "Mon profil",
		blurb: "Carte de joueur publique.",
		journey: "espace",
		audience: "member",
		priority: 0,
	},
	{
		href: "/parametres",
		label: "Paramètres",
		blurb: "Confidentialité, sessions, export et suppression du compte.",
		journey: "espace",
		audience: "member",
		priority: 0,
	},
	{
		href: "/about",
		label: "À propos",
		journey: "legal",
		audience: "public",
		priority: 0.4,
		changeFrequency: "monthly",
	},
	{
		href: "/credits",
		label: "Crédits & sources",
		journey: "legal",
		audience: "public",
		priority: 0.4,
		changeFrequency: "monthly",
	},
	{
		href: "/sources/dragon-ball",
		label: "Sources BXC & provenance",
		blurb: "Les éditeurs consultés et les métadonnées reçues par les campagnes en cours.",
		journey: "archives",
		audience: "public",
		priority: 0.5,
		changeFrequency: "daily",
	},
	{
		href: "/wiki/staff",
		label: "Autour de Dragon Ball",
		blurb: "Équipe de production, Akira Toriyama, scénaristes et voix de légende.",
		journey: "archives",
		audience: "public",
		priority: 0.8,
		changeFrequency: "weekly",
	},
	{
		href: "/licence",
		label: "Licence & usage",
		journey: "legal",
		audience: "public",
		priority: 0.3,
		changeFrequency: "yearly",
	},
	{
		href: "/confidentialite",
		label: "Confidentialité",
		journey: "legal",
		audience: "public",
		priority: 0.3,
		changeFrequency: "yearly",
	},
];

/** Priorité sitemap d'une rubrique du registre, selon sa nature. */
function priorityFor(entry: LaunchCategory): number {
	if (entry.scope === "wiki") return 0.8;
	if (entry.key === "news") return 0.8;
	return 0.5;
}

function journeyFor(entry: LaunchCategory): Journey {
	if (PARTICIPATION_KEYS.has(entry.key)) return "participer";
	const group = entry.group ? GROUP_TO_JOURNEY[entry.group] : undefined;
	if (group) return group;
	// Sans famille déclarée : une rubrique wiki rejoint l'encyclopédie, le reste
	// les portes d'entrée (recherche, hasard, assistant).
	return entry.scope === "wiki" ? "encyclopedie" : "decouvrir";
}

/** Destination dérivée d'une entrée du registre d'accès. */
function fromEntry(entry: LaunchCategory): SiteDestination | null {
	if (!entry.href) return null;
	return {
		href: entry.href,
		label: entry.label,
		blurb: entry.blurb,
		journey: journeyFor(entry),
		// Une entrée dont le défaut est `admin`/`members` reste annoncée comme telle :
		// l'appelant filtrera sur l'accès RÉEL, mais la carte ne doit pas prétendre
		// qu'une rubrique fermée par défaut est publique.
		audience:
			entry.defaultMode === "admin"
				? "staff"
				: entry.defaultMode === "members" || entry.defaultMode === "roles"
					? "member"
					: "public",
		entryKey: entry.key,
		priority: priorityFor(entry),
		changeFrequency: entry.key === "news" ? "daily" : "weekly",
	};
}

/**
 * Toutes les destinations du site, registre d'abord, extras ensuite.
 *
 * Dédoublonné par `href` : si une page finit par entrer au registre (par exemple
 * `/news/fil`), l'entrée du registre gagne et l'extra s'effface, sans doublon au
 * sitemap ni dans le pied de page.
 */
export const SITE_DESTINATIONS: readonly SiteDestination[] = (() => {
	const out: SiteDestination[] = [];
	const seen = new Set<string>();
	for (const entry of ALL_ENTRIES) {
		const dest = fromEntry(entry);
		if (!dest || seen.has(dest.href)) continue;
		seen.add(dest.href);
		out.push(dest);
	}
	for (const dest of EXTRA_DESTINATIONS) {
		if (seen.has(dest.href)) continue;
		seen.add(dest.href);
		out.push(dest);
	}
	return out;
})();

/** Destinations d'un parcours, dans l'ordre de déclaration. */
export function destinationsOf(journey: Journey): SiteDestination[] {
	return SITE_DESTINATIONS.filter((d) => d.journey === journey);
}

/**
 * Carte filtrée pour un visiteur, parcours par parcours.
 *
 * `isOpen` est la MÊME fonction que celle utilisée par la nav et le sitemap
 * (`isPathPublic(href, cfg)`) : ce qu'on affiche est ce qu'un clic obtient.
 * `audience` décide de montrer ou non l'espace membre.
 */
export function buildSiteMap(opts: {
	isOpen?: (href: string) => boolean;
	includeMember?: boolean;
	includeStaff?: boolean;
}): Array<{ journey: JourneyMeta; items: SiteDestination[] }> {
	const isOpen = opts.isOpen ?? (() => true);
	return JOURNEYS.map((key) => ({
		journey: JOURNEY_META[key],
		items: destinationsOf(key).filter((d) => {
			if (d.audience === "member" && !opts.includeMember) return false;
			if (d.audience === "staff" && !opts.includeStaff) return false;
			if (d.external) return true;
			return isOpen(d.href);
		}),
	})).filter((g) => g.items.length > 0);
}

/** Destinations à annoncer au sitemap XML (priorité > 0). */
export function sitemapDestinations(): SiteDestination[] {
	return SITE_DESTINATIONS.filter((d) => d.priority > 0 && !d.external);
}
