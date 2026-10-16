// Source: packages/shenron/auth/src/options.ts at 8172f535ce (preserved Git history).
/**
 * Better Auth option presets shared by the site and the bot (runtime class `server`).
 *
 * Invariants (docs/STACK.md §3.3): `prompt: "consent"` on Discord (without it
 * Better Auth emits `prompt=none` and every first login fails with
 * `consent_required`), `identify`/`email` never repeated in the extra scopes
 * (Better Auth adds them itself), byte-stable placeholder e-mail for
 * phone-only accounts, 300 s cookie cache, `warn` logging in production, IP
 * headers trusted only from a loopback proxy.
 */
import type { BetterAuthOptions } from "better-auth";
import type { DiscordOptions } from "better-auth/social-providers";
import { mapDiscordProfileEmail } from "./index";

/** Scopes Better Auth already requests for Discord. */
const IMPLICIT_DISCORD_SCOPES: ReadonlySet<string> = new Set(["identify", "email"]);

export interface DiscordProviderInput {
  clientId: string;
  clientSecret: string;
  /** Extra scopes (`guilds`, `guilds.members.read`); implicit ones are stripped. */
  extraScopes?: readonly string[];
}

export function discordProvider(input: DiscordProviderInput) {
  const scope: string[] = [];
  for (const raw of input.extraScopes ?? []) {
    const value = raw.trim();
    if (value && !IMPLICIT_DISCORD_SCOPES.has(value) && !scope.includes(value)) scope.push(value);
  }
  return {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    scope,
    prompt: "consent",
    mapProfileToUser: profile => mapDiscordProfileEmail(profile),
  } satisfies DiscordOptions;
}

export type DiscordProviderOptions = ReturnType<typeof discordProvider>;

export function loggingOptions(nodeEnv: string | undefined): {
  logger: { level: "warn" | "debug" };
} {
  return { logger: { level: nodeEnv === "production" ? "warn" : "debug" } };
}

/** `debugLogs` of the Drizzle adapter: on outside production only. */
export function drizzleDebugLogs(nodeEnv: string | undefined): boolean {
  return nodeEnv !== "production";
}

export const SESSION_COOKIE_CACHE = Object.freeze({ enabled: true, maxAge: 300 } as const);

/** Loopback only: nginx runs on the same host and sets `X-Real-IP`. */
export const LOOPBACK_PROXIES: readonly string[] = Object.freeze(["127.0.0.1", "::1"]);

export interface AdvancedOptionsInput {
  production: boolean;
  /** Bot: `shenron_ba`. Omitted on the site (Better Auth default). */
  cookiePrefix?: string;
  trustedProxies?: readonly string[];
}

export function advancedOptions(input: AdvancedOptionsInput) {
  return {
    useSecureCookies: input.production,
    crossSubDomainCookies: { enabled: false as const },
    ...(input.cookiePrefix ? { cookiePrefix: input.cookiePrefix } : {}),
    ipAddress: {
      ipAddressHeaders: ["x-real-ip", "x-forwarded-for"],
      trustedProxies: [...(input.trustedProxies ?? LOOPBACK_PROXIES)],
    },
  } satisfies NonNullable<BetterAuthOptions["advanced"]>;
}
