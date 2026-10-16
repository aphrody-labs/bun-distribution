/**
 * Thème des images générées par le bot.
 *
 * Aucune couleur n'est écrite en dur ici : tout descend de
 * `@rosegriffon/ui/tokens`, la projection TypeScript de
 * `packages/ui/src/styles.css` (cf. `packages/ui/scripts/generer-tokens.ts`).
 * Ce module ne fait que nommer, en vocabulaire de la DA Rose Griffon, les rôles
 * dont le rendu Canvas a besoin.
 */

import { resolve } from "node:path";
import { GlobalFonts } from "@aphrody/canvas";
import { FORMES, MARQUE, THEMES } from "@rosegriffon/ui/tokens";

import { profilActif } from "../profil";

const PUBLIC_WEBSITE = resolve(import.meta.dir, "../../../../website/public");
const POLICES_WEBSITE = `${PUBLIC_WEBSITE}/fonts`;

/**
 * Identité écrite sur les images — celle du PROFIL qui tourne.
 *
 * Les cartes portaient « ROSE GRIFFON » en surtitre et « rosegriffon.fr » en
 * pied, écrits en dur. C'était juste tant qu'il n'existait qu'un bot ; depuis
 * l'arrivée du profil `azalee`, toute carte rendue par le second bot annonçait
 * la mauvaise marque et le mauvais domaine. Les couleurs, elles, ne changent
 * pas : les deux bots appartiennent à la même association et la DA est
 * commune — c'est le NOM qui devait suivre le profil, pas la palette.
 */
export const MARQUE_CANVAS = {
	/** Surtitre de l'en-tête, en capitales. */
	surtitre: profilActif().titre.toUpperCase(),
	/** Domaine affiché en pied de carte. */
	domaine: profilActif().marque.piedDePage,
} as const;

/** Mascottes et logos servis par le site, réutilisés tels quels sur les cartes. */
export const VISUELS = {
	griffon: `${PUBLIC_WEBSITE}/RG_Logo_V2.5.webp`,
	emote: `${PUBLIC_WEBSITE}/emote.webp`,
	royCarte: `${PUBLIC_WEBSITE}/RG_roy_LC.webp`,
	azalee: `${PUBLIC_WEBSITE}/RG_Azalee-logo.webp`,
} as const;

let policesChargees = false;

/** Enregistre les polices de marque. Idempotent, sûr à appeler avant chaque rendu. */
export function ensureFonts(): void {
	if (policesChargees) return;
	try {
		GlobalFonts.registerFromPath(`${POLICES_WEBSITE}/Super Cartoon.ttf`, "SuperCartoon");
		GlobalFonts.registerFromPath(`${POLICES_WEBSITE}/DEFAULT_BradBunR.ttf`, "BradBunR");
		GlobalFonts.registerFromPath(`${POLICES_WEBSITE}/Autre police/aklatan.ttf`, "Aklatan");
	} catch (err) {
		console.warn("[canvas] enregistrement des polices impossible :", err);
	}
	policesChargees = true;
}

/**
 * Piles de polices.
 *
 * `Droid Sans Fallback` (présent sur le VPS) couvre le japonais et le chinois,
 * `DejaVu Sans` le latin étendu, le grec, le cyrillique, l'hébreu et l'arabe.
 * Ce qui reste hors couverture (hangûl, emoji, thaï) est retiré du texte par
 * `assainir()` — cf. `texte.ts` — plutôt que rendu en carrés « tofu ».
 */
const SECOURS = `"Droid Sans Fallback", "DejaVu Sans", sans-serif`;

export const POLICES = {
	/** Titres cartoon — la police display de la DA. */
	display: `"SuperCartoon", ${SECOURS}`,
	/** Texte courant. */
	corps: `BradBunR, ${SECOURS}`,
} as const;

/** Fabrique une déclaration `font` Canvas 2D. */
export function police(
	famille: (typeof POLICES)[keyof typeof POLICES],
	taille: number,
	graisse: "normal" | "bold" = "normal"
): string {
	return `${graisse === "bold" ? "bold " : ""}${taille}px ${famille}`;
}

const ROY = THEMES["theme-roy"];
const AZALEE_SOMBRE = THEMES["theme-azalee-dark"];

/**
 * Palette de la DA Rose Griffon, exprimée en rôles.
 *
 * Marine + or + brique viennent des tokens de marque (`--rg-*`), qui ne suivent
 * pas le thème ; les surfaces et les couleurs de texte viennent du thème
 * `theme-roy`, dont les valeurs sont pensées pour du contenu posé sur une
 * surface claire.
 */
export const PALETTE = {
	/** Fond général des images. */
	fond: MARQUE.marine,
	fondClair: MARQUE.marineClair,
	/** Or des bordures et des filets. */
	or: MARQUE.griffon,
	/** Rouge brique de l'association. */
	brique: MARQUE.brique,
	briqueClair: MARQUE.briqueClair,
	/** Orange Azalée — accent secondaire. */
	azalee: "#F89C5A",
	azaleeVif: AZALEE_SOMBRE.md3.primary,
	/** Texte posé sur le marine. */
	surFond: MARQUE.surMarine,
	/** Surface des cartes et texte associé. */
	carte: ROY.md3.surfaceContainerLowest,
	carteAlt: ROY.md3.surfaceContainerLow,
	carteCreuse: ROY.md3.surfaceContainerHigh,
	texte: ROY.md3.onSurface,
	texteAttenue: ROY.md3.onSurfaceVariant,
	/** Textes posés sur les pastilles. */
	surOr: ROY.md3.onPrimary,
	surBrique: ROY.md3.onSecondary,
	/** Filets discrets à l'intérieur des cartes. */
	filet: ROY.md3.outlineVariant,
	/** Noir des ombres dures et des contours de titre. */
	ombre: ROY.md3.shadow,
} as const;

/** Rayons d'arrondi — échelle de formes M3 partagée. */
export const RAYONS = {
	xs: FORMES.extraSmall,
	sm: FORMES.small,
	md: FORMES.medium,
	lg: FORMES.large,
	xl: FORMES.extraLarge,
} as const;

/**
 * Ombre portée DURE de la DA (`0 4px 0 0 rgba(0,0,0,0.5)`) — surtout pas une
 * ombre douce Material. En Canvas, elle se dessine en copiant la forme décalée.
 */
export const OMBRE_DURE = { x: 0, y: 4, couleur: "rgba(0, 0, 0, 0.5)" } as const;

/** Épaisseur des bordures or de la DA. */
export const BORDURE_OR = 2;

/** Marge extérieure standard des images. */
export const MARGE = 40;

// ─── Contraste ─────────────────────────────────────────────────────────────

function canalLineaire(octet: number): number {
	const c = octet / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG d'une couleur `#rrggbb`. */
export function luminance(hex: string): number {
	const n = hex.replace("#", "");
	const r = Number.parseInt(n.slice(0, 2), 16);
	const v = Number.parseInt(n.slice(2, 4), 16);
	const b = Number.parseInt(n.slice(4, 6), 16);
	return 0.2126 * canalLineaire(r) + 0.7152 * canalLineaire(v) + 0.0722 * canalLineaire(b);
}

/** Rapport de contraste WCAG entre deux couleurs `#rrggbb` (1 → 21). */
export function contraste(premier: string, second: string): number {
	const a = luminance(premier);
	const b = luminance(second);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Couples (texte, fond) réellement utilisés par les cartes, déclarés ici pour
 * que `theme.test.ts` vérifie leur contraste au lieu de le supposer.
 * `min` suit WCAG AA : 4,5 pour du texte courant, 3 pour du grand texte (≥ 24px
 * en gras, ce qui est le cas de tous les titres cartoon).
 */
export const PAIRES_CONTRASTE = [
	{ role: "texte de carte", texte: PALETTE.texte, fond: PALETTE.carte, min: 4.5 },
	{ role: "texte atténué de carte", texte: PALETTE.texteAttenue, fond: PALETTE.carte, min: 4.5 },
	{ role: "texte de carte alternée", texte: PALETTE.texte, fond: PALETTE.carteAlt, min: 4.5 },
	{
		role: "texte atténué sur carte alternée",
		texte: PALETTE.texteAttenue,
		fond: PALETTE.carteAlt,
		min: 4.5,
	},
	{ role: "état vide", texte: PALETTE.texteAttenue, fond: PALETTE.carteCreuse, min: 4.5 },
	{ role: "titre sur marine", texte: PALETTE.surFond, fond: PALETTE.fond, min: 3 },
	{ role: "sous-titre sur marine", texte: PALETTE.or, fond: PALETTE.fond, min: 4.5 },
	{ role: "pied de page", texte: PALETTE.or, fond: PALETTE.fond, min: 4.5 },
	{ role: "pastille or", texte: PALETTE.surOr, fond: PALETTE.or, min: 4.5 },
	{ role: "pastille brique", texte: PALETTE.surBrique, fond: PALETTE.brique, min: 4.5 },
	{ role: "en-tête brique", texte: PALETTE.surFond, fond: PALETTE.brique, min: 3 },
] as const;
