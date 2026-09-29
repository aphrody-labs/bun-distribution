/**
 * /api/social/reactions — le « j'aime » partagé par toutes les surfaces.
 *
 *   GET  ?target=post:<id>[&target=…]  → compteurs + état du membre courant
 *   POST { target }                    → bascule le like du membre
 *
 * Plusieurs `target` sont acceptés en lecture : une grille de douze cartes ne
 * doit pas déclencher douze requêtes. Le GET est `no-store` parce que la réponse
 * contient l'état du membre — jamais cacheable, même une seconde.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { createMemoryRateLimiter } from "@/lib/memory-rate-limit";
import {
	myReactions,
	reactionCounts,
	reactionState,
	SocialError,
	toggleReaction,
} from "@/lib/social";
import { parseTarget, socialErrorMessage, type SocialKind } from "@/lib/social-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;
/** Un toggle est anodin mais gratuit : on borne quand même le matraquage. */
const toggleLimit = createMemoryRateLimiter({
	windowMs: 60_000,
	limit: 40,
	namespace: "reactions",
});
/** Plafond de cibles par lecture groupée — borne la requête SQL. */
const MAX_TARGETS = 40;

function fail(code: string, status: number): NextResponse {
	return NextResponse.json(
		{ ok: false, error: code, message: socialErrorMessage(code) },
		{ status, headers: NO_STORE }
	);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
	const raw = req.nextUrl.searchParams.getAll("target").slice(0, MAX_TARGETS);
	const targets = raw.map(parseTarget).filter((t): t is NonNullable<typeof t> => t !== null);
	if (targets.length === 0) return fail("target_unknown", 400);

	let userId: string | null = null;
	try {
		const me = await getCurrentUser();
		userId = me?.user?.id ?? null;
	} catch {
		userId = null;
	}

	// Une seule cible : l'état complet (compteur + mien). Plusieurs : les
	// compteurs par `kind`, regroupés pour ne pas multiplier les requêtes.
	if (targets.length === 1) {
		const state = await reactionState(targets[0]!, userId);
		return NextResponse.json(
			{ ok: true, reactions: { [`${targets[0]!.kind}:${targets[0]!.id}`]: state } },
			{ headers: NO_STORE }
		);
	}

	const byKind = new Map<SocialKind, string[]>();
	for (const t of targets) {
		const list = byKind.get(t.kind);
		if (list) list.push(t.id);
		else byKind.set(t.kind, [t.id]);
	}

	const reactions: Record<string, { likes: number; liked: boolean }> = {};
	await Promise.all(
		[...byKind.entries()].map(async ([kind, ids]) => {
			const counts = await reactionCounts(kind, ids);
			for (const id of ids) {
				reactions[`${kind}:${id}`] = { likes: counts.get(id) ?? 0, liked: false };
			}
		})
	);

	// L'état personnel en UNE requête par `kind`, et non une par cible : une
	// grille de quarante cartes déclenchait sinon quarante allers-retours SQL
	// pour écrire un booléen sur chacune.
	if (userId) {
		const mine = await myReactions(userId, targets);
		for (const key of mine) {
			const current = reactions[key];
			if (current) current.liked = true;
		}
	}

	return NextResponse.json({ ok: true, reactions }, { headers: NO_STORE });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
	let userId: string | null = null;
	try {
		const me = await getCurrentUser();
		userId = me?.user?.id ?? null;
	} catch {
		userId = null;
	}
	if (!userId) return fail("auth_required", 401);
	const rate = await toggleLimit.consume(userId);
	if (rate.limited)
		return NextResponse.json(
			{ ok: false, error: "rate_limited" },
			{ status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
		);

	let payload: Record<string, unknown>;
	try {
		payload = (await req.json()) as Record<string, unknown>;
	} catch {
		return fail("target_unknown", 400);
	}
	const target = parseTarget(typeof payload.target === "string" ? payload.target : null);
	if (!target) return fail("target_unknown", 400);

	try {
		const res = await toggleReaction(target, userId);
		return NextResponse.json({ ok: true, ...res }, { headers: NO_STORE });
	} catch (err) {
		if (err instanceof SocialError) return fail(err.code, err.status);
		console.error("[social] POST reactions", err);
		return fail("server_error", 500);
	}
}
