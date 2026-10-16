/**
 * Couverture de tankōbon — géométrie des éléments de décor, en paramétrique.
 *
 * Tout ce qui suit est RELEVÉ sur la couverture désignée comme source de
 * vérité (`bot.dragonballfr.com/assets/ext/db_manga_volumes/124.jpg`, 764 ×
 * 1200), jamais décalqué et jamais dessiné de mémoire : les nombres bruts sont
 * dans `docs/couverture-analyse-visuelle.md`, section « Les quatre éléments de
 * décor ». Quatre motifs, un par élément :
 *
 *  1. `CADRE_CASE`  — l'encadrement de l'illustration : encre / liseré jaune /
 *     encre, coins vifs. Il n'a pas de tracé : c'est une suite d'anneaux, donc
 *     trois nombres et un composant qui les pose en `box-shadow`.
 *  2. `BANC_NUAGE`  — les volutes du fond de case : chaîne de lobes bombés,
 *     chacun fini par la spirale rentrante du nuage chinois (祥雲). Tuile
 *     répétable horizontalement.
 *  3. `PASTILLE`    — le disque de numéro de tome : dégradé radial concentrique
 *     et cerne d'encre.
 *  4. `etoilePath`  — l'étoile à cinq branches qui ouvre la ligne de titre
 *     secondaire. Mesurée « grasse » : r/R = 0,45 là où le pentagramme
 *     géométrique donne 0,382.
 *
 * Les primitives (`arcs`, `volute`) viennent de `lib/kinto-un.ts` : une seule
 * implémentation pour tout le dessin vectoriel du site, sinon les deux
 * divergent au premier ajustement.
 */
import { arcs, volute, type Point } from "./kinto-un";

const r1 = (v: number) => Math.round(v * 10) / 10;

// ─────────────────────────── 1. Cadre de case ───────────────────────────────

/**
 * Mesures du cadre. Boîte extérieure x 38 → 716, y 355 → 1036, soit 679 × 682
 * (ratio 1,004 : la case est carrée). Le liseré jaune fait 12 px, les deux
 * traits d'encre qui le bordent 2 px chacun.
 *
 * Les proportions sont rapportées à la LARGEUR DU CADRE, pas à la page :
 * c'est ce qui les rend transposables à une vignette de n'importe quelle
 * taille. Le document de mesures écarte le liseré à 1,77 % pour les bordures
 * de cartes ordinaires — ici l'objet EST une couverture, la proportion
 * s'applique donc telle quelle, bornée pour rester dessinable en petit.
 */
export const CADRE_CASE = {
  /** Liseré jaune : 12 px sur 679 de large. */
  lisere: 0.0177,
  /** Trait d'encre de part et d'autre du liseré : 2 px sur 679. */
  trait: 0.0037,
  /** Coins vifs : le masque jaune se referme à 90° sur 1 px, aucun rayon. */
  rayon: 0,
  /** Jaune du cadre : #FFF007, à 2 points du jaune du titre (#FEFD03). */
  jaune: "var(--color-logo-jaune)",
  encre: "var(--color-encre)",
} as const;

export interface AnneauxCadre {
  /** Épaisseur d'un trait d'encre, en px. */
  trait: number;
  /** Épaisseur du liseré jaune, en px. */
  lisere: number;
  /** Rayon des coins, en px (nul : mesuré vif). */
  rayon: number;
  /** Épaisseur totale du cadre (trait + liseré + trait). */
  total: number;
}

/**
 * Épaisseurs du cadre pour une vignette de `largeur` px.
 *
 * Bornes : le trait ne descend pas sous 1,5 px (en dessous, un demi-pixel de
 * rendu l'efface une ligne sur deux) et le liseré est tenu entre 3 et 14 px —
 * la proportion brute donnerait 21 px sur une fiche de 1200, où le cadre
 * mangerait l'image.
 */
export function anneauxCadre(largeur: number): AnneauxCadre {
  const trait = Math.max(1.5, r1(largeur * CADRE_CASE.trait));
  const lisere = Math.min(14, Math.max(3, r1(largeur * CADRE_CASE.lisere)));
  return {
    trait,
    lisere,
    rayon: CADRE_CASE.rayon,
    total: r1(2 * trait + lisere),
  };
}

/**
 * `box-shadow` des trois anneaux, du dedans vers le dehors : trait d'encre,
 * liseré jaune, trait d'encre. Un `box-shadow` plutôt que trois `div` : le
 * cadre ne prend pas de place dans le flux et suit n'importe quel ratio.
 */
export function ombreCadre(a: AnneauxCadre): string {
  const t1 = a.trait;
  const t2 = r1(t1 + a.lisere);
  const t3 = r1(t2 + a.trait);
  return [
    `0 0 0 ${t1}px ${CADRE_CASE.encre}`,
    `0 0 0 ${t2}px ${CADRE_CASE.jaune}`,
    `0 0 0 ${t3}px ${CADRE_CASE.encre}`,
  ].join(", ");
}

// ───────────────────────── 2. Volutes de nuage ──────────────────────────────

/**
 * Mesures du banc de nuage, relevées sur trois zones de fond de case
 * (x 440-706 y 376-470, x 520-706 y 930-1024, x 55-240 y 615-770) :
 *
 *  - aplat pâle `#CFCFE7`, trait `#4141A1`, ciel `#3760B2` — le fond de case
 *    n'est PAS jaune : le `#F2DBA1` du premier relevé était le ventre du
 *    dragon, pas le nuage (cf. document de mesures) ;
 *  - lobe : corde 46 px, flèche 22 px, soit **0,48 de la corde** — le lobe est
 *    plus qu'un demi-cercle, il est PINCÉ à la base. Le premier relevé donnait
 *    80 × 28 (0,35) : c'était l'enveloppe de deux lobes fondus, pas un lobe.
 *    Le rendu côte à côte a tranché — les arceaux plats ne ressemblaient à
 *    rien, alors que le nombre, lui, avait l'air bon ;
 *  - spirale : Ø 27 à 40 px pour une corde de 46, soit **0,7 × la corde** : la
 *    volute remplit presque son lobe, c'est la signature du nuage chinois ;
 *  - trait : 3 px de médiane, 5 au 3ᵉ quartile (n = 826 segments) → 4 px, soit
 *    **9 % de la corde**, une encre très grasse pour un décor de fond.
 */
export const NUAGE_MESURES = {
  corde: 46,
  fleche: 22,
  spiraleSurCorde: 0.7,
  traitSurCorde: 0.09,
  tours: 1.25,
  fond: "#CFCFE7",
  trait: "#4141A1",
  ciel: "#3760B2",
} as const;

export interface BancNuage {
  largeur: number;
  hauteur: number;
  /** Silhouette fermée (aplat) : chaîne de lobes fermée par la base. */
  silhouette: string;
  /** Contour d'encre : la chaîne de lobes SEULE, ouverte. */
  contour: string;
  /** Volutes d'encre : une par creux, plus les enroulements intérieurs. */
  volutes: string[];
  /** Épaisseur du trait, dans l'unité du viewBox. */
  trait: number;
}

/**
 * Tuile de banc de nuage, répétable horizontalement.
 *
 * Trois règles, chacune sortie d'un défaut vu au rendu :
 *
 *  - **la couture tombe sur une crête, pas sur un creux.** Les creux portent
 *    une spirale ; posée à x = 0 elle se dédoublait au raccord et faisait une
 *    tache. Le premier creux est donc placé en x négatif et le dernier à
 *    +240 du premier : la géométrie est identique de part et d'autre du bord ;
 *  - **la base ne porte pas de trait.** Le banc est coupé par le bas de la
 *    tuile, ce n'est pas un bord de forme : l'encre ne suit que le haut ;
 *  - **les cordes varient du simple au double** (34 → 60 px). Des lobes de
 *    rayon égal donnent une frise mécanique, ce que les planches ne font
 *    jamais — et le rendu le montre immédiatement.
 */
export function bancNuage({
  creuxX = [-16, 30, 74, 108, 164, 224],
  fleches = [22, 21, 16, 27, 29],
  largeur = 240,
  base = 128,
  creux = 78,
}: {
  /** Abscisses des creux ; le dernier vaut le premier + `largeur` (couture). */
  creuxX?: readonly number[];
  /** Flèches des lobes entre creux successifs. */
  fleches?: readonly number[];
  largeur?: number;
  /** Ordonnée du bas de la tuile. */
  base?: number;
  /** Ordonnée des creux. */
  creux?: number;
} = {}): BancNuage {
  // Un lobe de plus que la liste : le dernier creux vaut le premier + largeur,
  // donc l'arc qui le suit est le PREMIER arc décalé d'une tuile. Sans lui, la
  // tuile s'arrête net sur son bord droit — vu au rendu comme une falaise à
  // chaque raccord, alors que la couture, elle, était bonne.
  const xs = [...creuxX, creuxX[1] + largeur];
  const f = [...fleches, fleches[0]];
  const sommets: Point[] = xs.map((x) => [x, creux]);
  const contour = arcs(sommets, f, false);
  const premier = xs[0];
  const dernier = xs[xs.length - 1];
  const silhouette = `${contour}L${r1(dernier)} ${base}L${r1(premier)} ${base}Z`;

  const volutes: string[] = [];
  for (let i = 0; i < sommets.length; i++) {
    const p = sommets[i];
    // Rayon : 0,45 × la corde moyenne des deux lobes voisins — le facteur
    // mesuré, le même que les volutes du Kinto-Un.
    const g = i > 0 ? xs[i] - xs[i - 1] : xs[1] - xs[0];
    const d = i < xs.length - 1 ? xs[i + 1] - xs[i] : g;
    const r = (((g + d) / 2) * NUAGE_MESURES.spiraleSurCorde) / 2;
    // Le creux s'enroule vers l'intérieur de la masse (vers le bas), sens
    // alterné : deux spirales voisines qui tournent pareil font un ressort.
    volutes.push(
      volute(p, [p[0], base], r, NUAGE_MESURES.tours, i % 2 === 0 ? 1 : -1),
    );
  }
  const trait = r1(NUAGE_MESURES.corde * NUAGE_MESURES.traitSurCorde);
  for (let i = 0; i < f.length; i++) {
    // Enroulement intérieur sous chaque crête : plus petit (0,62), il donne la
    // profondeur du banc sans redoubler le contour. Sous 2,5 fois l'épaisseur
    // du trait, la spirale se referme sur elle-même et rend un point d'encre —
    // vu au rendu sur les lobes courts : on la supprime plutôt que la tasser.
    const corde = xs[i + 1] - xs[i];
    const r = (corde * NUAGE_MESURES.spiraleSurCorde * 0.62) / 2;
    if (r < trait * 2.5) continue;
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cy = creux + (base - creux) * 0.34;
    volutes.push(
      volute([cx, cy], [cx, base], r, NUAGE_MESURES.tours, i % 2 ? 1 : -1),
    );
  }
  return { largeur, hauteur: base, silhouette, contour, volutes, trait };
}

/** Tuile par défaut : quatre lobes de 36 à 72, 240 × 128. */
export const BANC_NUAGE = bancNuage();

/**
 * Corps SVG du banc (sans balise racine). `fond` et `trait` prennent des
 * variables de thème dans l'interface, les aplats mesurés dans le fichier
 * statique de `public/dbz/marque/`, qui n'hérite d'aucune variable CSS.
 */
export function corpsBancNuage(
  n: BancNuage = BANC_NUAGE,
  fond = NUAGE_MESURES.fond,
  trait = NUAGE_MESURES.trait,
): string {
  return `<path d="${n.silhouette}" fill="${fond}"/>
<g fill="none" stroke="${trait}" stroke-width="${n.trait}" stroke-linecap="round" stroke-linejoin="round">
<path d="${n.contour}"/>
${n.volutes.map((d) => `<path d="${d}"/>`).join("\n")}
</g>`;
}

/**
 * SVG complet de la tuile (`public/dbz/marque/banc-nuage.svg`).
 *
 * Le découpage explicite n'est pas décoratif : le motif déborde du viewBox des
 * deux côtés (c'est ce qui rend la couture invisible), et un rendu hors
 * navigateur — librsvg, sharp — ne coupe pas au viewBox. Sans ce `clipPath`,
 * la tuile bave hors de sa boîte à la génération des PNG de contrôle.
 */
export function svgBancNuage(n: BancNuage = BANC_NUAGE): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n.largeur} ${n.hauteur}" width="${n.largeur}" height="${n.hauteur}" role="img" aria-labelledby="bn-t">
<title id="bn-t">Banc de nuages</title>
<desc>Volutes de fond de case : lobes bombés finis en spirales rentrantes, relevés sur la couverture du tome.</desc>
<defs><clipPath id="bn-c"><rect width="${n.largeur}" height="${n.hauteur}"/></clipPath></defs>
<g clip-path="url(#bn-c)">
${corpsBancNuage(n)}
</g>
</svg>
`;
}

// ─────────────────────── 3. Pastille de numéro de tome ──────────────────────

/**
 * Le disque de numéro, en bas à droite de la couverture : Ø 113 px (14,8 % de
 * la largeur de page), cerne d'encre de 6,5 px (5,75 % du diamètre), dégradé
 * radial CONCENTRIQUE au disque — mesuré en couronnes de 6 px autour du point
 * le plus clair, qui tombe à 1 px du centre géométrique.
 *
 * C'est le seul élément de la couverture qui porte un vrai dégradé : le reste
 * est en aplats francs. Il est donc conservé, mais reconstruit avec les jetons
 * du site — l'arrêt extérieur mesuré (`#ED5102`, vermillon) n'a pas de jeton,
 * `--color-gi-ombre` en tient lieu.
 */
export const PASTILLE = {
  diametre: 113,
  cerne: 0.0575,
  /** Hauteur du chiffre rapportée au diamètre. */
  chiffre: 0.496,
  /** Arrêts mesurés : rayon relatif → couleur du support. */
  degradeMesure: [
    [0.05, "#FCF5AA"],
    [0.27, "#FEF01D"],
    [0.48, "#FBB502"],
    [0.69, "#F17102"],
    [0.8, "#ED5102"],
  ] as const,
  /** Les mêmes arrêts, portés sur les jetons du site. */
  degradeJetons: [
    [0.05, "color-mix(in srgb, var(--color-logo-jaune) 78%, var(--color-os))"],
    [0.27, "var(--color-logo-jaune)"],
    [0.48, "var(--color-gi-clair)"],
    [0.8, "var(--color-gi-ombre)"],
  ] as const,
} as const;

/** Rayon du tracé et épaisseur du cerne pour un diamètre de viewBox donné. */
export function anneauPastille(diametre: number = PASTILLE.diametre) {
  const cerne = r1(diametre * PASTILLE.cerne);
  return { centre: diametre / 2, cerne, rayon: r1(diametre / 2 - cerne / 2) };
}

// ──────────────────────────── 4. Étoile ─────────────────────────────────────

/**
 * Étoile à cinq branches, pointe en haut.
 *
 * Mesurée sur la ligne de titre secondaire : boîte 21 × 20 px, R = 11,05 px
 * (les deux lectures — hauteur / 1,809 et largeur / 1,902 — concordent à 0,01
 * près), rapport rayon intérieur / rayon extérieur **0,45**, contre 0,382 pour
 * le pentagramme régulier : l'étoile de la ligne de titre est franchement
 * grasse, c'est ce qui la rend encore lisible à 12 px. Aplat plein, aucun
 * contour d'encre.
 */
export const ETOILE_INTERIEUR = 0.45;

/** Tracé d'une étoile à `branches` pointes, centrée en (cx, cy). */
export function etoilePath(
  cx: number,
  cy: number,
  R: number,
  interieur = ETOILE_INTERIEUR,
  branches = 5,
): string {
  const pts: string[] = [];
  for (let i = 0; i < branches * 2; i++) {
    const rayon = i % 2 === 0 ? R : R * interieur;
    const a = -Math.PI / 2 + (i * Math.PI) / branches;
    pts.push(`${r1(cx + rayon * Math.cos(a))} ${r1(cy + rayon * Math.sin(a))}`);
  }
  return `M${pts.join("L")}Z`;
}

/**
 * viewBox au plus juste pour une étoile de rayon R centrée en (cx, cy) : une
 * étoile pointe en haut n'est pas centrée dans sa boîte (elle descend à
 * 0,809 R et monte à R), et un viewBox carré lui laisserait 10 % de vide en
 * bas — le défaut « ratio du viewBox et non de l'encre » du cycle de dessin.
 */
export function etoileViewBox(R = 50): {
  viewBox: string;
  cx: number;
  cy: number;
} {
  const cx = R;
  const cy = R;
  const demiLargeur = R * Math.sin((2 * Math.PI) / 5);
  const bas = R * Math.cos(Math.PI / 5);
  return {
    viewBox: `${r1(cx - demiLargeur)} 0 ${r1(2 * demiLargeur)} ${r1(R + bas)}`,
    cx,
    cy,
  };
}
