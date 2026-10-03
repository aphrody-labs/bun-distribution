// SPDX-License-Identifier: Apache-2.0
/**
 * route.ts — passerelle admin de la console A2A (`/admin/a2a`).
 *
 * `/api/a2a` est la surface des pairs : quand `SHENRON_A2A_ENFORCE` est actif elle exige
 * `Bearer SHENRON_A2A_TOKEN`, un secret qu'un navigateur ne doit jamais détenir. La console passe donc
 * par cette route, gardée par la session admin du serveur, qui appelle le hub (`@/lib/a2a-hub`)
 * directement : aucun jeton A2A n'est lu, injecté ni renvoyé au client.
 *
 * - GET  → boîte aux lettres amont `{ envelopes, total, fetchedAt }`.
 * - POST → `{ target, kind, instruction }` validé par allowlist : `ask` part en JSON-RPC `message/send`
 *          (`/a2a`), `fact` et `ping` en enveloppe `.coord` (`/msg`). L'émetteur est fixé ici.
 *
 * Les erreurs amont sont ramenées à un code (`a2a_upstream_*`) : le message brut peut contenir une
 * adresse ou un chemin interne. Le détail va dans les journaux du serveur.
 */
import { NextResponse } from "next/server";
import { parseBearer } from "@shenron/auth/crypto";
import { fetchEnvelopes, postEnvelope, postJsonRpc, type UpstreamReply } from "@/lib/a2a-hub";
import { getCurrentUser } from "@/lib/session";
import {
  A2A_ADMIN_SOURCE,
  normalizeEnvelope,
  parseDispatchBody,
  type A2ADispatchBody,
} from "@/app/admin/a2a/a2a-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

function reply(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * `getCurrentUser()` élève en admin les clés `dbfr_agent_*` qui portent `moderate`, `publish:articles`
 * ou `write:articles` (session.ts). Un ordre YOLO vers les pairs n'est pas une capacité d'agent
 * éditorial : ces clés sont refusées ici, même si leur porteur passerait la garde admin.
 */
function isAgentKeyRequest(request: Request): boolean {
  return parseBearer(request.headers)?.startsWith("dbfr_agent_") === true;
}

/** `a2a-hub` marque seul l'échec de connexion ; un 502 renvoyé par l'amont lui-même reste une erreur amont. */
function upstreamFailure(upstream: UpstreamReply): NextResponse {
  const body = upstream.body as { error?: unknown } | null;
  const error =
    body?.error === "a2a_upstream_unreachable" ? "a2a_upstream_unreachable" : "a2a_upstream_error";
  return reply({ error, upstreamStatus: upstream.status }, 502);
}

async function denyUnlessAdmin(request: Request): Promise<NextResponse | null> {
  if (isAgentKeyRequest(request)) return reply({ error: "agent_key_not_allowed" }, 403);
  const me = await getCurrentUser();
  if (!me) return reply({ error: "unauthenticated" }, 401);
  if (me.user?.roleAdmin !== true) return reply({ error: "forbidden" }, 403);
  return null;
}

/**
 * Écriture authentifiée par cookie : le corps doit être du JSON déclaré (une requête « simple »
 * inter-sites ne peut pas l'envoyer sans préliminaire CORS) et ne pas venir d'un autre site.
 */
function denyCrossSiteWrite(request: Request): NextResponse | null {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    return reply({ error: "cross_site_denied" }, 403);
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return reply({ error: "unsupported_media_type" }, 415);
  return null;
}

export async function GET(request: Request) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;

  const upstream = await fetchEnvelopes(100);
  if (upstream.status !== 200 || !Array.isArray(upstream.body)) {
    console.error(
      "[api/admin/a2a] boîte aux lettres amont indisponible",
      upstream.status,
      upstream.body,
    );
    return upstreamFailure(upstream);
  }
  const envelopes = upstream.body.flatMap((row) => normalizeEnvelope(row) ?? []);
  return reply({ envelopes, total: envelopes.length, fetchedAt: new Date().toISOString() });
}

function envelopeId(): string {
  return `env-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

function dispatch(order: A2ADispatchBody) {
  if (order.kind === "ask") {
    return postJsonRpc({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "message/send",
      params: {
        target: order.target,
        sourceAgent: A2A_ADMIN_SOURCE,
        instruction: order.instruction,
        yolo: true,
      },
    });
  }
  return postEnvelope({
    v: 1,
    ts: new Date().toISOString(),
    id: envelopeId(),
    from: A2A_ADMIN_SOURCE,
    to: order.target,
    kind: order.kind,
    topic: `admin.${order.kind}`,
    body: order.instruction,
  });
}

export async function POST(request: Request) {
  const denied = (await denyUnlessAdmin(request)) ?? denyCrossSiteWrite(request);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return reply({ error: "invalid_json" }, 400);
  }
  const parsed = parseDispatchBody(raw);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);

  const upstream = await dispatch(parsed.body);
  const body =
    upstream.body && typeof upstream.body === "object"
      ? (upstream.body as Record<string, unknown>)
      : {};
  if (upstream.status !== 200) {
    console.error("[api/admin/a2a] envoi refusé par le hub", upstream.status, upstream.body);
    return upstreamFailure(upstream);
  }
  // Le pont `/a2a` répond 200 même pour une erreur JSON-RPC : elle est dans le corps.
  const rpcError = body.error as { code?: unknown } | undefined;
  if (rpcError) {
    console.error("[api/admin/a2a] erreur JSON-RPC du hub", rpcError);
    return reply(
      {
        error: "a2a_upstream_rejected",
        rpcCode: typeof rpcError.code === "number" ? rpcError.code : null,
      },
      502,
    );
  }
  const result = body.result as { envelope?: { id?: unknown } } | undefined;
  // `/a2a` désigne l'enveloppe déposée dans `result.envelope`, `/msg` la renvoie dans `id`.
  const created = parsed.body.kind === "ask" ? result?.envelope?.id : body.id;
  const id = typeof created === "string" ? created : null;
  return reply({ ok: true, id, kind: parsed.body.kind, target: parsed.body.target });
}
