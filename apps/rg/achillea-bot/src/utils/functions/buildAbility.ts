// Source unique : @rosegriffon/achillea-core/access (RBAC CASL portable).
//
// Actions / sujets CASL Achilléa + construction de l'Ability par rôle.
// Logique pure (aucune dépendance DI/DB) déplacée dans @rosegriffon/achillea-core ;
// on ré-exporte pour conserver les chemins d'import existants côté bot.
export type { AchilleaAction, AchilleaSubject, AppAbility } from "@rosegriffon/achillea-core";

export { buildAbilityFor } from "@rosegriffon/achillea-core";
