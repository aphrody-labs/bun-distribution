/**
 * Unions de bracket — recopiées de `brackets-model` **volontairement**.
 *
 * `@rosegriffon/achillea-types` doit rester à zéro dépendance runtime pour être
 * traduisible mécaniquement (serde / Codable / kotlinx.serialization). La
 * compatibilité structurelle avec `brackets-model` est vérifiée par assertion
 * de type dans `test/brackets-compat.test.ts` — une divergence casse la CI.
 */

/** `brackets-model#StageType` — formats de bracket supportés par la lib. */
export type BracketsStageType = "round_robin" | "single_elimination" | "double_elimination";

/** `brackets-model#SeedOrdering`. */
export type SeedOrdering =
  | "natural"
  | "reverse"
  | "half_shift"
  | "reverse_half_shift"
  | "pair_flip"
  | "inner_outer"
  | "groups.effort_balanced"
  | "groups.seed_optimized"
  | "groups.bracket_optimized";

/** `brackets-model#GrandFinalType`. */
export type GrandFinalType = "none" | "simple" | "double";

/** `brackets-model#RoundRobinMode`. */
export type RoundRobinMode = "simple" | "double";

/** Identifiant d'entité bracket (`brackets-model#Id`). */
export type BracketId = number | string;

/** Statut d'un match de bracket (`brackets-model#Status`), en valeurs numériques. */
export enum BracketMatchStatus {
  Locked = 0,
  Waiting = 1,
  Ready = 2,
  Running = 3,
  Completed = 4,
  Archived = 5,
}
