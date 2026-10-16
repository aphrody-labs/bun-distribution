// Source: packages/shenron/db/src/config.ts at 8172f535ce (preserved Git history).
/** Default pool size, aligned with rg `packages/shenron/db/src/pg.ts`. */
export const DEFAULT_POOL_MAX = 4;
/** Hard ceiling: the local PostgreSQL is shared with the bot, MCP and crawler. */
export const POOL_MAX_CEILING = 20;

/**
 * Returns a usable PostgreSQL URL or throws a clear error. Rejects empty values,
 * the literal strings "undefined"/"null" (shell interpolation accidents) and
 * encrypted dotenvx payloads that were never decrypted.
 */
export function resolveDatabaseUrl(raw: string | undefined): string {
  const url = raw?.trim();
  if (!url || url === "undefined" || url === "null" || url.startsWith("eyJ2Ijo")) {
    throw new Error("DATABASE_URL is missing or corrupted: a postgres:// connection string is required.");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL: a postgres:// connection string is required.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`DATABASE_URL must use the postgres:// or postgresql:// scheme (got "${parsed.protocol}").`);
  }
  return url;
}

/** Parses DATABASE_POOL_MAX; invalid or non-positive values fall back to the default. */
export function resolvePoolMax(raw: string | undefined): number {
  const value = Number.parseInt(raw?.trim() ?? "", 10);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_POOL_MAX;
  return Math.min(value, POOL_MAX_CEILING);
}

/** Minimal environment shape (compatible with `process.env` and `@shenron/config/env`). */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * True when `DATABASE_URL` holds a usable postgres:// URL. Build/prerender
 * guard and nullable-PostgreSQL switch for the bot; never throws.
 */
export function isDatabaseConfigured(env: EnvSource = process.env): boolean {
  try {
    resolveDatabaseUrl(env.DATABASE_URL);
    return true;
  } catch {
    return false;
  }
}
