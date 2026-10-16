/**
 * Kinto-Un — le nuage magique, en géométrie pure (aucun tracé décalqué).
 *
 * Une seule source pour tout ce qui dessine le nuage : le générateur des SVG
 * de `public/dbz/`, le composant React `<KintoUn>`, les favicons. Les mesures
 * d'origine viennent du manga (tome 1 ch. 4, édition couleur t901 pl. 81) et
 * des cels Toei, relevées dans `docs/kinto-un-analyse-visuelle.md` :
 *
 *  - la silhouette est une chaîne de lobes bombés (arcs de cercle entre les
 *    « creux » du contour), ratio d'encre ≈ 1,75 comme dans le manga ;
 *  - chaque creux se prolonge en VOLUTE, la spirale rentrante de Toriyama
 *    (motif du 筋斗雲 du Xiyouji) : c'est ce qui distingue le Kinto-Un d'un
 *    cumulus de dessin animé ;
 *  - deux aplats francs, sans dégradé : jaune citron et ombre dorée qui garde
 *    sa saturation (manga couleur), trait d'encre à 0,8 % de la largeur.
 *
 * Deux dessins : l'ILLUSTRATION (1200 × 676, queue courte finie en volute) et
 * l'ICÔNE (512 × 512, cinq gros lobes sur pastille sombre, lisible à 16 px).
 */
import { requiredIndex } from "./required-index";

export type Point = readonly [number, number];

/** Couleurs mesurées sur le manga couleur (t901 pl. 81) ; pastille = fond du site. */
export const KINTO_UN_COULEURS = {
  lumiere: "#FCF03A",
  ombre: "#E4BE05",
  encre: "#1A1A1A",
  pastille: "#0a0a0a",
} as const;

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Chaîne d'arcs circulaires entre points successifs. `fleches[i]` est la hauteur
 * de l'arc i : positive elle bombe vers l'extérieur (lobe), négative elle creuse.
 * Une flèche supérieure à la moitié de la corde donne le lobe « pincé ».
 */
export function arcs(pts: readonly Point[], fleches: readonly number[], ferme = true): string {
  const n = pts.length;
  if (n === 0) return "";
  const fin = ferme ? n : n - 1;
  const first = requiredIndex(pts, 0);
  let d = `M${r1(first[0])} ${r1(first[1])}`;
  for (let i = 0; i < fin; i++) {
    const [x1, y1] = requiredIndex(pts, i);
    const [x2, y2] = requiredIndex(pts, (i + 1) % n);
    const corde = Math.hypot(x2 - x1, y2 - y1);
    const h = requiredIndex(fleches, i % fleches.length);
    const a = Math.max(1, Math.abs(h));
    const r = (corde * corde) / 4 / (2 * a) + a / 2;
    d += `A${r1(r)} ${r1(r)} 0 ${a > corde / 2 ? 1 : 0} ${h < 0 ? 0 : 1} ${r1(x2)} ${r1(y2)}`;
  }
  return ferme ? `${d}Z` : d;
}

/**
 * Volute : spirale rentrante qui part du creux `depart` vers l'intérieur du
 * nuage (`vers`), rayon extérieur `r`, `tours` tours, rayon final à 15 %.
 * Tracée en segments courts — 12 par tour suffisent à l'œil, même à 1200 px.
 */
export function volute(depart: Point, vers: Point, r: number, tours = 1.2, sens: 1 | -1 = 1): string {
  const dx = vers[0] - depart[0];
  const dy = vers[1] - depart[1];
  const l = Math.hypot(dx, dy) || 1;
  const cx = depart[0] + (dx / l) * r;
  const cy = depart[1] + (dy / l) * r;
  const a0 = Math.atan2(depart[1] - cy, depart[0] - cx);
  const pas = Math.ceil(tours * 12);
  let d = `M${r1(depart[0])} ${r1(depart[1])}`;
  for (let i = 1; i <= pas; i++) {
    const t = i / pas;
    const a = a0 + sens * t * Math.PI * 2 * tours;
    const rr = r * (1 - 0.85 * t);
    d += `L${r1(cx + rr * Math.cos(a))} ${r1(cy + rr * Math.sin(a))}`;
  }
  return d;
}

/** Rayon du lobe (arc) tendu sur la corde `corde` avec la flèche `h`. */
const rayonLobe = (corde: number, h: number) => (corde * corde) / (8 * h) + h / 2;

/**
 * Une volute par creux du contour : rayon = 0,45 × le rayon moyen des deux
 * lobes voisins (mesure manga), dirigée vers le centre de gravité du nuage,
 * sens alterné pour éviter la régularité mécanique.
 */
function volutes(
  contour: readonly Point[],
  fleches: readonly number[],
  creux: readonly number[],
  facteur = 0.45,
): string[] {
  const n = contour.length;
  const cg: Point = [contour.reduce((s, p) => s + p[0], 0) / n, contour.reduce((s, p) => s + p[1], 0) / n];
  return creux.map((i, k) => {
    const p = requiredIndex(contour, i);
    const prev = requiredIndex(contour, (i - 1 + n) % n);
    const next = requiredIndex(contour, (i + 1) % n);
    const rA = rayonLobe(Math.hypot(p[0] - prev[0], p[1] - prev[1]), requiredIndex(fleches, (i - 1 + n) % n));
    const rB = rayonLobe(Math.hypot(next[0] - p[0], next[1] - p[1]), requiredIndex(fleches, i));
    return volute(p, cg, ((rA + rB) / 2) * facteur, 1.2, k % 2 === 0 ? 1 : -1);
  });
}

export interface Nuage {
  largeur: number;
  hauteur: number;
  /** Silhouette fermée. */
  silhouette: string;
  /** Même contour remonté : ce qui dépasse en bas devient la bande d'ombre. */
  lumiere: string;
  /** Volutes d'encre, une par creux. */
  volutes: string[];
  /** Bourrelets intérieurs : lobes de premier plan, arcs d'encre ouverts. */
  interieurs: string[];
  /** Épaisseurs de trait, dans l'unité du viewBox. */
  traits: { encre: number; volute: number };
}

// ───────────────────────── Illustration 1200 × 676 ─────────────────────────

/**
 * Contour, sens horaire : flanc gauche, crête, queue courte, face inférieure.
 * Les y sont étirés de 1,27 : l'encre mesure ≈ 1100 × 630, ratio 1,75 (manga
 * couleur 1,77, cel Toei 1,89 ; la première version, à 2,29, était trop plate).
 */
const Y = (y: number) => y * 1.27 - 90;
const CONTOUR: Point[] = (
  [
    [84, 388],
    [162, 282],
    [292, 206],
    [452, 166],
    [628, 152],
    [790, 186],
    [930, 244],
    [1040, 296],
    [1112, 338],
    [1132, 392],
    [1064, 432],
    [980, 466],
    [900, 496],
    [772, 526],
    [630, 542],
    [486, 540],
    [352, 514],
    [216, 464],
  ] as Point[]
).map(([x, y]) => [x, Y(y)]);
const FLECHES = [54, 66, 74, 66, 56, 50, 40, 30, 22, 20, 24, 30, 46, 52, 52, 52, 50, 52];

/** Le décalage se réduit vers la queue pour qu'elle garde sa lumière. */
const ECLAIRE: Point[] = CONTOUR.map(([x, y]) => [x - 12 + x * 0.006, y - 168 + 96 * (x / 1200)]);

/** Lobes de premier plan : un arc bombé vers le haut, fini en volute à droite. */
const INTERIEURS: [Point, Point, number][] = [
  [[196, Y(436)], [352, Y(356)], 58],
  [[470, Y(402)], [650, Y(384)], 66],
  [[762, Y(424)], [906, Y(392)], 50],
  [[556, Y(272)], [704, Y(262)], 44],
];
const interieurs = (lobes: [Point, Point, number][], rayon: number) =>
  lobes.flatMap(([a, b, h], k) => [arcs([a, b], [h], false), volute(b, a, rayon, 1.1, k % 2 ? 1 : -1)]);

export const KINTO_UN_ILLUSTRATION: Nuage = {
  largeur: 1200,
  hauteur: 676,
  silhouette: arcs(CONTOUR, FLECHES),
  lumiere: arcs(ECLAIRE, FLECHES),
  volutes: [
    ...volutes(CONTOUR, FLECHES, [1, 2, 3, 4, 5, 6, 7, 13, 15, 17], 0.55),
    // La queue se referme en crochet, pas en bourrelet plein.
    volute(requiredIndex(CONTOUR, 9), [980, Y(380)], 26, 1.1, -1),
  ],
  interieurs: interieurs(INTERIEURS, 30),
  traits: { encre: 9, volute: 7 },
};

// ─────────────────────────── Icône 512 × 512 ───────────────────────────────

/**
 * Cinq gros lobes en haut (deux flancs, trois sur la crête), quatre petits en
 * bas. Boîte 40→472 × 96→418 : 432 × 322, ratio 1,34. Tout tient dans le cercle
 * de sécurité « maskable » (Ø 80 %) une fois réduit à 0,8.
 */
const CONTOUR_ICONE: Point[] = [
  [60, 302],
  [118, 194],
  [204, 128],
  [318, 128],
  [402, 194],
  [454, 302],
  [372, 392],
  [256, 404],
  [140, 392],
];
const FLECHES_ICONE = [62, 64, 74, 64, 62, 42, 36, 36, 42];
const ECLAIRE_ICONE: Point[] = CONTOUR_ICONE.map(([x, y]) => [x - 6, y - 94]);

export const KINTO_UN_ICONE: Nuage = {
  largeur: 512,
  hauteur: 512,
  silhouette: arcs(CONTOUR_ICONE, FLECHES_ICONE),
  lumiere: arcs(ECLAIRE_ICONE, FLECHES_ICONE),
  volutes: volutes(CONTOUR_ICONE, FLECHES_ICONE, [1, 2, 3, 4, 7], 0.5),
  interieurs: [],
  traits: { encre: 12, volute: 9 },
};

// ──────────────────────────── Sérialisation ────────────────────────────────

/**
 * Corps SVG du nuage (defs + tracés), sans balise racine : le composant React
 * et les fichiers SVG l'enveloppent chacun à leur façon. `prefixe` isole
 * l'identifiant du `clipPath` quand plusieurs nuages cohabitent dans une page.
 */
export function corpsNuage(n: Nuage, prefixe = "kt", avecVolutes = true): string {
  const c = KINTO_UN_COULEURS;
  const volutesSvg = avecVolutes
    ? `<g fill="none" stroke="${c.encre}" stroke-width="${n.traits.volute}" stroke-linecap="round" stroke-linejoin="round">
${[...n.interieurs, ...n.volutes].map(d => `<path d="${d}"/>`).join("\n")}
</g>
`
    : "";
  return `<defs><clipPath id="${prefixe}-clip"><path d="${n.silhouette}"/></clipPath></defs>
<path d="${n.silhouette}" fill="${c.ombre}"/>
<g clip-path="url(#${prefixe}-clip)">
<path d="${n.lumiere}" fill="${c.lumiere}"/>
${volutesSvg}</g>
<path d="${n.silhouette}" fill="none" stroke="${c.encre}" stroke-width="${n.traits.encre}" stroke-linejoin="round"/>`;
}

const DESC =
  "Le Kinto-Un, nuage magique de Son Goku : lobes jaune citron finis en volutes, ombre dorée sur la face inférieure, trait d'encre.";

/** SVG complet de l'illustration (`public/dbz/kinto-un.svg`). */
export function svgIllustration(): string {
  const n = KINTO_UN_ILLUSTRATION;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n.largeur} ${n.hauteur}" role="img" aria-labelledby="kt-t">
<title id="kt-t">Kinto-Un</title>
<desc>${DESC}</desc>
${corpsNuage(n, "kt")}
</svg>
`;
}

export interface OptionsIcone {
  /** Couleur de la pastille ; `null` → fond transparent. */
  pastille?: string | null;
  /** Rayon des coins de la pastille, en fraction du côté (0 = carré plein). */
  coins?: number;
  /** Échelle du nuage autour du centre (0,8 pour la zone sûre « maskable »). */
  echelle?: number;
  /** Volutes d'encre : à couper sous 64 px, elles deviennent du bruit. */
  volutes?: boolean;
}

/** Corps de l'icône carrée (pastille + nuage), sans balise racine. */
export function corpsIcone({
  pastille = KINTO_UN_COULEURS.pastille,
  coins = 0.22,
  echelle = 1,
  volutes: avecVolutes = true,
}: OptionsIcone = {}): string {
  const n = KINTO_UN_ICONE;
  const c = n.largeur / 2;
  const fond =
    pastille === null
      ? ""
      : `<rect width="${n.largeur}" height="${n.hauteur}" rx="${r1(n.largeur * coins)}" fill="${pastille}"/>\n`;
  const transform = echelle === 1 ? "" : ` transform="translate(${c} ${c}) scale(${echelle}) translate(${-c} ${-c})"`;
  return `${fond}<g${transform}>\n${corpsNuage(n, "kti", avecVolutes)}\n</g>`;
}

/** SVG complet de l'icône carrée (`public/dbz/kinto-un-icone.svg`, favicons). */
export function svgIcone(options: OptionsIcone = {}): string {
  const n = KINTO_UN_ICONE;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n.largeur} ${n.hauteur}" role="img" aria-labelledby="kti-t">
<title id="kti-t">Kinto-Un</title>
<desc>${DESC}</desc>
${corpsIcone(options)}
</svg>
`;
}

/** Silhouette monochrome pour `mask-icon` Safari : un seul aplat, pas de dégradé. */
export function svgMonochrome(): string {
  const n = KINTO_UN_ICONE;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n.largeur} ${n.hauteur}">
<path d="${n.silhouette}" fill="#000"/>
</svg>
`;
}
