// Source: packages/shenron/auth/src/guards.ts at 8172f535ce (preserved Git history).
/**
 * Framework-agnostic guards returning a principal (runtime class `server`).
 *
 * A {@link Strategy} inspects a `Request` and returns a decision, or `null`
 * when it does not apply (the next strategy runs). {@link authorize} returns
 * the first decision, or 401 `unauthenticated` when none applies. Strategy
 * order therefore encodes precedence: the bot `checkAdmin` is
 * `[staticBearer(final, 503 when unset, exact prefix), session(requireStaff), legacySession]`.
 */
import { AGENT_TOKEN_PREFIX, hashAgentToken, hasScope, looksLikeAgentToken } from "./agent-keys";
import { verifyActingUser } from "./acting-user";
import { parseBearer } from "./crypto";
import type { AgentKeyStore, DiscordAccountLookup } from "./ports";
import type { StaffPolicy } from "./staff";
import { ADMIN_COOKIE, type AdminCookieCodec, verifyStaticBearer } from "./tokens";

export type Principal =
  | {
      kind: "user";
      userId: string;
      discordId: string | null;
      staff: boolean;
      via: "better-auth" | "legacy-session";
    }
  | { kind: "admin-token"; via: "bearer" | "admin-cookie" | "legacy-session" }
  | { kind: "agent"; keyId: string; name?: string; scopes: readonly string[]; rateLimit?: number }
  | { kind: "acting-user"; discordId: string }
  | { kind: "service"; name: string };

export type AuthErrorCode =
  "unauthenticated" | "invalid_token" | "forbidden" | "scope_missing" | "not_configured" | "cross_origin";

export type AuthDecision =
  { ok: true; principal: Principal } | { ok: false; status: 401 | 403 | 404 | 503; code: AuthErrorCode };

export type AuthFailure = Extract<AuthDecision, { ok: false }>;

/** `null` = not applicable, the next strategy runs. */
export type Strategy = (request: Request) => Promise<AuthDecision | null>;

const allow = (principal: Principal): AuthDecision => ({ ok: true, principal });
const deny = (status: AuthFailure["status"], code: AuthErrorCode): AuthFailure => ({
  ok: false,
  status,
  code,
});

/** First applicable decision, else 401 `unauthenticated`. */
export async function authorize(request: Request, strategies: readonly Strategy[]): Promise<AuthDecision> {
  for (const strategy of strategies) {
    const decision = await strategy(request);
    if (decision) return decision;
  }
  return deny(401, "unauthenticated");
}

export interface StaticBearerStrategyOptions {
  /** Configured tokens, read on every request (never at module load). */
  tokens: () => readonly (string | null | undefined)[];
  /** Principal granted by a valid token. */
  as: Principal;
  /** A presented but wrong Bearer is a final 401 (bot) instead of falling through. */
  wrongBearerIsFinal: boolean;
  /** No configured token: 503 `not_configured` (bot) instead of not applicable. */
  unsetIs503: boolean;
  /** Exact `Bearer ` prefix (bot). Default case-insensitive. */
  caseSensitive?: boolean;
  /** Minimum configured-token length. Default 16. */
  minLength?: number;
}

export function staticBearerStrategy(options: StaticBearerStrategyOptions): Strategy {
  return async request => {
    const result = verifyStaticBearer(request.headers, options.tokens(), {
      caseSensitive: options.caseSensitive,
      minLength: options.minLength,
    });
    switch (result) {
      case "not_configured":
        return options.unsetIs503 ? deny(503, "not_configured") : null;
      case "absent":
        return null;
      case "valid":
        return allow(options.as);
      case "invalid":
        return options.wrongBearerIsFinal ? deny(401, "invalid_token") : null;
    }
  };
}

/** Value of cookie `name` in a `Cookie` header, or `null`. */
export function readCookie(headers: Headers, name: string): string | null {
  const header = headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function adminCookieStrategy(options: {
  codec: () => AdminCookieCodec | null;
  cookieName?: string;
  now?: () => number;
}): Strategy {
  return async request => {
    const codec = options.codec();
    if (!codec) return null;
    const value = readCookie(request.headers, options.cookieName ?? ADMIN_COOKIE);
    if (!value) return null;
    return codec.verify(value, options.now?.()) ? allow({ kind: "admin-token", via: "admin-cookie" }) : null;
  };
}

export function sessionStrategy(options: {
  getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
  accounts: DiscordAccountLookup;
  staff: StaffPolicy;
  requireStaff: boolean;
}): Strategy {
  return async request => {
    let session: { user: { id: string } } | null = null;
    try {
      session = await options.getSession(request.headers);
    } catch {
      session = null;
    }
    if (!session?.user) return null;
    const userId = session.user.id;
    let discordId: string | null = null;
    try {
      discordId = await options.accounts.discordIdForUser(userId);
    } catch {
      // Fail closed: without a readable Discord account there is no staff access.
      discordId = null;
    }
    const staff = options.staff.isStaff(discordId);
    if (options.requireStaff && !staff) return deny(403, "forbidden");
    return allow({ kind: "user", userId, discordId, staff, via: "better-auth" });
  };
}

export function legacySessionStrategy(options: {
  verify(request: Request): Promise<{ source: "token" | "discord"; userId?: string } | null>;
  staff: StaffPolicy;
}): Strategy {
  return async request => {
    const session = await options.verify(request);
    if (!session) return null;
    if (session.source === "token") return allow({ kind: "admin-token", via: "legacy-session" });
    const discordId = session.userId ?? null;
    if (discordId === null || !options.staff.isStaff(discordId)) return deny(403, "forbidden");
    return allow({
      kind: "user",
      userId: discordId,
      discordId,
      staff: true,
      via: "legacy-session",
    });
  };
}

/**
 * Site to bot `x-acting-*` headers. Not applicable when the headers are absent
 * or the secret is unset (the bot answered `null` in both cases); any other
 * failure is a 401 `invalid_token`.
 */
export function actingUserStrategy(options: { secret: () => string | null | undefined; now?: () => number }): Strategy {
  return async request => {
    const result = verifyActingUser(request.headers, {
      secret: options.secret(),
      nowMs: options.now?.(),
    });
    if (result.ok) return allow({ kind: "acting-user", discordId: result.discordId });
    if (result.code === "missing" || result.code === "not_configured") return null;
    return deny(401, "invalid_token");
  };
}

/**
 * `Authorization: Bearer dbfr_agent_...`. Other Bearer values are not
 * applicable; an unknown, malformed or revoked key is a 401 `invalid_token`.
 */
export function agentKeyStrategy(options: { store: AgentKeyStore; now?: () => Date }): Strategy {
  return async request => {
    const token = parseBearer(request.headers);
    if (!token?.startsWith(AGENT_TOKEN_PREFIX)) return null;
    if (!looksLikeAgentToken(token)) return deny(401, "invalid_token");
    const hash = hashAgentToken(token);
    const record = await options.store.findActiveByHash(hash);
    if (!record || record.revokedAt) return deny(401, "invalid_token");
    const now = options.now?.() ?? new Date();
    // `lastUsedAt` is an operational trace: a failed write never fails the call.
    options.store.touch(record.id, now).catch(() => {});
    return allow({
      kind: "agent",
      keyId: record.id,
      name: record.name,
      scopes: record.scopes,
      rateLimit: record.rateLimit,
    });
  };
}

/** Agents must hold `scope`; other principals pass unchanged. */
export function requireScope(decision: AuthDecision, scope: string): AuthDecision {
  if (!decision.ok || decision.principal.kind !== "agent") return decision;
  return hasScope(decision.principal.scopes, scope) ? decision : deny(403, "scope_missing");
}

/**
 * CSRF check for cookie-authenticated writes: a present `Origin` must be the
 * request origin itself or one of `allowedOrigins`. No `Origin` (non-browser
 * client) gives `null`. Returns a 403 `cross_origin` decision or `null`.
 */
export function assertSameOrigin(request: Request, allowedOrigins: readonly string[]): AuthDecision | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const normalized = origin.replace(/\/+$/, "");
  if (normalized === new URL(request.url).origin) return null;
  if (allowedOrigins.some(allowed => allowed.replace(/\/+$/, "") === normalized)) return null;
  return deny(403, "cross_origin");
}
