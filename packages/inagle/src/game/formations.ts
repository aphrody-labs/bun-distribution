/**
 * Formation definitions for the My Team builder.
 *
 * `LEGACY_FORMATIONS` (8) : positions estimées à l'œil depuis le CSS de zukan.inazuma.jp
 * (conservées pour compat des `id` persistés — URLs partagées / équipes sauvegardées).
 * Les 83 formations réelles sont chargées depuis `inagle_formations` côté
 * serveur. Seuls les 8 layouts historiques restent embarqués pour décoder les
 * identifiants persistés en mode offline.
 *
 * Coordonnées : pourcentages sur un terrain portrait. `top` depuis le haut (but adverse en
 * haut, GK en bas ~44 %), `left` depuis la gauche (centre = 40 %). Slot ~19 % de large.
 */

export interface PositionCoord {
  /** Position index (0-9 field, 10 = GK) */
  index: number;
  /** Percentage from top */
  top: number;
  /** Percentage from left */
  left: number;
  /** Role label (FW, MF, DF, GK) */
  role: "FW" | "MF" | "DF" | "GK";
}

export interface Formation {
  id: string;
  name: string;
  label: string;
  positions: PositionCoord[];
}

// GK is always at the same position across all formations
const GK: PositionCoord = { index: 10, left: 40, role: "GK", top: 43 };

/**
 * Formations « héritées » (8) : leurs `id` textuels (`diamond442`, `box442`…)
 * sont persistés dans `user_teams.formation_id` et dans les URLs de partage —
 * ils constituent donc la seule table de coordonnées que le CLI (`team-builder`)
 * doit consulter, sans se laisser élargir par les 83 formations du jeu.
 */
export const LEGACY_FORMATIONS: Formation[] = [
  {
    id: "diamond442",
    label: "4-4-2",
    name: "4-4-2 Diamond",
    positions: [
      // FW (2)
      { index: 0, top: 1, left: 15, role: "FW" },
      { index: 1, top: 1, left: 65, role: "FW" },
      // MF (4) — diamond shape
      { index: 2, top: 9, left: 40, role: "MF" },
      { index: 3, top: 17, left: 10, role: "MF" },
      { index: 4, top: 17, left: 70, role: "MF" },
      { index: 5, top: 22, left: 40, role: "MF" },
      // DF (4)
      { index: 6, top: 31, left: 2, role: "DF" },
      { index: 7, top: 35, left: 22, role: "DF" },
      { index: 8, top: 35, left: 58, role: "DF" },
      { index: 9, top: 31, left: 78, role: "DF" },
      GK,
    ],
  },
  {
    id: "box442",
    label: "4-4-2",
    name: "4-4-2 Box",
    positions: [
      // FW (2)
      { index: 0, top: 1, left: 22, role: "FW" },
      { index: 1, top: 1, left: 58, role: "FW" },
      // MF (4) — box shape
      { index: 2, top: 10, left: 2, role: "MF" },
      { index: 3, top: 21, left: 22, role: "MF" },
      { index: 4, top: 21, left: 58, role: "MF" },
      { index: 5, top: 10, left: 78, role: "MF" },
      // DF (4)
      { index: 6, top: 28, left: 2, role: "DF" },
      { index: 7, top: 35, left: 22, role: "DF" },
      { index: 8, top: 35, left: 58, role: "DF" },
      { index: 9, top: 28, left: 78, role: "DF" },
      GK,
    ],
  },
  {
    id: "freedom352",
    label: "3-5-2",
    name: "3-5-2 Liberté",
    positions: [
      // FW (2)
      { index: 0, top: 1, left: 22, role: "FW" },
      { index: 1, top: 1, left: 58, role: "FW" },
      // MF (5) — asymmetric
      { index: 2, top: 6, left: 2, role: "MF" },
      { index: 3, top: 17, left: 22, role: "MF" },
      { index: 4, top: 10, left: 40, role: "MF" },
      { index: 5, top: 17, left: 58, role: "MF" },
      { index: 6, top: 6, left: 78, role: "MF" },
      // DF (3)
      { index: 7, top: 33, left: 12, role: "DF" },
      { index: 8, top: 29, left: 40, role: "DF" },
      { index: 9, top: 33, left: 68, role: "DF" },
      GK,
    ],
  },
  {
    id: "triangle433",
    label: "4-3-3",
    name: "4-3-3 Triangle",
    positions: [
      // FW (3)
      { index: 0, top: 4, left: 2, role: "FW" },
      { index: 1, top: 1, left: 40, role: "FW" },
      { index: 2, top: 4, left: 78, role: "FW" },
      // MF (3) — triangle
      { index: 3, top: 16, left: 40, role: "MF" },
      { index: 4, top: 24, left: 15, role: "MF" },
      { index: 5, top: 24, left: 65, role: "MF" },
      // DF (4)
      { index: 6, top: 31, left: 2, role: "DF" },
      { index: 7, top: 38, left: 22, role: "DF" },
      { index: 8, top: 38, left: 58, role: "DF" },
      { index: 9, top: 31, left: 78, role: "DF" },
      GK,
    ],
  },
  {
    id: "delta433",
    label: "4-3-3",
    name: "4-3-3 Delta",
    positions: [
      // FW (3)
      { index: 0, top: 4, left: 2, role: "FW" },
      { index: 1, top: 1, left: 40, role: "FW" },
      { index: 2, top: 4, left: 78, role: "FW" },
      // MF (3) — inverted triangle
      { index: 3, top: 12, left: 15, role: "MF" },
      { index: 4, top: 12, left: 65, role: "MF" },
      { index: 5, top: 23, left: 40, role: "MF" },
      // DF (4)
      { index: 6, top: 22, left: 2, role: "DF" },
      { index: 7, top: 32, left: 22, role: "DF" },
      { index: 8, top: 32, left: 58, role: "DF" },
      { index: 9, top: 22, left: 78, role: "DF" },
      GK,
    ],
  },
  {
    id: "balance451",
    label: "4-5-1",
    name: "4-5-1 Équilibré",
    positions: [
      // FW (1)
      { index: 0, top: 1, left: 40, role: "FW" },
      // MF (5)
      { index: 1, top: 10, left: 2, role: "MF" },
      { index: 2, top: 15, left: 40, role: "MF" },
      { index: 3, top: 10, left: 78, role: "MF" },
      { index: 4, top: 25, left: 22, role: "MF" },
      { index: 5, top: 25, left: 58, role: "MF" },
      // DF (4)
      { index: 6, top: 29, left: 2, role: "DF" },
      { index: 7, top: 38, left: 22, role: "DF" },
      { index: 8, top: 38, left: 58, role: "DF" },
      { index: 9, top: 29, left: 78, role: "DF" },
      GK,
    ],
  },
  {
    id: "hexa361",
    label: "3-6-1",
    name: "3-6-1 Hexa",
    positions: [
      // FW (1)
      { index: 0, top: 1, left: 40, role: "FW" },
      // MF (6)
      { index: 1, top: 7, left: 2, role: "MF" },
      { index: 2, top: 11, left: 22, role: "MF" },
      { index: 3, top: 11, left: 58, role: "MF" },
      { index: 4, top: 7, left: 78, role: "MF" },
      { index: 5, top: 25, left: 22, role: "MF" },
      { index: 6, top: 25, left: 58, role: "MF" },
      // DF (3)
      { index: 7, top: 39, left: 10, role: "DF" },
      { index: 8, top: 29, left: 40, role: "DF" },
      { index: 9, top: 39, left: 70, role: "DF" },
      GK,
    ],
  },
  {
    id: "double541",
    label: "5-4-1",
    name: "5-4-1 Double Volante",
    positions: [
      // FW (1)
      { index: 0, top: 1, left: 40, role: "FW" },
      // MF (4)
      { index: 1, top: 7, left: 2, role: "MF" },
      { index: 2, top: 11, left: 22, role: "MF" },
      { index: 3, top: 11, left: 58, role: "MF" },
      { index: 4, top: 7, left: 78, role: "MF" },
      // DF (5)
      { index: 5, top: 23, left: 2, role: "DF" },
      { index: 6, top: 27, left: 22, role: "DF" },
      { index: 7, top: 29, left: 40, role: "DF" },
      { index: 8, top: 27, left: 58, role: "DF" },
      { index: 9, top: 23, left: 78, role: "DF" },
      GK,
    ],
  },
];

/** Reserve / Support / Manager slot counts (matches zukan) */
export const BENCH_SLOTS = {
  manager: 1,
  reserves: 5,
  support: 3,
} as const;

export const ROLE_COLORS: Record<string, string> = {
  DF: "rgb(59, 130, 246)",
  FW: "rgb(220, 38, 38)",
  GK: "rgb(217, 119, 6)",
  MF: "rgb(16, 185, 129)",
};

export const ROLE_LABELS: Record<string, string> = {
  DF: "DEF",
  FW: "ATT",
  GK: "GAR",
  MF: "MIL",
};

/**
 * Formations legacy conservées uniquement pour les identifiants historiques
 * des équipes sauvegardées et le CLI offline. Les formations du jeu sont une
 * projection SQL chargée par `wikiService.getFormations()` ; aucune donnée
 * canonique n'est embarquée dans le bundle client.
 */
export const FORMATIONS: Formation[] = LEGACY_FORMATIONS;
