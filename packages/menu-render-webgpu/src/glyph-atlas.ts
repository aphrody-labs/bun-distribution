/**
 * glyph-atlas — décodage des métriques de police IEVR + layout de glyphes.
 *
 * Source : `font_metrics.json` extrait du `font_def.g4tx` (cf.
 * `iecode/re/menu/extracted/fonts/`). Le jeu rend le texte du menu via un **atlas de
 * glyphes** (`font_def.png`, 4096×2048) échantillonné par les shaders `2d_font*.pfxo`,
 * et NON via une police système. Ce module porte cet atlas côté WebGPU.
 *
 * ── Format des métriques (décodé par RE, cf. `font-atlas-notes.md`) ──────────────────
 * `Encoding: shift_jis`. Le fichier est une liste d'`Entries`.
 *
 * Entrée d'en-tête `INF_0` (Variables, dans l'ordre) :
 *   [0]=0  [1]=46 (largeur de cellule max)  [2]=71 (HAUTEUR de cellule / interligne)
 *   [3]=25 (ascent ≈ ligne de base depuis le haut, approx.)  [4]=7469 (nb de glyphes)
 *   [5]=4096 (largeur atlas)  [6]=2048 (hauteur atlas)  [7]=0.
 *
 * Entrées `CHR_N` (un glyphe), Variables dans l'ordre :
 *   [0] page    — index de page d'atlas (0 = `font_def`, 1 = `gaiji`).
 *   [1] code    — code SHIFT-JIS du glyphe (mono-octet < 0x100, sinon big-endian 2 octets).
 *   [2] index   — index séquentiel interne du glyphe (≈ code pour l'ASCII canonique).
 *   [3] x       — position X du coin haut-gauche dans l'atlas (px).
 *   [4] y       — position Y du coin haut-gauche dans l'atlas (px).
 *   [5] width   — largeur de la cellule du glyphe dans l'atlas (px).
 *   [6] bearingX— décalage horizontal gauche (px) avant de dessiner le glyphe.
 *   [7] advance — avance du curseur (px) après le glyphe.
 *   [8] subpage — variante de sous-page (0..3) ; non utilisé pour l'UV (cf. notes).
 *
 * La HAUTEUR du glyphe n'est PAS stockée par glyphe : la cellule a une hauteur fixe
 * `cellHeight` (= INF[2] = 71) et tous les glyphes partagent une ligne de base commune
 * baked dans la cellule (vérifié sur l'atlas : 'A','g','p' alignés). On place donc la
 * cellule entière, baseline-alignée, sans bearingY par glyphe.
 *
 * Toute la logique ici est PURE (aucune API GPU/DOM) → testable headless.
 */

/** Métrique décodée d'un glyphe (coordonnées en pixels atlas). */
export interface Glyph {
  /** Page d'atlas (0 = font_def, 1 = gaiji). */
  page: number;
  /** X du coin haut-gauche dans l'atlas (px). */
  x: number;
  /** Y du coin haut-gauche dans l'atlas (px). */
  y: number;
  /** Largeur de la cellule du glyphe (px). */
  w: number;
  /** Décalage gauche avant dessin (px). */
  bearingX: number;
  /** Avance du curseur après le glyphe (px). */
  advance: number;
}

/** En-tête décodé (`INF_0`). */
export interface AtlasInfo {
  /** Largeur de l'atlas (px) — diviseur des U. */
  atlasW: number;
  /** Hauteur de l'atlas (px) — diviseur des V. */
  atlasH: number;
  /** Hauteur de cellule fixe / interligne (px). */
  cellHeight: number;
  /** Largeur de cellule max (px) — informatif. */
  cellWidthMax: number;
  /** Ascent : ligne de base depuis le haut de la cellule (px, approx.). */
  ascent: number;
  /** Nombre de glyphes déclaré. */
  glyphCount: number;
}

/** Atlas de glyphes décodé : info + map codepoint Unicode → glyphe. */
export interface GlyphAtlas {
  info: AtlasInfo;
  /** Clé = codepoint **Unicode** (résolu depuis le code SJIS). */
  glyphs: Map<number, Glyph>;
}

/* ── Forme brute du JSON `font_metrics.json` ─────────────────────────────────── */

interface RawVariable {
  Name: string;
  Type: string;
  Value: number;
}
interface RawEntry {
  Name: string;
  EndTerminator?: boolean;
  Variables: RawVariable[];
}
/** Forme minimale attendue de `font_metrics.json`. */
export interface RawFontMetrics {
  Encoding: string;
  Entries: RawEntry[];
}

/** Index des Variables d'une entrée `CHR_N` (cf. doc de tête). */
const CHR = {
  page: 0,
  code: 1,
  index: 2,
  x: 3,
  y: 4,
  width: 5,
  bearingX: 6,
  advance: 7,
  subpage: 8,
} as const;

/** Index des Variables de l'en-tête `INF_0`. */
const INF = {
  cellWidthMax: 1,
  cellHeight: 2,
  ascent: 3,
  glyphCount: 4,
  atlasW: 5,
  atlasH: 6,
} as const;

const sjisDecoder = new TextDecoder("shift_jis", { fatal: false });

/**
 * Convertit un code SHIFT-JIS (tel que stocké dans `CHR_N[1]`) en codepoint Unicode.
 *
 * Mono-octet (< 0x100) → un octet ; sinon → deux octets big-endian (lead, trail).
 * Retourne `null` si le décodage donne le caractère de remplacement (code invalide),
 * pour ne pas créer d'entrée fantôme dans la map.
 */
export function sjisCodeToUnicode(code: number): number | null {
  const bytes =
    code < 0x100 ? new Uint8Array([code]) : new Uint8Array([(code >> 8) & 0xff, code & 0xff]);
  const s = sjisDecoder.decode(bytes);
  if (s.length === 0) {
    return null;
  }
  const cp = s.codePointAt(0);
  if (cp === undefined || cp === 0xfffd) {
    return null;
  }
  return cp;
}

/**
 * Décode `font_metrics.json` (déjà parsé) en `GlyphAtlas`.
 *
 * - Lit l'en-tête `INF_0` pour les dimensions d'atlas et la hauteur de cellule.
 * - Pour chaque `CHR_N`, résout le code SJIS → Unicode et indexe le glyphe.
 * - En cas de doublon de codepoint (variantes pleine/demi-chasse), la **première**
 *   occurrence (forme canonique mono-octet, listée en premier) est conservée.
 *
 * Pur et déterministe.
 */
export function decodeFontMetrics(raw: RawFontMetrics): GlyphAtlas {
  const inf = raw.Entries.find((e) => e.Name === "INF_0");
  if (!inf) {
    throw new Error("font_metrics: entrée INF_0 absente");
  }
  const iv = inf.Variables;
  const info: AtlasInfo = {
    atlasW: iv[INF.atlasW]?.Value ?? 4096,
    atlasH: iv[INF.atlasH]?.Value ?? 2048,
    cellHeight: iv[INF.cellHeight]?.Value ?? 71,
    cellWidthMax: iv[INF.cellWidthMax]?.Value ?? 46,
    ascent: iv[INF.ascent]?.Value ?? 25,
    glyphCount: iv[INF.glyphCount]?.Value ?? 0,
  };

  const glyphs = new Map<number, Glyph>();
  for (const entry of raw.Entries) {
    if (!entry.Name.startsWith("CHR_")) {
      continue;
    }
    const v = entry.Variables;
    const code = v[CHR.code]?.Value;
    if (code === undefined) {
      continue;
    }
    const cp = sjisCodeToUnicode(code);
    if (cp === null || glyphs.has(cp)) {
      continue;
    }
    glyphs.set(cp, {
      page: v[CHR.page]?.Value ?? 0,
      x: v[CHR.x]?.Value ?? 0,
      y: v[CHR.y]?.Value ?? 0,
      w: v[CHR.width]?.Value ?? 0,
      bearingX: v[CHR.bearingX]?.Value ?? 0,
      advance: v[CHR.advance]?.Value ?? 0,
    });
  }

  return { info, glyphs };
}

/** Codepoints d'espacement (cellule d'atlas vide) : on avance sans émettre de quad. */
function isWhitespace(cp: number): boolean {
  // espace ASCII, tab, espace insécable, espace idéographique (fullwidth U+3000).
  return cp === 0x20 || cp === 0x09 || cp === 0xa0 || cp === 0x3000;
}

/** Rectangle UV normalisé [0..1] d'un glyphe dans l'atlas (coin haut-gauche + bas-droit). */
export interface GlyphUV {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** Calcule le rectangle UV [0..1] d'un glyphe (cellule pleine hauteur). */
export function glyphUV(g: Glyph, info: AtlasInfo): GlyphUV {
  return {
    u0: g.x / info.atlasW,
    v0: g.y / info.atlasH,
    u1: (g.x + g.w) / info.atlasW,
    v1: (g.y + info.cellHeight) / info.atlasH,
  };
}

/* ── Layout de chaîne ────────────────────────────────────────────────────────── */

/** Un quad de glyphe positionné (coordonnées px à la taille demandée, origine ligne). */
export interface GlyphQuad {
  /** X gauche du quad (px), incluant bearingX. */
  x: number;
  /** Y haut du quad (px), 0 = haut de la cellule de la ligne. */
  y: number;
  /** Largeur du quad (px). */
  w: number;
  /** Hauteur du quad (px) = cellule mise à l'échelle. */
  h: number;
  /** UV dans l'atlas. */
  uv: GlyphUV;
  /** Page d'atlas du glyphe (0/1). */
  page: number;
}

/** Résultat d'un layout de chaîne : quads + boîte englobante. */
export interface TextLayout {
  quads: GlyphQuad[];
  /** Largeur totale (avance cumulée) en px à la taille demandée. */
  width: number;
  /** Hauteur de ligne en px à la taille demandée (= cellHeight mis à l'échelle). */
  height: number;
}

/**
 * Dispose une chaîne en quads de glyphes (layout horizontal, baseline implicite).
 *
 * - `size` = hauteur visée en px ; l'échelle = `size / cellHeight` du jeu.
 * - Chaque glyphe avance de `advance * scale` ; le quad démarre à
 *   `penX + bearingX * scale`.
 * - Les codepoints absents de l'atlas (ex. caractères non couverts) sont **sautés**
 *   mais consomment l'avance d'un espace si présent (sinon ignorés) — documenté.
 * - `align` décale l'ensemble : `left` (0), `center` (-width/2), `right` (-width).
 *
 * Pur et déterministe (testable headless).
 */
export function layoutText(
  atlas: GlyphAtlas,
  text: string,
  size: number,
  align: "left" | "center" | "right" = "left",
): TextLayout {
  const scale = size / atlas.info.cellHeight;
  const height = atlas.info.cellHeight * scale;
  const quads: GlyphQuad[] = [];
  let penX = 0;

  // Itère par codepoint (gère les paires de substitution / hors-BMP).
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) {
      continue;
    }
    const g = atlas.glyphs.get(cp);
    if (!g) {
      // Glyphe non couvert : on consomme une largeur de repli = espace si connu,
      // sinon une demi-cellule, pour ne pas chevaucher (documenté dans les notes).
      const space = atlas.glyphs.get(0x20);
      penX += (space ? space.advance : atlas.info.cellWidthMax / 2) * scale;
      continue;
    }
    // Les caractères d'espacement (espace, tab) ont une cellule vide dans l'atlas :
    // on avance sans émettre de quad (économie d'instances, pas de pixel à dessiner).
    if (!isWhitespace(cp)) {
      const qx = penX + g.bearingX * scale;
      quads.push({
        x: qx,
        y: 0,
        w: g.w * scale,
        h: height,
        uv: glyphUV(g, atlas.info),
        page: g.page,
      });
    }
    penX += g.advance * scale;
  }

  const width = penX;
  let shift = 0;
  if (align === "center") {
    shift = -width / 2;
  } else if (align === "right") {
    shift = -width;
  }
  if (shift !== 0) {
    for (const q of quads) {
      q.x += shift;
    }
  }

  return { quads, width, height };
}

/** Mesure la largeur d'une chaîne (px) sans produire de quads. */
export function measureText(atlas: GlyphAtlas, text: string, size: number): number {
  const scale = size / atlas.info.cellHeight;
  let penX = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) {
      continue;
    }
    const g = atlas.glyphs.get(cp);
    if (!g) {
      const space = atlas.glyphs.get(0x20);
      penX += (space ? space.advance : atlas.info.cellWidthMax / 2) * scale;
      continue;
    }
    penX += g.advance * scale;
  }
  return penX; // déjà en pixels (advance × scale cumulé)
}

/**
 * Parse + décode un `font_metrics.json` depuis son texte JSON brut.
 * Pratique pour charger une fixture ou un asset CDN (`await fetch(...).text()`).
 */
export function parseFontMetrics(jsonText: string): GlyphAtlas {
  return decodeFontMetrics(JSON.parse(jsonText) as RawFontMetrics);
}

/* ── Logique pure de contour (miroir CPU de `fs_glyph` / `2d_font_outline.pfxo`) ── */

/** Les 8 décalages de l'anneau de dilatation, en unités du rayon de contour. */
export const OUTLINE_OFFSETS: ReadonlyArray<readonly [number, number]> = (() => {
  const d = 1;
  const dd = Math.SQRT1_2; // 0.70710677, conserve la longueur du rayon en diagonale
  return [
    [d, 0],
    [-d, 0],
    [0, d],
    [0, -d],
    [dd, dd],
    [-dd, dd],
    [dd, -dd],
    [-dd, -dd],
  ];
})();

/** Couleur RGBA prémultipliée (composantes 0..1). */
export type Rgba = [number, number, number, number];

/**
 * Calcule la couleur de sortie d'un pixel de glyphe selon l'algo `2d_font_outline.pfxo`,
 * étant donné la couverture du centre et les 8 couvertures de l'anneau dilaté.
 *
 * Réplique EXACTE de `fs_glyph` : `outline = max(fill, …8 taps…)`,
 * `rgb = mix(outline, fill, fillCoverage)`, `alpha = outline * fillAlpha * opacity`,
 * sortie **prémultipliée** `(rgb*a, a)`. Permet de vérifier la logique headless.
 *
 * @param fillCoverage   couverture (alpha atlas) au centre [0..1].
 * @param ringCoverage   8 couvertures aux décalages (mêmes ordre que `OUTLINE_OFFSETS`).
 * @param fillColor      couleur de remplissage RGBA non prémultipliée (0..1).
 * @param outlineColor   couleur de contour RGBA non prémultipliée (0..1).
 * @param opacity        opacité d'instance [0..1].
 */
export function computeOutlinePixel(
  fillCoverage: number,
  ringCoverage: readonly number[],
  fillColor: Rgba,
  outlineColor: Rgba,
  opacity = 1,
): Rgba {
  let outline = fillCoverage;
  for (const c of ringCoverage) {
    outline = Math.max(outline, c);
  }
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  const r = mix(outlineColor[0], fillColor[0], fillCoverage);
  const g = mix(outlineColor[1], fillColor[1], fillCoverage);
  const b = mix(outlineColor[2], fillColor[2], fillCoverage);
  const a = outline * fillColor[3] * opacity;
  return [r * a, g * a, b * a, a];
}
