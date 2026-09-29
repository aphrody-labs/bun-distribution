/**
 * ads — configuration AdSense **client-safe** (source unique).
 *
 * Même doctrine que `@/lib/config` : on lit `process.env` directement (et pas
 * `@/lib/env`, dont le proxy `@t3-oss` jette côté client sur une var *server*),
 * parce que ce module est importé par des Client Components. Toutes les valeurs
 * ici sont **publiques par nature** (l'ID éditeur et les IDs de bloc sont
 * visibles dans le HTML servi) et bakées au build par Next.
 *
 * Deux modes de monétisation coexistent, volontairement :
 *
 *  1. **Auto ads** — le script `adsbygoogle.js` chargé dans le layout suffit ;
 *     l'emplacement des annonces est décidé par Google depuis la console
 *     AdSense (« Aperçu » → activer les annonces automatiques). Rien à coder.
 *  2. **Blocs manuels** — `<AdUnit placement="…">` rend un `<ins>` explicite
 *     aux endroits choisis dans les pages. Chaque emplacement n'est actif que
 *     si son ID de bloc est posé en env : **aucun ID inventé**, un `data-ad-slot`
 *     bidon ne remplit jamais et pollue les diagnostics de la console.
 *
 * Créer un bloc dans AdSense → copier son `data-ad-slot` (10 chiffres) dans la
 * var correspondante de `apps/shenron/site/.env`, rebuild, l'emplacement s'allume seul.
 */

/**
 * Identifiant éditeur AdSense (`ca-pub-…`). Vide = toute la mécanique
 * publicitaire est inerte (aucun script, aucun `<ins>`), ce qui permet de
 * démonter la publicité par une simple variable d'environnement.
 */
export const ADSENSE_CLIENT = (process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? "").trim();

/** La publicité est-elle configurée sur ce déploiement ? */
const ADS_ENABLED = ADSENSE_CLIENT.startsWith("ca-pub-");

/**
 * Emplacements publicitaires du site. `format` suit la nomenclature AdSense :
 *  - `auto`      : bloc display responsive (bannière qui s'adapte au conteneur) ;
 *  - `fluid`     : bloc natif (in-article / in-feed), typographie adaptée au contenu ;
 *  - `autorelaxed` : multiplex (grille de recommandations), en fin de page.
 */
export type AdPlacement = "article" | "display" | "infeed" | "multiplex";

interface PlacementSpec {
	/** ID du bloc AdSense (`data-ad-slot`), depuis l'env. */
	slot: string;
	format: "auto" | "fluid" | "autorelaxed";
	/** Clé de gabarit, imposée par AdSense pour les blocs `fluid` in-feed. */
	layoutKey?: string;
	/** `data-ad-layout` (ex. `in-article`) pour les blocs natifs. */
	layout?: string;
	/** Hauteur réservée avant remplissage — limite le CLS sans laisser de trou. */
	minHeight: number;
}

export const AD_PLACEMENTS: Record<AdPlacement, PlacementSpec> = {
	/** Dans le corps d'un article / d'une fiche, entre deux blocs de contenu. */
	article: {
		slot: (process.env.NEXT_PUBLIC_ADSENSE_SLOT_ARTICLE ?? "").trim(),
		format: "fluid",
		layout: "in-article",
		minHeight: 180,
	},
	/** Bannière display responsive (fin de page, colonnes latérales). */
	display: {
		slot: (process.env.NEXT_PUBLIC_ADSENSE_SLOT_DISPLAY ?? "").trim(),
		format: "auto",
		minHeight: 120,
	},
	/** Bloc natif intercalé dans une grille/liste (épisodes, films, actualités). */
	infeed: {
		slot: (process.env.NEXT_PUBLIC_ADSENSE_SLOT_INFEED ?? "").trim(),
		format: "fluid",
		layoutKey: (process.env.NEXT_PUBLIC_ADSENSE_LAYOUT_KEY_INFEED ?? "").trim() || undefined,
		minHeight: 220,
	},
	/** Multiplex « contenus associés » — bas de page uniquement. */
	multiplex: {
		slot: (process.env.NEXT_PUBLIC_ADSENSE_SLOT_MULTIPLEX ?? "").trim(),
		format: "autorelaxed",
		minHeight: 260,
	},
};

/**
 * Spécification d'un emplacement, ou `null` s'il n'est pas exploitable
 * (publicité désactivée, ou bloc pas encore créé côté console AdSense).
 * Un emplacement `null` ne rend **rien du tout** : pas de conteneur, pas de
 * réservation d'espace, aucune trace dans la page.
 */
export function getAdPlacement(placement: AdPlacement): PlacementSpec | null {
	if (!ADS_ENABLED) return null;
	const spec = AD_PLACEMENTS[placement];
	// Un `data-ad-slot` AdSense est numérique (10 chiffres) — on rejette tout le
	// reste pour ne jamais servir un bloc qui ne remplira pas.
	if (!/^\d{6,}$/.test(spec.slot)) return null;
	return spec;
}
