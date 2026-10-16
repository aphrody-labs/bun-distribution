/**
 * Tests de la logique PURE de l'atlas de glyphes (aucun GPU, headless-safe) :
 *   - décodage des métriques `font_metrics.json` sur des glyphes connus (espace, A, 0, !) ;
 *   - conversion code SHIFT-JIS → Unicode (mono/double octet) ;
 *   - rectangle UV d'un glyphe (chute dans l'atlas) ;
 *   - layout d'une chaîne (largeurs/positions, avance, bearing, align) ;
 *   - algo de contour 8-tap (`computeOutlinePixel`, miroir CPU de `fs_glyph`).
 *
 * Fixture : `test/fixtures/font_metrics_ascii.json` = sous-ensemble RÉEL des 95 glyphes
 * ASCII canoniques (Var1==Var2, page 0) extrait du vrai `font_metrics.json` IEVR, +
 * l'en-tête `INF_0` intact (dimensions atlas 4096×2048, cellHeight 71).
 */

import { describe, expect, test } from "bun:test";
import {
  computeOutlinePixel,
  decodeFontMetrics,
  glyphUV,
  layoutText,
  measureText,
  OUTLINE_OFFSETS,
  type RawFontMetrics,
  sjisCodeToUnicode,
} from "./glyph-atlas";

const raw = JSON.parse(
  await Bun.file(new URL("../test/fixtures/font_metrics_ascii.json", import.meta.url)).text(),
) as RawFontMetrics;
const atlas = decodeFontMetrics(raw);

describe("sjisCodeToUnicode", () => {
  test("mono-octet ASCII (0x41 = 'A')", () => {
    expect(sjisCodeToUnicode(0x41)).toBe(0x41);
  });
  test("mono-octet espace", () => {
    expect(sjisCodeToUnicode(0x20)).toBe(0x20);
  });
  test("double-octet hiragana (0x82a0 = 'あ' U+3042)", () => {
    expect(sjisCodeToUnicode(0x82a0)).toBe(0x3042);
  });
  test("code invalide → null", () => {
    // 0x80 n'est ni ASCII ni un lead SJIS valide isolé.
    expect(sjisCodeToUnicode(0xfffe)).toBeNull();
  });
});

describe("decodeFontMetrics — en-tête INF_0", () => {
  test("dimensions atlas 4096×2048", () => {
    expect(atlas.info.atlasW).toBe(4096);
    expect(atlas.info.atlasH).toBe(2048);
  });
  test("hauteur de cellule 71 (interligne)", () => {
    expect(atlas.info.cellHeight).toBe(71);
  });
});

describe("decodeFontMetrics — glyphes connus (valeurs RÉELLES du jeu)", () => {
  test("'A' (U+0041) : x=1157 y=1 w=38 bearingX=1 advance=39", () => {
    const g = atlas.glyphs.get(0x41);
    expect(g).toBeDefined();
    expect(g!.x).toBe(1157);
    expect(g!.y).toBe(1);
    expect(g!.w).toBe(38);
    expect(g!.bearingX).toBe(1);
    expect(g!.advance).toBe(39);
    expect(g!.page).toBe(0);
  });
  test("'0' (U+0030) : x=486 w=31 advance=38", () => {
    const g = atlas.glyphs.get(0x30);
    expect(g!.x).toBe(486);
    expect(g!.w).toBe(31);
    expect(g!.advance).toBe(38);
  });
  test("'!' (U+0021) : x=14 w=7 advance=11", () => {
    const g = atlas.glyphs.get(0x21);
    expect(g!.x).toBe(14);
    expect(g!.w).toBe(7);
    expect(g!.advance).toBe(11);
  });
  test("espace (U+0020) : advance=16, glyphe sans encre (w=1)", () => {
    const g = atlas.glyphs.get(0x20);
    expect(g!.advance).toBe(16);
    expect(g!.w).toBe(1);
  });
});

describe("glyphUV — chute dans l'atlas [0..1]", () => {
  test("'A' UV exacts (x/4096, y/2048, (x+w)/4096, (y+71)/2048)", () => {
    const g = atlas.glyphs.get(0x41)!;
    const uv = glyphUV(g, atlas.info);
    expect(uv.u0).toBeCloseTo(1157 / 4096, 6);
    expect(uv.v0).toBeCloseTo(1 / 2048, 6);
    expect(uv.u1).toBeCloseTo((1157 + 38) / 4096, 6);
    expect(uv.v1).toBeCloseTo((1 + 71) / 2048, 6);
  });
  test("tous les UV ASCII restent dans [0,1]", () => {
    for (const g of atlas.glyphs.values()) {
      const uv = glyphUV(g, atlas.info);
      expect(uv.u0).toBeGreaterThanOrEqual(0);
      expect(uv.v0).toBeGreaterThanOrEqual(0);
      expect(uv.u1).toBeLessThanOrEqual(1);
      expect(uv.v1).toBeLessThanOrEqual(1);
    }
  });
});

describe("layoutText — layout horizontal", () => {
  test("hauteur = cellHeight × scale (size 71 → height 71)", () => {
    const l = layoutText(atlas, "A", 71);
    expect(l.height).toBeCloseTo(71, 6);
  });

  test("largeur de 'AB' = somme des avances (à l'échelle)", () => {
    const a = atlas.glyphs.get(0x41)!; // advance 39
    const b = atlas.glyphs.get(0x42)!;
    const size = 71; // scale = 1
    const l = layoutText(atlas, "AB", size);
    expect(l.width).toBeCloseTo(a.advance + b.advance, 6);
  });

  test("scale : size 35.5 → scale 0.5, avances divisées par 2", () => {
    const a = atlas.glyphs.get(0x41)!;
    const l = layoutText(atlas, "A", 35.5);
    // un seul glyphe : width = advance × 0.5
    expect(l.width).toBeCloseTo(a.advance * 0.5, 6);
    expect(l.height).toBeCloseTo(35.5, 6);
  });

  test("position du 2e glyphe = avance du 1er + bearingX du 2e (échelle 1)", () => {
    const a = atlas.glyphs.get(0x41)!;
    const b = atlas.glyphs.get(0x42)!;
    const l = layoutText(atlas, "AB", 71);
    // quad[0].x = bearingX(A) ; quad[1].x = advance(A) + bearingX(B)
    expect(l.quads[0]!.x).toBeCloseTo(a.bearingX, 6);
    expect(l.quads[1]!.x).toBeCloseTo(a.advance + b.bearingX, 6);
  });

  test("align center décale de -width/2", () => {
    const left = layoutText(atlas, "ABC", 71, "left");
    const center = layoutText(atlas, "ABC", 71, "center");
    expect(center.quads[0]!.x).toBeCloseTo(left.quads[0]!.x - left.width / 2, 6);
    expect(center.width).toBeCloseTo(left.width, 6);
  });

  test("align right décale de -width", () => {
    const left = layoutText(atlas, "ABC", 71, "left");
    const right = layoutText(atlas, "ABC", 71, "right");
    expect(right.quads[0]!.x).toBeCloseTo(left.quads[0]!.x - left.width, 6);
  });

  test("un quad par glyphe à encre, espace n'émet pas de quad mais avance", () => {
    const l = layoutText(atlas, "A B", 71);
    // 'A' + espace (pas de quad) + 'B' → 2 quads
    expect(l.quads).toHaveLength(2);
    const a = atlas.glyphs.get(0x41)!;
    const sp = atlas.glyphs.get(0x20)!;
    const b = atlas.glyphs.get(0x42)!;
    // 2e quad démarre après avance(A)+avance(espace)+bearingX(B)
    expect(l.quads[1]!.x).toBeCloseTo(a.advance + sp.advance + b.bearingX, 6);
  });

  test("measureText == layoutText.width", () => {
    expect(measureText(atlas, "Hello!", 42)).toBeCloseTo(layoutText(atlas, "Hello!", 42).width, 6);
  });
});

describe("computeOutlinePixel — dilatation 8-tap (miroir de fs_glyph)", () => {
  const fill: [number, number, number, number] = [1, 1, 1, 1]; // blanc
  const outline: [number, number, number, number] = [0, 0, 0, 1]; // noir

  test("OUTLINE_OFFSETS = 8 directions, rayon conservé (norme ≈ 1)", () => {
    expect(OUTLINE_OFFSETS).toHaveLength(8);
    for (const [dx, dy] of OUTLINE_OFFSETS) {
      expect(Math.hypot(dx, dy)).toBeCloseTo(1, 6);
    }
  });

  test("centre plein (fill=1) → couleur de remplissage, alpha plein", () => {
    const px = computeOutlinePixel(1, [1, 1, 1, 1, 1, 1, 1, 1], fill, outline);
    // prémultiplié : rgb*a avec a=1, fill=blanc → (1,1,1,1)
    expect(px).toEqual([1, 1, 1, 1]);
  });

  test("centre vide mais anneau couvert → couleur de CONTOUR (noir), alpha plein", () => {
    // fill=0 → rgb = outline (noir) ; outline coverage = max(0, ring) = 1 → a=1
    const px = computeOutlinePixel(0, [1, 0, 0, 0, 0, 0, 0, 0], fill, outline);
    expect(px[3]).toBeCloseTo(1, 6); // alpha = 1 (dilaté)
    // rgb prémultiplié = noir*1 = (0,0,0)
    expect(px[0]).toBeCloseTo(0, 6);
    expect(px[1]).toBeCloseTo(0, 6);
    expect(px[2]).toBeCloseTo(0, 6);
  });

  test("hors de toute couverture (fill=0, anneau=0) → transparent", () => {
    const px = computeOutlinePixel(0, [0, 0, 0, 0, 0, 0, 0, 0], fill, outline);
    expect(px).toEqual([0, 0, 0, 0]);
  });

  test("bord partiel : fill=0.5 → mix outline/fill, alpha = max", () => {
    const px = computeOutlinePixel(0.5, [1, 0, 0, 0, 0, 0, 0, 0], fill, outline);
    // outline coverage = max(0.5, 1) = 1 ; rgb non-prémult = mix(noir, blanc, 0.5) = 0.5
    // a = 1 * fillAlpha(1) * opacity(1) = 1 ; prémult rgb = 0.5*1 = 0.5
    expect(px[3]).toBeCloseTo(1, 6);
    expect(px[0]).toBeCloseTo(0.5, 6);
  });

  test("opacité d'instance module l'alpha final", () => {
    const px = computeOutlinePixel(1, [1, 1, 1, 1, 1, 1, 1, 1], fill, outline, 0.5);
    expect(px[3]).toBeCloseTo(0.5, 6);
    // prémultiplié : rgb = blanc * 0.5
    expect(px[0]).toBeCloseTo(0.5, 6);
  });
});
