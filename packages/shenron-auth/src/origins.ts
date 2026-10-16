// Source: packages/shenron/auth/src/origins.ts at 8172f535ce (preserved Git history).
/**
 * Host and origin policy of each application (S2, docs/STACK.md §2.2).
 *
 * Runtime class `pure`: no platform import, no environment read. The caller
 * says whether it runs in production; nothing is inferred here.
 *
 * - No generic `*.vercel.app` entry: a wildcard trusted host lets any Vercel
 *   deployment act as the site (open redirect through Better Auth callbacks).
 * - The named Vercel production alias stays until INFRA-4 retires it.
 * - `localhost` entries exist only outside production.
 *
 * Every call returns a fresh array, so a consumer can never mutate the policy.
 */

export interface OriginPolicyInput {
  production: boolean;
}

/** Named Vercel production alias, kept until INFRA-4. */
export const VERCEL_PRODUCTION_ALIAS = "dbfr.vercel.app";

const SITE_PRODUCTION_HOSTS = ["dragonballfr.com", "www.dragonballfr.com", VERCEL_PRODUCTION_ALIAS] as const;
const SITE_DEVELOPMENT_HOSTS = ["localhost:3000"] as const;

const SITE_PRODUCTION_ORIGINS = [
  "https://dragonballfr.com",
  "https://www.dragonballfr.com",
  `https://${VERCEL_PRODUCTION_ALIAS}`,
] as const;
const SITE_DEVELOPMENT_ORIGINS = ["http://localhost:3000"] as const;

const BOT_PRODUCTION_ORIGINS = [
  "https://dragonballfr.com",
  "https://www.dragonballfr.com",
  "https://bot.dragonballfr.com",
  `https://${VERCEL_PRODUCTION_ALIAS}`,
] as const;
const BOT_DEVELOPMENT_ORIGINS = ["http://localhost:3000", "http://localhost:5006"] as const;

function compose(production: readonly string[], development: readonly string[], input: OriginPolicyInput): string[] {
  return input.production ? [...production] : [...production, ...development];
}

/** Hosts accepted by the dynamic `baseURL` of the site (Better Auth `allowedHosts`). */
export function siteAllowedHosts(input: OriginPolicyInput): string[] {
  return compose(SITE_PRODUCTION_HOSTS, SITE_DEVELOPMENT_HOSTS, input);
}

/** Origins trusted by the site's Better Auth instance (`trustedOrigins`). */
export function siteTrustedOrigins(input: OriginPolicyInput): string[] {
  return compose(SITE_PRODUCTION_ORIGINS, SITE_DEVELOPMENT_ORIGINS, input);
}

/** Origins trusted by the bot's Better Auth instance (`trustedOrigins`). */
export function botTrustedOrigins(input: OriginPolicyInput): string[] {
  return compose(BOT_PRODUCTION_ORIGINS, BOT_DEVELOPMENT_ORIGINS, input);
}
