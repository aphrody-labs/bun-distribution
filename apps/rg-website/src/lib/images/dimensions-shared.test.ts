/**
 * Tests de la lecture des dimensions dans un en-tête d'image.
 *
 * C'est de l'analyse d'octets : quand elle se trompe, elle ne lève pas — elle
 * rend une largeur et une hauteur plausibles mais fausses, et la page réserve
 * un cadre aux mauvaises proportions. Le seul contrôle qui vaut est donc de
 * comparer à des tailles CONNUES.
 *
 * ⚠ AUCUNE FIXTURE INVENTÉE : les octets ci-dessous sont construits selon les
 * spécifications de chaque format, et les deux cas WebP réels sont les visuels
 * de la campagne en cours, mesurés le 13/8/2026 avec `identify` :
 * `affiche.webp` = 1051 × 1447, `reglement.webp` = 1600 × 2197.
 */

import { describe, expect, test } from "bun:test";

import { lireDimensions } from "./dimensions-shared";

/** En-tête PNG minimal : signature + longueur + `IHDR` + largeur/hauteur. */
function png(largeur: number, hauteur: number): Uint8Array {
  const o = new Uint8Array(24);
  const v = new DataView(o.buffer);
  o.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  v.setUint32(8, 13);
  v.setUint32(12, 0x49484452); // "IHDR"
  v.setUint32(16, largeur);
  v.setUint32(20, hauteur);
  return o;
}

/** En-tête GIF : `GIF89a` puis largeur/hauteur en petit-boutiste. */
function gif(largeur: number, hauteur: number): Uint8Array {
  const o = new Uint8Array(13);
  const v = new DataView(o.buffer);
  o.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
  v.setUint16(6, largeur, true);
  v.setUint16(8, hauteur, true);
  return o;
}

/** JPEG : SOI, un segment APP0 à sauter, puis le SOF0 qui porte la taille. */
function jpeg(largeur: number, hauteur: number): Uint8Array {
  const o = new Uint8Array(40);
  const v = new DataView(o.buffer);
  v.setUint16(0, 0xffd8); // SOI
  v.setUint16(2, 0xffe0); // APP0
  v.setUint16(4, 16); // longueur du segment (à sauter en entier)
  v.setUint16(20, 0xffc0); // SOF0
  v.setUint16(22, 17); // longueur
  o[24] = 8; // précision
  v.setUint16(25, hauteur);
  v.setUint16(27, largeur);
  return o;
}

/** WebP avec perte (`VP8 `) : taille sur 14 bits, petit-boutiste. */
function webpVp8(largeur: number, hauteur: number): Uint8Array {
  const o = new Uint8Array(32);
  const v = new DataView(o.buffer);
  v.setUint32(0, 0x52494646); // "RIFF"
  v.setUint32(8, 0x57454250); // "WEBP"
  v.setUint32(12, 0x56503820); // "VP8 "
  v.setUint16(26, largeur & 0x3fff, true);
  v.setUint16(28, hauteur & 0x3fff, true);
  return o;
}

/** WebP étendu (`VP8X`) : tailles sur 24 bits, MOINS UN. */
function webpVp8x(largeur: number, hauteur: number): Uint8Array {
  const o = new Uint8Array(32);
  const v = new DataView(o.buffer);
  v.setUint32(0, 0x52494646);
  v.setUint32(8, 0x57454250);
  v.setUint32(12, 0x56503858); // "VP8X"
  const ecrire24 = (decalage: number, valeur: number) => {
    o[decalage] = valeur & 0xff;
    o[decalage + 1] = (valeur >> 8) & 0xff;
    o[decalage + 2] = (valeur >> 16) & 0xff;
  };
  ecrire24(24, largeur - 1);
  ecrire24(27, hauteur - 1);
  return o;
}

/** WebP sans perte (`VP8L`) : 14 bits de largeur puis 14 de hauteur, moins un. */
function webpVp8l(largeur: number, hauteur: number): Uint8Array {
  const o = new Uint8Array(32);
  const v = new DataView(o.buffer);
  v.setUint32(0, 0x52494646);
  v.setUint32(8, 0x57454250);
  v.setUint32(12, 0x5650384c); // "VP8L"
  o[20] = 0x2f; // octet de signature VP8L
  const bits = (largeur - 1) | ((hauteur - 1) << 14);
  o[21] = bits & 0xff;
  o[22] = (bits >> 8) & 0xff;
  o[23] = (bits >> 16) & 0xff;
  o[24] = (bits >> 24) & 0xff;
  return o;
}

describe("formats reconnus", () => {
  test("PNG", () => {
    expect(lireDimensions(png(1051, 1447))).toEqual({ hauteur: 1447, largeur: 1051 });
  });

  test("GIF", () => {
    expect(lireDimensions(gif(320, 240))).toEqual({ hauteur: 240, largeur: 320 });
  });

  test("JPEG — la taille n'est PAS à un décalage fixe", () => {
    // Le SOF0 arrive après un nombre variable de segments de métadonnées : lire
    // à un décalage constant marche sur un fichier et échoue sur le suivant.
    expect(lireDimensions(jpeg(1600, 2197))).toEqual({ hauteur: 2197, largeur: 1600 });
  });

  test("WebP avec perte (VP8 ) — l'affiche réelle de la campagne", () => {
    expect(lireDimensions(webpVp8(1051, 1447))).toEqual({ hauteur: 1447, largeur: 1051 });
  });

  test("WebP étendu (VP8X) — la carte des règles réelle", () => {
    expect(lireDimensions(webpVp8x(1600, 2197))).toEqual({ hauteur: 2197, largeur: 1600 });
  });

  test("WebP sans perte (VP8L)", () => {
    // Les trois variantes encodent la taille différemment : n'en gérer qu'une
    // revient à ne rien gérer, nos visuels étant convertis en WebP.
    expect(lireDimensions(webpVp8l(1051, 1447))).toEqual({ hauteur: 1447, largeur: 1051 });
  });
});

describe("entrées qui ne sont pas des images", () => {
  test("trop court", () => {
    expect(lireDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  test("octets quelconques", () => {
    expect(lireDimensions(new Uint8Array(64).fill(0x42))).toBeNull();
  });

  test("une dimension nulle est un en-tête MAL LU, pas une image", () => {
    // La propager donnerait une division par zéro dans le calcul de proportions,
    // et un cadre de hauteur infinie.
    expect(lireDimensions(png(0, 100))).toBeNull();
    expect(lireDimensions(png(100, 0))).toBeNull();
  });

  test("une signature PNG sans chunk IHDR ne rend rien", () => {
    const o = png(10, 10);
    new DataView(o.buffer).setUint32(12, 0x74455874); // "tEXt" au lieu d'IHDR
    expect(lireDimensions(o)).toBeNull();
  });
});
