// Source: packages/shenron/auth/src/hono.ts at 8172f535ce (preserved Git history).
/**
 * Hono adapter (runtime class `hono`): an auth middleware setting
 * `c.var.principal`, and the Better Auth mount.
 */
import type { Hono, MiddlewareHandler } from "hono";
import { authorize, type AuthDecision, type AuthFailure, type Principal, type Strategy } from "./guards";
import { AUTH_BASE_PATH, type AuthLike } from "./index";

export type AuthVariables = { principal: Principal };

export interface AuthMiddlewareOptions {
  /** Post-decision check, e.g. `(d) => requireScope(d, "write:articles")`. */
  require?: (decision: AuthDecision) => AuthDecision;
  /** Refusal response. Default JSON `{ error: code }` with the decision status. */
  deny?: (decision: AuthFailure) => Response;
}

const defaultDeny = (decision: AuthFailure): Response =>
  Response.json({ error: decision.code }, { status: decision.status });

export function authMiddleware(
  strategies: readonly Strategy[],
  options: AuthMiddlewareOptions = {},
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    let decision = await authorize(c.req.raw, strategies);
    if (options.require) decision = options.require(decision);
    if (!decision.ok) return (options.deny ?? defaultDeny)(decision);
    c.set("principal", decision.principal);
    await next();
  };
}

// oxlint-disable-next-line typescript/no-explicit-any -- any Env/Schema of the host app
export function mountBetterAuth(app: Hono<any>, auth: AuthLike, basePath = AUTH_BASE_PATH): void {
  app.on(["GET", "POST"], `${basePath}/*`, c => auth.handler(c.req.raw));
}
