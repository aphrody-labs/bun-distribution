// Calcul Elo classique avec K-factor configurable par Season.
// Logique pure déplacée dans @rosegriffon/achillea-core ; on ré-exporte pour conserver
// les chemins d'import existants côté bot (ranked).

export {
  applyEloUpdate,
  eloDelta,
  expectedScore,
  progressiveEloDelta,
  tierEloFactors,
} from "@rosegriffon/achillea-core";
