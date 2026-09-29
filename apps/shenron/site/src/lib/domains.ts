/**
 * domains — le registre qui relie **la page publique et son back-office** pour
 * un même domaine éditorial.
 *
 * Le site avait deux arborescences parallèles qui parlaient des mêmes objets :
 * `/wiki/databooks` et `/admin/databooks`, `/news` et `/admin/posts`,
 * `/tierlists` et `/admin/tierlists`… Conséquence observée : chaque côté
 * progressait seul. Le public avait le lecteur de planches mais pas le compteur
 * de transcriptions ; l'admin avait les statistiques mais un affichage pauvre.
 * Et un admin qui lisait une fiche n'avait aucun chemin direct vers son écran
 * d'édition : il repassait par la sidebar.
 *
 * Ce fichier est la **source de vérité unique** de ces paires. Il est
 * client-safe (aucun accès base, aucun secret) pour que l'îlot public
 * `DomainBar` et la sidebar d'administration lisent la même liste : ajouter un
 * domaine le fait apparaître des deux côtés, ou nulle part.
 *
 * Ce que ce registre NE fait pas : accorder des droits. L'affichage d'un lien
 * d'administration est décidé côté client d'après `/api/me` (pour garder les
 * pages publiques cacheables) ; l'autorisation réelle reste `requireAdmin()`
 * dans la route d'admin. Connaître l'URL n'ouvre rien.
 */

const DOMAIN_KEYS = [
	"news",
	"wiki",
	"databooks",
	"tierlists",
	"canon",
	"chronologie",
	"classements",
	"moderation",
	"agents",
] as const;
export type DomainKey = (typeof DOMAIN_KEYS)[number];

export interface SiteDomain {
	key: DomainKey;
	/** Nom du domaine, côté lecteur. */
	label: string;
	/** Ce que le domaine contient, en une phrase (aide de navigation). */
	description: string;
	/** Page publique de référence. `null` = domaine purement interne. */
	publicHref: string | null;
	/** Écran d'administration de référence. `null` = pas d'admin dédié. */
	adminHref: string | null;
	/**
	 * Préfixes d'URL publiques qui appartiennent à ce domaine — sert à retrouver
	 * le domaine courant depuis un `pathname` (barre d'admin contextuelle).
	 */
	publicPrefixes: readonly string[];
	/** Intitulé du bouton d'édition affiché aux admins sur la page publique. */
	adminCta: string;
}

const SITE_DOMAINS: readonly SiteDomain[] = [
	{
		key: "news",
		label: "Actualités",
		description: "Le fil unique : articles de la rédaction, wiki, contributions, discussions.",
		publicHref: "/news",
		adminHref: "/admin/posts",
		publicPrefixes: ["/news"],
		adminCta: "Gérer les articles",
	},
	{
		key: "wiki",
		label: "Wiki",
		description: "Fiches personnages, sagas, techniques, épisodes et films.",
		publicHref: "/wiki",
		adminHref: "/admin/wiki",
		publicPrefixes: ["/wiki"],
		adminCta: "Ouvrir le studio wiki",
	},
	{
		key: "databooks",
		label: "Databooks",
		description: "Daizenshuu, guides et interviews : planches, transcriptions, traductions.",
		publicHref: "/wiki/databooks",
		adminHref: "/admin/databooks",
		publicPrefixes: ["/wiki/databooks"],
		adminCta: "Gérer les databooks",
	},
	{
		key: "tierlists",
		label: "Tier lists",
		description: "Classements communautaires, votes et curation éditoriale.",
		publicHref: "/tierlists",
		adminHref: "/admin/tierlists",
		publicPrefixes: ["/tierlists"],
		adminCta: "Gérer les tier lists",
	},
	{
		key: "canon",
		label: "Canon",
		description: "Doctrine officielle, corpus de preuves et arbitrage des questions.",
		publicHref: "/wiki/canon",
		adminHref: "/admin/ia?tab=canon",
		publicPrefixes: ["/wiki/canon"],
		adminCta: "Éditer la doctrine",
	},
	{
		key: "chronologie",
		label: "Chronologie",
		description: "Frise des événements de l'univers, de l'âge 261 à Super.",
		publicHref: "/wiki/chronologie",
		adminHref: "/admin/chronologie",
		publicPrefixes: ["/wiki/chronologie"],
		adminCta: "Éditer la frise",
	},
	{
		key: "classements",
		label: "Classements",
		description: "Tops de la communauté et palmarès issus des votes.",
		publicHref: "/classements",
		adminHref: "/admin/leaderboards",
		publicPrefixes: ["/classements", "/leaderboard"],
		adminCta: "Gérer les classements",
	},
	{
		key: "moderation",
		label: "Modération",
		description: "Commentaires, signalements et propositions de correction.",
		publicHref: null,
		adminHref: "/admin/moderation",
		publicPrefixes: [],
		adminCta: "Ouvrir la modération",
	},
	{
		key: "agents",
		label: "API interne",
		description: "Clés d'accès des agents, portées et journal des écritures.",
		// Aucune vue publique : la documentation d'écriture vit sous /admin/api-docs.
		publicHref: null,
		adminHref: "/admin/agents",
		publicPrefixes: [],
		adminCta: "Gérer les clés d'agent",
	},
] as const;

const BY_KEY = new Map(SITE_DOMAINS.map((d) => [d.key, d]));

export function getDomain(key: DomainKey): SiteDomain {
	const d = BY_KEY.get(key);
	if (!d) throw new Error(`domaine inconnu: ${key}`);
	return d;
}

/**
 * Domaine correspondant à un chemin public. Le préfixe le PLUS LONG gagne :
 * `/wiki/databooks/3` appartient aux databooks, pas au wiki générique.
 */
export function domainForPath(pathname: string): SiteDomain | null {
	let best: SiteDomain | null = null;
	let bestLen = -1;
	for (const d of SITE_DOMAINS) {
		for (const p of d.publicPrefixes) {
			if ((pathname === p || pathname.startsWith(`${p}/`)) && p.length > bestLen) {
				best = d;
				bestLen = p.length;
			}
		}
	}
	return best;
}

/** Domaine correspondant à un chemin d'administration (barre de retour public). */
function domainForAdminPath(pathname: string): SiteDomain | null {
	let best: SiteDomain | null = null;
	let bestLen = -1;
	for (const d of SITE_DOMAINS) {
		const a = d.adminHref;
		if (!a) continue;
		if ((pathname === a || pathname.startsWith(`${a}/`)) && a.length > bestLen) {
			best = d;
			bestLen = a.length;
		}
	}
	return best;
}
