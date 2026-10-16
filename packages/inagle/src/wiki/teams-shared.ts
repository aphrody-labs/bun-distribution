/**
 * Partie CLIENT-SAFE de la section ÉQUIPES (`/equipe`).
 *
 * Contient UNIQUEMENT les types et les constantes de libellés (séries, saisons)
 * — aucune dépendance Supabase / SQLite / Node. Importable depuis un composant
 * client. Le data-fetch serveur vit dans `wiki/teams.ts`
 * (sous-chemin serveur de la lib).
 */

/** Clés de série dans `team.kits` / mapping vers le jeu d'origine. */
export const SERIES_LABELS: Record<string, string> = {
  v: "Victory Road",
  go: "Galaxy / GO",
  ie: "Inazuma Eleven (1-3)",
  aresOrion: "Ares / Orion",
};

/** Labels FR des codes de saison (apparitions inter-jeux). */
export const SEASON_LABELS: Record<string, string> = {
  V: "Victory Road",
  IE1: "IE 1",
  IE2: "IE 2",
  IE3: "IE 3",
  GO1: "GO 1",
  GO2: "GO 2",
  GO3: "GO 3",
  ARES: "Ares",
  ORION: "Orion",
};

export type { TeamDetail, TeamEmblem, TeamKit, TeamKitModel, TeamListItem, TeamRosterMember } from "./types.js";
