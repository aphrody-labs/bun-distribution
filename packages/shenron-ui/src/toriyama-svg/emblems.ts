/**
 * Toriyama SVG Engine — Official Emblems & Kanji Crests.
 *
 * Vector geometries for official Dragon Ball insignias, measured on a 100x100 viewBox:
 * - KAME (龜): Turtle School Kanji
 * - GO (悟): Son Goku Kanji
 * - KAI (界): King Kai (Kaio-sama) Kanji
 * - DEMON (魔): Demon Clan / Piccolo Jr. Kanji
 * - CAPSULE_CORP: Official dual-concentric "C"
 * - RED_RIBBON: Military RR double ribbon
 * - MAJIN: Cursed M brand
 * - TENKAICHI: World Martial Arts Tournament
 * - VEGETA_ROYAL: Saiyan Royal Crest
 */

export interface EmblemDefinition {
  id: string;
  title: string;
  kanji?: string;
  viewBox: string;
  bgCircleColor?: string;
  inkColor: string;
  innerCircleColor?: string;
  paths: {
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  }[];
}

export const EMBLEMS: Record<string, EmblemDefinition> = {
  kame: {
    id: "kame",
    title: "Kame School Crest",
    kanji: "龜",
    viewBox: "0 0 100 100",
    bgCircleColor: "#ff6b00",
    innerCircleColor: "#ffffff",
    inkColor: "#121417",
    paths: [
      // Outer thick ink ring
      {
        d: "M 50 4 A 46 46 0 1 1 49.9 4 Z",
        fill: "none",
        stroke: "#121417",
        strokeWidth: 5,
      },
      // Inner white disc
      { d: "M 50 8 A 42 42 0 1 1 49.9 8 Z", fill: "#ffffff" },
      // Kanji 龜 (Turtle) strokes with authentic brush weight
      { d: "M 28 26 L 72 26", stroke: "#121417", strokeWidth: 5 },
      { d: "M 42 26 L 28 40", stroke: "#121417", strokeWidth: 5 },
      {
        d: "M 28 40 L 72 40 L 72 68 L 28 68 Z",
        fill: "none",
        stroke: "#121417",
        strokeWidth: 5,
      },
      { d: "M 28 54 L 72 54", stroke: "#121417", strokeWidth: 4.5 },
      { d: "M 50 40 L 50 68", stroke: "#121417", strokeWidth: 4.5 },
      { d: "M 32 78 L 42 78", stroke: "#121417", strokeWidth: 5 },
      { d: "M 58 78 L 68 78", stroke: "#121417", strokeWidth: 5 },
      { d: "M 50 68 L 50 82", stroke: "#121417", strokeWidth: 5 },
    ],
  },

  go: {
    id: "go",
    title: "Son Goku Crest",
    kanji: "悟",
    viewBox: "0 0 100 100",
    bgCircleColor: "#f85b1a",
    innerCircleColor: "#ffffff",
    inkColor: "#121417",
    paths: [
      // Outer thick ink ring
      {
        d: "M 50 4 A 46 46 0 1 1 49.9 4 Z",
        fill: "none",
        stroke: "#121417",
        strokeWidth: 5,
      },
      // Inner white disc
      { d: "M 50 8 A 42 42 0 1 1 49.9 8 Z", fill: "#ffffff" },
      // Left radical: 忄 (heart / spirit)
      { d: "M 32 24 L 32 76", stroke: "#121417", strokeWidth: 5 },
      { d: "M 22 36 L 29 44", stroke: "#121417", strokeWidth: 5 },
      { d: "M 35 48 L 42 40", stroke: "#121417", strokeWidth: 4.5 },
      // Right radical: 吾 (five mouths / self)
      { d: "M 48 26 L 80 26", stroke: "#121417", strokeWidth: 5 },
      { d: "M 62 26 L 54 44", stroke: "#121417", strokeWidth: 4.5 },
      { d: "M 46 44 L 82 44", stroke: "#121417", strokeWidth: 5 },
      { d: "M 74 28 L 74 44", stroke: "#121417", strokeWidth: 4.5 },
      // Bottom mouth box 口
      {
        d: "M 50 54 L 78 54 L 78 76 L 50 76 Z",
        fill: "none",
        stroke: "#121417",
        strokeWidth: 5,
      },
    ],
  },

  kai: {
    id: "kai",
    title: "King Kai Crest",
    kanji: "界",
    viewBox: "0 0 100 100",
    bgCircleColor: "#d90429",
    innerCircleColor: "#111111",
    inkColor: "#f8f9fa",
    paths: [
      // Outer red ring
      {
        d: "M 50 4 A 46 46 0 1 1 49.9 4 Z",
        fill: "none",
        stroke: "#d90429",
        strokeWidth: 5,
      },
      // Inner black disc
      { d: "M 50 8 A 42 42 0 1 1 49.9 8 Z", fill: "#111111" },
      // Kanji 界 (World / Realm) in bright white
      // Upper: 田 (field grid)
      {
        d: "M 30 22 L 70 22 L 70 48 L 30 48 Z",
        fill: "none",
        stroke: "#f8f9fa",
        strokeWidth: 5,
      },
      { d: "M 50 22 L 50 48", stroke: "#f8f9fa", strokeWidth: 4.5 },
      { d: "M 30 35 L 70 35", stroke: "#f8f9fa", strokeWidth: 4.5 },
      // Lower: 介 (surround / mediate)
      { d: "M 50 52 L 28 72", stroke: "#f8f9fa", strokeWidth: 5 },
      { d: "M 50 52 L 72 72", stroke: "#f8f9fa", strokeWidth: 5 },
      { d: "M 36 68 L 36 82", stroke: "#f8f9fa", strokeWidth: 4.5 },
      { d: "M 64 68 L 64 82", stroke: "#f8f9fa", strokeWidth: 4.5 },
    ],
  },

  demon: {
    id: "demon",
    title: "Demon Clan Crest (Piccolo)",
    kanji: "魔",
    viewBox: "0 0 100 100",
    bgCircleColor: "#5a189a",
    innerCircleColor: "#ffffff",
    inkColor: "#121417",
    paths: [
      // Outer thick ink ring
      {
        d: "M 50 4 A 46 46 0 1 1 49.9 4 Z",
        fill: "none",
        stroke: "#121417",
        strokeWidth: 5,
      },
      // Inner white disc
      { d: "M 50 8 A 42 42 0 1 1 49.9 8 Z", fill: "#ffffff" },
      // Kanji 魔 (Demon / Magic)
      // Upper cliff radical 广
      { d: "M 50 18 L 50 24", stroke: "#121417", strokeWidth: 5 },
      { d: "M 24 25 L 76 25", stroke: "#121417", strokeWidth: 5 },
      { d: "M 28 25 L 28 52", stroke: "#121417", strokeWidth: 4.5 },
      // Middle twin trees 林
      { d: "M 34 33 L 48 33", stroke: "#121417", strokeWidth: 3.5 },
      { d: "M 41 28 L 41 46", stroke: "#121417", strokeWidth: 3.5 },
      { d: "M 54 33 L 68 33", stroke: "#121417", strokeWidth: 3.5 },
      { d: "M 61 28 L 61 46", stroke: "#121417", strokeWidth: 3.5 },
      // Lower ghost radical 鬼
      {
        d: "M 34 54 L 66 54 L 66 68 L 34 68 Z",
        fill: "none",
        stroke: "#121417",
        strokeWidth: 4.5,
      },
      {
        d: "M 48 68 L 48 82 L 68 82 L 72 74",
        fill: "none",
        stroke: "#121417",
        strokeWidth: 5,
      },
      { d: "M 36 74 L 28 82", stroke: "#121417", strokeWidth: 4.5 },
    ],
  },

  capsuleCorp: {
    id: "capsuleCorp",
    title: "Capsule Corporation Official Emblem",
    viewBox: "0 0 100 100",
    bgCircleColor: "#00b4d8",
    innerCircleColor: "#ffffff",
    inkColor: "#121417",
    paths: [
      // Outer circular frame
      {
        d: "M 50 4 A 46 46 0 1 1 49.9 4 Z",
        fill: "none",
        stroke: "#121417",
        strokeWidth: 5,
      },
      { d: "M 50 8 A 42 42 0 1 1 49.9 8 Z", fill: "#ffffff" },
      // Large Outer "C"
      {
        d: "M 70 26 A 32 32 0 1 0 70 74 L 62 74 A 24 24 0 1 1 62 26 Z",
        fill: "#121417",
      },
      // Small Inner "C"
      {
        d: "M 60 38 A 18 18 0 1 0 60 62 L 54 62 A 12 12 0 1 1 54 38 Z",
        fill: "#00b4d8",
      },
    ],
  },

  redRibbon: {
    id: "redRibbon",
    title: "Red Ribbon Army Insignia",
    viewBox: "0 0 100 100",
    bgCircleColor: "#d90429",
    inkColor: "#121417",
    paths: [
      // Red ribbon background pennant
      {
        d: "M 10 24 L 90 24 L 90 76 L 10 76 Z",
        fill: "#d90429",
        stroke: "#121417",
        strokeWidth: 4,
      },
      // Left "R"
      {
        d: "M 22 34 L 38 34 C 44 34 46 38 46 43 C 46 48 43 51 38 51 L 30 51 L 30 66 L 22 66 Z M 30 40 L 30 45 L 37 45 C 39 45 40 44 40 42.5 C 40 41 39 40 37 40 Z",
        fill: "#ffffff",
      },
      { d: "M 36 50 L 46 66 L 38 66 L 30 52 Z", fill: "#ffffff" },
      // Right "R"
      {
        d: "M 54 34 L 70 34 C 76 34 78 38 78 43 C 78 48 75 51 70 51 L 62 51 L 62 66 L 54 66 Z M 62 40 L 62 45 L 69 45 C 71 45 72 44 72 42.5 C 72 41 71 40 69 40 Z",
        fill: "#ffffff",
      },
      { d: "M 68 50 L 78 66 L 70 66 L 62 52 Z", fill: "#ffffff" },
    ],
  },

  majin: {
    id: "majin",
    title: "Majin Brand (M)",
    viewBox: "0 0 100 100",
    inkColor: "#121417",
    paths: [
      // The iconic cursive Babidi M
      {
        d: "M 14 28 C 22 28 26 36 34 58 C 40 44 46 34 50 34 C 54 34 60 44 66 58 C 74 36 78 28 86 28 C 90 28 92 32 90 38 C 84 62 76 80 68 80 C 60 80 54 68 50 56 C 46 68 40 80 32 80 C 24 80 16 62 10 38 C 8 32 10 28 14 28 Z",
        fill: "#121417",
      },
    ],
  },

  tenkaichi: {
    id: "tenkaichi",
    title: "Tenkaichi Budokai Crest",
    kanji: "武",
    viewBox: "0 0 100 100",
    bgCircleColor: "#fed700",
    innerCircleColor: "#ffffff",
    inkColor: "#121417",
    paths: [
      // Outer thick ink ring
      {
        d: "M 50 4 A 46 46 0 1 1 49.9 4 Z",
        fill: "none",
        stroke: "#121417",
        strokeWidth: 5,
      },
      { d: "M 50 8 A 42 42 0 1 1 49.9 8 Z", fill: "#ffffff" },
      // Kanji 武 (Martial)
      { d: "M 24 32 L 68 32", stroke: "#121417", strokeWidth: 5 },
      { d: "M 44 20 L 44 48", stroke: "#121417", strokeWidth: 5 },
      { d: "M 26 48 L 76 48", stroke: "#121417", strokeWidth: 5 },
      {
        d: "M 32 48 L 32 78 L 48 78",
        fill: "none",
        stroke: "#121417",
        strokeWidth: 5,
      },
      {
        d: "M 58 20 L 72 82 L 80 78",
        fill: "none",
        stroke: "#121417",
        strokeWidth: 5.5,
      },
      { d: "M 66 48 L 52 74", stroke: "#121417", strokeWidth: 4.5 },
      { d: "M 68 28 L 74 34", stroke: "#121417", strokeWidth: 4.5 },
    ],
  },

  vegetaRoyal: {
    id: "vegetaRoyal",
    title: "Saiyan Royal Crest (Vegeta)",
    viewBox: "0 0 100 100",
    bgCircleColor: "#1b365d",
    inkColor: "#ffd700",
    paths: [
      // Saiyan Royal Flame Shield
      {
        d: "M 50 10 C 66 22 84 20 84 46 C 84 68 64 84 50 92 C 36 84 16 68 16 46 C 16 20 34 22 50 10 Z",
        fill: "none",
        stroke: "#ffd700",
        strokeWidth: 5,
      },
      // Inner flame trident
      {
        d: "M 50 24 L 50 68",
        stroke: "#ffd700",
        strokeWidth: 5,
      },
      {
        d: "M 36 34 C 40 44 42 54 50 62 C 58 54 60 44 64 34",
        fill: "none",
        stroke: "#ffd700",
        strokeWidth: 4.5,
      },
      {
        d: "M 50 74 A 4 4 0 1 1 49.9 74 Z",
        fill: "#ffd700",
      },
    ],
  },
};
