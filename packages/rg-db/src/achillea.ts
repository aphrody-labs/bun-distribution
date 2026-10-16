/**
 * Connecteur et configuration des données Achilléa.
 *
 * UNE SEULE BASE. Achilléa a longtemps vécu dans une base `achillea` distincte,
 * exposée à `rg` par `postgres_fdw` : des tables étrangères, lisibles mais
 * jamais écrivables, et une identité coupée en deux. Depuis la fusion
 * (`scripts/ops/achillea-merge.ts`), `achillea` est un SCHÉMA de la base `rg`,
 * avec de vraies tables — le bot Achilléa y écrit, le site y lit, dans la même
 * transaction.
 */

import { getDatabaseURL } from "./pg";

export const ACHILLEA_SCHEMA = "achillea" as const;

export function getAchilleaDatabaseUrl(): string {
  return getDatabaseURL();
}

export function getAchilleaApiUrl(): string {
  return process.env["NEXT_PUBLIC_ACHILLEA_API_URL"] || process.env["ACHILLEA_API_URL"] || "https://api.rosegriffon.fr";
}
