// SPDX-License-Identifier: Apache-2.0
/**
 * route.ts — Route API A2A officielle de Dragon Ball FR (Next.js 16 App Router).
 *
 * Expose l'endpoint standardisé Agent2Agent (A2A JSON-RPC 2.0) :
 * - GET  /api/a2a → Renvoie l'AgentCard A2A officielle de Shenron.
 * - POST /api/a2a → Exécute les méthodes A2A (message/send, tasks/get, tasks/list, tasks/update).
 *
 * Unifie Codex, agycli, Claude, les workers locaux, le RAG et les sous-agents sous un protocole
 * bimodal (JSON structuré + Markdown). Honest Delivery : RAG et état OCR/traduction mesurés,
 * ordres en attente jusqu'au résultat du pair (voir packages/shenron/pipeline/src/aphrody/a2a.ts).
 * Synchronise et alerte automatiquement dans le salon Discord #bot-admin (1548677623935139901).
 */

import { NextResponse } from "next/server";
import { getA2AHub } from "@/lib/a2a-hub";
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

export async function GET(request: Request) {
	const url = new URL(request.url);
	if (url.searchParams.get("envelopes") === "1" || url.searchParams.get("view") === "mailbox") {
		const denied = a2aGuard(request);
		if (denied) return denied;
		const envelopes = await (typeof getA2AHub().listStoredEnvelopes === "function"
			? getA2AHub().listStoredEnvelopes(100)
			: getA2AHub().listEnvelopes(100));
		return NextResponse.json({ envelopes, total: envelopes.length }, { headers: CORS_HEADERS });
	}

	const origin = url.origin;
	const card = getA2AHub().getAgentCard(origin);
	return NextResponse.json(card, {
		headers: {
			...CORS_HEADERS,
			"Cache-Control": "public, max-age=3600, s-maxage=3600",
		},
	});
}

export async function POST(request: Request) {
	const denied = a2aGuard(request);
	if (denied) return denied;
	try {
		const body = await request.json();

		// Si le corps est une enveloppe directe (possède 'kind' ou 'topic' ou 'from')
		if (body && typeof body === "object" && ("kind" in body || "topic" in body || "subject" in body)) {
			const env = await getA2AHub().handleMsgEnvelope(body);
			return NextResponse.json(env, {
				status: env.kind === "error" ? 400 : 200,
				headers: CORS_HEADERS,
			});
		}

		const response = await getA2AHub().handleJsonRpc(body);
		const status = "error" in response && response.error ? 400 : 200;

		return NextResponse.json(response, {
			status,
			headers: CORS_HEADERS,
		});
	} catch (err: any) {
		return NextResponse.json(
			{
				jsonrpc: "2.0",
				id: null,
				error: {
					code: -32700,
					message: "Parse error",
					data: err?.message ?? String(err),
				},
			},
			{ status: 400, headers: CORS_HEADERS }
		);
	}
}
