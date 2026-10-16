// Centralisation env Supabase + replis de sécurité (build sans vars / prerender Next).
// Source unique pour browser/server/service — éviter de répéter les heuristiques.

// Repli quand aucune URL n'est configurée. Depuis la sortie de Supabase, la
// pile (`/rest/v1`, `/storage/v1`, `/realtime/v1`) est servie sur l'origine de
// l'app elle-même — donc `window.location.origin` côté navigateur, et le point
// d'entrée interne du VPS côté serveur. Cf. docs/self-host-supabase.md.
// `window` n'est pas typé dans les paquets sans lib DOM (serveur MCP, scripts
// Bun) : on interroge `globalThis` pour rester compilable partout.
// Repointé sur rg-api:8800 (2026-09-26, aphrody-infra docs/PORTS-AND-DOMAINS.md item 13) :
// `rg-api` absorbe storage/realtime en-process (`apps/api/src/index.ts`,
// commentaires « remplace rg-storage:8810 »/« remplace rg-realtime:8812 ») et c'est
// l'unique cible que la conf nginx live (`rg.conf` (scripts/iecode/rg/nginx-gen.ts)) route réellement pour
// `/storage/v1/` et `/realtime/v1/` ; `:8811` (`supabase-internal.conf`) n'est jamais
// écouté par cette conf et est marqué superseded dans le catalogue.
import { isUsableEnvValue } from "@aphrody/sql/env";

const INTERNAL_URL = "http://127.0.0.1:8800";

/**
 * Origine de repli, évaluée À L'APPEL — jamais au chargement du module.
 *
 * ── LE BUG QUE CETTE FONCTION CORRIGE ──────────────────────────────────────
 * C'était une CONSTANTE : `"location" in globalThis ? location.origin :
 * INTERNAL_URL`. Next évalue ce module pendant le BUILD, côté serveur, où
 * `location` n'existe pas — la constante valait donc `http://127.0.0.1:8811`
 * et partait telle quelle dans le bundle envoyé au navigateur. Résultat vu en
 * production le 1/9/2026 : le téléversement d'avatar échouait en
 * « Failed to fetch » (le navigateur du visiteur essayait de joindre le port
 * 8811 de SA machine), et une URL d'avatar avait même été enregistrée sous
 * cette forme en base.
 *
 * Le repli n'est atteint que si `NEXT_PUBLIC_SUPABASE_URL` est absente ou
 * inexploitable — ce qui arrive : la valeur de `apps/website/.env.local` avait
 * été remplacée par un blob scellé `eyJ2Ijo…`, exactement le cas que
 * `isValidHttpUrl` refuse. Le garde-fou faisait son travail ; c'est le repli
 * qui était mauvais.
 */
function origineDeRepli(): string {
  return "location" in globalThis
    ? (globalThis as unknown as { location: { origin: string } }).location.origin
    : INTERNAL_URL;
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

export function getSupabaseUrl(preferInternal = false): string {
  const url = preferInternal
    ? (process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)
    : process.env.NEXT_PUBLIC_SUPABASE_URL;

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
