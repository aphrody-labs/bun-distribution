// SPDX-License-Identifier: Apache-2.0
/**
 * route.ts — Route API A2A de Dragon Ball FR (Next.js 16 App Router).
 *
 * Proxy mince vers le serveur A2A Rust servi par `aphrody a2a serve`
 * (base `APHRODY_A2A_URL`, défaut http://127.0.0.1:8788, voir `@/lib/a2a-hub`) :
 * - GET  /api/a2a                 → AgentCard amont (`/.well-known/agent-card.json`).
 * - GET  /api/a2a?envelopes=1     → boîte aux lettres amont (`/coord`), `{ envelopes, total }`.
 * - POST /api/a2a (enveloppe)     → `/msg`.
 * - POST /api/a2a (JSON-RPC)      → `message/send` vers `/a2a`, méthodes A2A 1.0 vers `/`.
 * Amont injoignable : 502 `a2a_upstream_unreachable`.
 */

import { NextResponse } from "next/server";
import { fetchAgentCard, fetchEnvelopes, postEnvelope, postJsonRpc } from "@/lib/a2a-hub";
import { A2A_TOKEN_ENV, a2aDeniedBody, a2aEnforced, decideA2AWrite } from "@shenron/auth/a2a";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

/**
 * S5 (docs/STACK.md D14) : écritures (POST) et lecture de la boîte aux lettres
 * (`?envelopes=1`, `?view=mailbox`) exigent `Bearer SHENRON_A2A_TOKEN` quand
 * `SHENRON_A2A_ENFORCE` est actif. Drapeau inactif : comportement inchangé et
 * un avertissement par processus. L'AgentCard et OPTIONS restent publics.
 * Environnement lu à chaque requête, jamais au chargement du module.
 */
function a2aGuard(request: Request): NextResponse | null {
	const decision = decideA2AWrite(request.headers, {
		token: process.env[A2A_TOKEN_ENV],
		enforce: a2aEnforced(process.env),
	});
	if (decision.ok) return null;
	return NextResponse.json(a2aDeniedBody(decision), {
		status: decision.status,
		headers:
			decision.status === 401 ? { ...CORS_HEADERS, "WWW-Authenticate": "Bearer" } : CORS_HEADERS,
	});
}

export async function OPTIONS() {
	return new NextResponse(null, {
		status: 204,
		headers: CORS_HEADERS,
	});
}

function isRpcError(body: unknown): boolean {
	return !!body && typeof body === "object" && "error" in body && !!(body as { error?: unknown }).error;
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	if (url.searchParams.get("envelopes") === "1" || url.searchParams.get("view") === "mailbox") {
		const denied = a2aGuard(request);
		if (denied) return denied;
		const reply = await fetchEnvelopes(100);
		if (reply.status !== 200 || !Array.isArray(reply.body)) {
			return NextResponse.json(reply.body, { status: reply.status === 200 ? 502 : reply.status, headers: CORS_HEADERS });
		}
		return NextResponse.json(
			{ envelopes: reply.body, total: reply.body.length },
			{ headers: CORS_HEADERS }
		);
	}

	const card = await fetchAgentCard();
	return NextResponse.json(card.body, {
		status: card.status,
		headers:
			card.status === 200
				? { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600, s-maxage=3600" }
				: CORS_HEADERS,
	});
}

export async function POST(request: Request) {
	const denied = a2aGuard(request);
	if (denied) return denied;
	let body: unknown;
	try {
		body = await request.json();
	} catch (err: any) {
		return NextResponse.json(
			{
				jsonrpc: "2.0",
				id: null,
				error: { code: -32700, message: "Parse error", data: err?.message ?? String(err) },
			},
			{ status: 400, headers: CORS_HEADERS }
		);
	}

	const isEnvelope =
		!!body && typeof body === "object" && ("kind" in body || "topic" in body || "subject" in body);
	const reply = isEnvelope ? await postEnvelope(body) : await postJsonRpc(body);
	const status = reply.status >= 300 ? reply.status : isRpcError(reply.body) ? 400 : 200;
	return NextResponse.json(reply.body, { status, headers: CORS_HEADERS });
}
