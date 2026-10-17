// Centralisation env Supabase + replis de sécurité (build sans vars / prerender Next).
// Source unique pour browser/server/service — éviter de répéter les heuristiques.

// Repli quand aucune URL n'est configurée : l'origine courante côté navigateur
// (URL relatives `/storage/v1/…` relayées par l'app vers Supabase), la pile
// Supabase locale (`supabase start`) côté serveur.
import { isUsableEnvValue } from "@aphrody/sql/env";

const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";

/** Origine de repli, évaluée à l'appel : Next évalue ce module pendant le build, sans `location`. */
function origineDeRepli(): string {
  return "location" in globalThis
    ? (globalThis as unknown as { location: { origin: string } }).location.origin
    : LOCAL_SUPABASE_URL;
}
// Valeurs vides, littéraux "undefined"/"null" et blobs dotenvx scellés (`eyJ2Ijo…`)
// sont rejetés par le prédicat partagé `@aphrody/sql/env` (ADR sql-convergence D7).
function isValidHttpUrl(value: string | undefined | null): value is string {
  return isUsableEnvValue(value) && value.startsWith("http");
}

function isValidKey(value: string | undefined | null): value is string {
  return isUsableEnvValue(value) && !value.startsWith("{");
}

/** True pendant un prerender de build, sans variables d'environnement runtime. */
export function isBuildPhase(): boolean {
  return (
    process.env.NEXT_PHASE === "phase-production-build" ||
    (process.env.NODE_ENV === "production" && !isValidKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? null))
  );
}

export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;

  if (isValidHttpUrl(url)) return url;
  return origineDeRepli();
}

/**
 * Un JWT compact a TROIS parties séparées par des points.
 *
 * Notre PostgREST valide les jetons avec `SUPABASE_JWT_SECRET` : il lui faut
 * donc un vrai JWT. Les clés du nouveau format Supabase (`sb_publishable_…`,
 * `sb_secret_…`) n'en sont pas — elles n'ont de sens que devant la passerelle
 * du Cloud, qui les traduit. Envoyées ici, elles font répondre
 * `PGRST301 JWSError (CompactDecodeError Invalid number of parts: Expected 3
 * parts; got 1)`, et toute lecture navigateur échoue.
 */
function estJwt(value: string | undefined | null): value is string {
  return isValidKey(value) && value.split(".").length === 3;
}

/** Cloud opaque keys require the Cloud gateway; the retained PostgREST gateway uses anon JWTs. */
export function getSupabasePublishableKey(): string {
  const publiable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (isValidKey(publiable) && publiable.startsWith("sb_publishable_")) {
    const endpoint = new URL(getSupabaseUrl());
    if (endpoint.protocol === "https:" && endpoint.hostname.endsWith(".supabase.co")) return publiable;
  }
  if (estJwt(publiable)) return publiable;

  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (estJwt(anon)) return anon;

  throw new Error("A Supabase Cloud publishable key or legacy RG anon JWT is required");
}

export function getSupabaseServiceRoleKey(): string | null {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (isValidKey(key)) return key;

  return null;
}
