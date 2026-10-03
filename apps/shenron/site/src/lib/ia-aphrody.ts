// SPDX-License-Identifier: Apache-2.0
// Pure decisions of the admin IA API (`/api/admin/ia`): who may call it, how a body is read and how
// the evaluation sample size is validated. The route stays a thin dispatcher on top of them.
//
// No `import "server-only"`: like admin-guard.ts this module only reaches the session through the
// `@/lib/session` namespace, so `mock.module("@/lib/session")` in the suites intercepts it.
import { NextResponse } from "next/server";
import * as session from "@/lib/session";
import type { CurrentUser, SiteUser } from "@/lib/session";

export const IA_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export type IaAccess = "ok" | "unauthenticated" | "forbidden";

/**
 * `unauthenticated` (no session) is told apart from `forbidden` (session without the admin role) so
 * the cockpit can ask for a new login instead of showing a rights error. A valid session whose
 * business user is not linked yet is `forbidden`: it is not an admin.
 */
export function iaAccess(me: CurrentUser | null): IaAccess {
  if (!me) return "unauthenticated";
  return me.user?.roleAdmin === true ? "ok" : "forbidden";
}

export type IaAdminGate =
  | { ok: true; me: CurrentUser & { user: SiteUser } }
  | { ok: false; response: NextResponse };

export function iaDenied(access: Exclude<IaAccess, "ok">): NextResponse {
  if (access === "unauthenticated") {
    return NextResponse.json(
      { error: "Session requise : connectez-vous pour accéder au cockpit IA." },
      { status: 401, headers: { ...IA_NO_STORE, "WWW-Authenticate": "Bearer" } },
    );
  }
  return NextResponse.json(
    { error: "Accès réservé aux administrateurs." },
    { status: 403, headers: IA_NO_STORE },
  );
}

/** Resolves the current user once and answers 401 (no session) or 403 (not admin) when refused. */
export async function requireIaAdmin(): Promise<IaAdminGate> {
  const me = await session.getCurrentUser();
  const access = iaAccess(me);
  if (access !== "ok") return { ok: false, response: iaDenied(access) };
  return { ok: true, me: me as CurrentUser & { user: SiteUser } };
}

/** JSON object of a request; an unreadable body, `null`, an array or a scalar all read as `{}`. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => null);
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export const EVAL_DEFAULT_SAMPLES = 25;
export const EVAL_MAX_SAMPLES = 1_000;

/**
 * Gold cases evaluated by `evaluate_rag`. Absent = {@link EVAL_DEFAULT_SAMPLES}; `0` = the whole gold
 * set (the cockpit's « tout le jeu doré »); a positive integer is capped at {@link EVAL_MAX_SAMPLES}.
 * Anything else (NaN, negative, fractional, blank, non-numeric) is `null`: the route answers 400
 * instead of silently launching the heaviest run.
 */
export function parseEvalSamples(value: unknown): number | null {
  if (value === undefined || value === null) return EVAL_DEFAULT_SAMPLES;
  if (typeof value === "string" ? value.trim() === "" : typeof value !== "number") return null;
  const samples = Number(value);
  if (!Number.isSafeInteger(samples) || samples < 0) return null;
  return Math.min(samples, EVAL_MAX_SAMPLES);
}
