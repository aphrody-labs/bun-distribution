/**
 * Contrat runtime `v1` du client Achilléa.
 *
 * Organisation : `http.ts` porte le transport, un module par ressource porte
 * ses routes et ses schémas zod, `client.ts` les agrège. `pending-contracts.ts`
 * héberge les formes encore absentes de `@rosegriffon/achillea-types`.
 */

export * from "./http";
export * from "./pending-contracts";
export * from "./common";

export * from "./admin";
export * from "./auth";
export * from "./casts";
export * from "./clans";
export * from "./guilds";
export * from "./leagues";
export * from "./licenses";
export * from "./notifications";
export * from "./organizations";
export * from "./player-notes";
export * from "./ranked";
export * from "./sanctions";
export * from "./stats";
export * from "./tournaments";
export * from "./users";
export * from "./wallet";

export * from "./client";
