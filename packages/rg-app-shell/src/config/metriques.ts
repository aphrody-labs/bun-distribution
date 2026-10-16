/**
 * Métriques du chrome — hauteurs, empilement, gouttières.
 *
 * ── POURQUOI CE FICHIER ─────────────────────────────────────────────────────
 * Les cinq pièces du chrome fixaient chacune ses valeurs, en dur, dans sa
 * classe utilitaire :
 *
 *   - `TopAppBar` bureau     : `h-14`, `z-[60]`
 *   - `TopAppBar` mobile     : `h-[calc(4rem+env(safe-area-inset-top))]`, `z-40`
 *   - `MobileBottomNav`      : `h-[calc(5rem+env(safe-area-inset-bottom))]`, `z-50`
 *   - `NavigationRail`       : `top-14`, `z-50`
 *   - `AchilleaNav`          : `h-16`, `z-40`
 *
 * Deux conséquences. D'abord `top-14` du rail recopie la hauteur de la barre
 * bureau : toute modification de l'une désaligne l'autre, en silence. Ensuite
 * l'empilement n'a pas de sens d'ensemble — la barre mobile (`z-40`) passe SOUS
 * la barre du bas (`z-50`), alors que la barre du bas devrait rester au-dessus
 * du contenu mais sous les surfaces modales.
 *
 * Et surtout : rien ne disait combien de pixels le chrome coûte au total. Sur
 * mobile, l'en-tête (64 px) et la barre du bas (80 px) en consomment **144 sur
 * 812**, soit près d'un cinquième de l'écran, avant même d'afficher quoi que ce
 * soit. Une valeur qu'on ne mesure pas est une valeur qu'on n'optimise pas.
 *
 * ── MODULE PUR ──────────────────────────────────────────────────────────────
 * Des constantes et des chaînes de classes. Aucune dépendance.
 */

/**
 * Hauteurs, en `rem`.
 *
 * La barre du bas descend de 5rem à 4.5rem : la spécification Material fixe la
 * cible tactile minimale à 48 px, et 72 px de barre les contiennent
 * confortablement avec le libellé. Les 8 px récupérés sur chaque écran mobile
 * sont gratuits.
 */
export const HAUTEURS = {
	/** Barre supérieure, bureau. Le rail s'y aligne. */
	barreSuperieure: 3.5,
	/** En-tête mobile, hors encoche. */
	enteteMobile: 4,
	/** Barre du bas, hors zone sûre. */
	barreBasse: 4.5,
	/** Sous-barre contextuelle d'une section (onglets de domaine). */
	sousBarre: 2.75,
} as const;

/**
 * Plans d'empilement.
 *
 * Ordonnés et nommés : un `z-index` écrit en dur dans un composant ne dit pas
 * ce qu'il est censé recouvrir. Les écarts de 10 laissent de la place pour
 * intercaler sans tout renuméroter.
 */
export const PLANS = {
	/** Contenu de page. */
	contenu: 0,
	/** Sous-barre de section : au-dessus du contenu, sous la navigation. */
	sousBarre: 30,
	/** Barres de navigation permanentes. */
	navigation: 40,
	/** Rail et barre du bas : au-dessus des barres, sous les surfaces modales. */
	navigationFixe: 50,
	/** Tiroirs, dialogues, menus. */
	surface: 60,
} as const;

/** Hauteur d'une valeur de `HAUTEURS`, en chaîne CSS. */
export function rem(valeur: number): string {
	return `${valeur}rem`;
}

/**
 * Décalage haut du contenu, selon les barres réellement montées.
 *
 * Le calcul vivait dans `Shell`, recopié entre la branche compacte et la
 * branche bureau. Une barre ajoutée ou retirée demandait de penser aux deux.
 */
export function decalageHaut(options: {
	barreSuperieure?: boolean;
	enteteMobile?: boolean;
	sousBarre?: boolean;
}): string {
	const parts: string[] = [];
	if (options.barreSuperieure) parts.push(rem(HAUTEURS.barreSuperieure));
	if (options.enteteMobile) parts.push(`calc(${rem(HAUTEURS.enteteMobile)} + env(safe-area-inset-top))`);
	if (options.sousBarre) parts.push(rem(HAUTEURS.sousBarre));
	if (parts.length === 0) return "0px";
	return parts.length === 1 ? (parts[0] as string) : `calc(${parts.join(" + ")})`;
}

/**
 * Coût total du chrome mobile, en `rem`.
 *
 * Exposé pour être TESTÉ : c'est le chiffre qui dit si le chrome reste dans son
 * budget. Sans lui, une barre s'épaissit d'un demi-rem à chaque refonte et
 * personne ne s'en aperçoit avant que le contenu n'ait plus de place.
 */
export function coutChromeMobile(avecSousBarre = false): number {
	return (
		HAUTEURS.enteteMobile + HAUTEURS.barreBasse + (avecSousBarre ? HAUTEURS.sousBarre : 0)
	);
}

/** Budget maximal admis pour le chrome mobile, en `rem` (soit 144 px). */
export const BUDGET_CHROME_MOBILE = 9;
