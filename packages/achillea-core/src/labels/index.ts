/**
 * Libellés d'affichage (fr-FR) d'Achilléa.
 *
 * Le paquet est scindé en deux pour éviter un cycle d'import : `tables.ts`
 * déclare les tables, `registry.ts` les recense pour le test d'exhaustivité.
 * Quand le registre importait ce barrel, l'initialisation tournait en rond
 * (`Cannot access … before initialization`) et TOUTE la suite tombait.
 */

export * from "./tables";
export * from "./registry";
