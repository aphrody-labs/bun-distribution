// Source: packages/shenron/auth/src/a2a.ts at 8172f535ce (preserved Git history).
/**
 * A2A write guard (S5, decision D14 of docs/STACK.md).
 *
 * Runtime class `server` (`node:crypto`, synchronous). The caller injects the
 * environment and the configured token; nothing is read at module load.
 *
 * - `SHENRON_A2A_ENFORCE` inactive (default): writes stay open, exactly as
 *   before, and one warning per process names the flag (never a value).
 *   `shenron-mcp` still calls without an `Authorization` header: the guard is
 *   only switched on after INFRA-2 (token provisioned) and MCP-1 (token sent).
 * - Active: token unset -> 503 `a2a_not_configured`; missing or wrong Bearer
 *   -> 401 `a2a_unauthorized`; the right Bearer passes.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** Structural environment source (same shape as `@shenron/config/env` `EnvSource`). */
export type A2AEnvSource = Readonly<Record<string, string | undefined>>;

export const A2A_ENFORCE_ENV = "SHENRON_A2A_ENFORCE";
export const A2A_TOKEN_ENV = "SHENRON_A2A_TOKEN";

/** Logged once per process while the guard is inactive. Names variables only. */
export const A2A_OPEN_WARNING = `[a2a] ${A2A_ENFORCE_ENV} inactif : écritures A2A acceptées sans jeton ${A2A_TOKEN_ENV} (S5, activation après INFRA-2 et MCP-1).`;

export type A2AWriteDecision =
  | { ok: true; authenticated: boolean }
  | { ok: false; status: 401 | 503; code: "a2a_unauthorized" | "a2a_not_configured" };

export interface A2AWriteOptions {
  /** Configured `SHENRON_A2A_TOKEN`; blank counts as unset. */
  token: string | undefined;
  /** Result of {@link a2aEnforced}. */
  enforce: boolean;
  /** Sink of the one-time open-mode warning (default `console.warn`). */
  warn?: (message: string) => void;
}

let openWarningEmitted = false;

/** `SHENRON_A2A_ENFORCE` is active when it is `1` or `true` (trimmed, case-insensitive). */
export function a2aEnforced(env: A2AEnvSource): boolean {
  const raw = env[A2A_ENFORCE_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

function configuredToken(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

/** Bearer credential of the request (scheme case-insensitive), or `null`. */
function presentedToken(headers: Headers): string | null {
  const header = headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  const value = match?.[1]?.trim();
  return value ? value : null;
}

/** Constant-time comparison: both sides are hashed first, so length never leaks. */
function tokensMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Decides whether an A2A write may proceed. Never throws, never logs a value. */
export function decideA2AWrite(headers: Headers, options: A2AWriteOptions): A2AWriteDecision {
  const token = configuredToken(options.token);
  const presented = presentedToken(headers);
  const authenticated = token !== null && presented !== null && tokensMatch(presented, token);

  if (!options.enforce) {
    if (!openWarningEmitted) {
      openWarningEmitted = true;
      (options.warn ?? console.warn)(A2A_OPEN_WARNING);
    }
    return { ok: true, authenticated };
  }
  if (token === null) return { ok: false, status: 503, code: "a2a_not_configured" };
  if (!authenticated) return { ok: false, status: 401, code: "a2a_unauthorized" };
  return { ok: true, authenticated: true };
}

/** JSON body of a refused write: `{"error":"a2a_unauthorized" | "a2a_not_configured"}`. */
export function a2aDeniedBody(decision: Extract<A2AWriteDecision, { ok: false }>): {
  error: "a2a_unauthorized" | "a2a_not_configured";
} {
  return { error: decision.code };
}

/** Test hook: re-arms the once-per-process warning. */
export function resetA2AOpenWarning(): void {
  openWarningEmitted = false;
}
