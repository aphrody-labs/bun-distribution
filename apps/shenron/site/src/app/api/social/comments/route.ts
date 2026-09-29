/**
 * /api/social/comments — le fil de commentaires de n'importe quelle surface.
 *
 *   GET  ?target=post:<id>&page=1&sort=recent   → page de commentaires
 *   POST { target, body, parentId? }            → dépose un commentaire
 *
 * Pourquoi une route d'API et pas une Server Action : le bloc commentaires est
 * un îlot client monté sur des pages **statiques/ISR**. Lire la session dans la
 * page la rendrait dynamique et lui ferait perdre son cache CDN (règle de
 * latence du projet) ; ici seule la route lit les cookies.
 *
 * Un agent n'écrit PAS par cette route : il passe par `/api/agent/v1/comments`
 * avec sa clé et sa portée `comment`. Deux portes, deux contrôles distincts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { createMemoryRateLimiter } from "@/lib/memory-rate-limit";
import { createComment, listComments, SocialError } from "@/lib/social";
import {
	COMMENT_MAX,
	isCommentSort,
	parseTarget,
	socialErrorMessage,
	type CommentSort,
} from "@/lib/social-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 6 commentaires par 5 minutes et par membre : de quoi tenir une conversation,
// pas de quoi inonder un fil.
const writeLimit = createMemoryRateLimiter({
	windowMs: 5 * 60_000,
	limit: 6,
	namespace: "comments",
});

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function fail(code: string, status: number): NextResponse {
	return NextResponse.json(
		{ ok: false, error: code, message: socialErrorMessage(code) },
		{ status, headers: NO_STORE }
	);
}

async function viewer() {
	try {
		const me = await getCurrentUser();
		return {
			id: me?.user?.id ?? null,
			name: me?.user?.username ?? null,
			isAdmin: me?.user?.roleAdmin === true,
		};
	} catch {
		return { id: null, name: null, isAdmin: false };
	}
}

export async function GET(req: NextRequest): Promise<NextResponse> {
	const target = parseTarget(req.nextUrl.searchParams.get("target"));
	if (!target) return fail("target_unknown", 400);

	const sortParam = req.nextUrl.searchParams.get("sort");
	const sort: CommentSort = isCommentSort(sortParam) ? sortParam : "recent";
	const page = Number(req.nextUrl.searchParams.get("page") ?? "1");

	const me = await viewer();
	const data = await listComments(target, {
		page: Number.isFinite(page) ? page : 1,
		sort,
		viewerId: me.id,
		viewerIsAdmin: me.isAdmin,
	});

	return NextResponse.json({ ok: true, ...data, viewerIsAdmin: me.isAdmin }, { headers: NO_STORE });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
	const me = await viewer();
	if (!me.id || !me.name) return fail("auth_required", 401);
	const rate = await writeLimit.consume(me.id);
	if (rate.limited)
		return NextResponse.json(
			{ ok: false, error: "rate_limited" },
			{ status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
		);

	let payload: unknown;
	try {
		payload = await req.json();
	} catch {
		return fail("body_empty", 400);
	}
	if (!payload || typeof payload !== "object") return fail("body_empty", 400);

	const { target: rawTarget, body, parentId } = payload as Record<string, unknown>;
	const target = parseTarget(typeof rawTarget === "string" ? rawTarget : null);
	if (!target) return fail("target_unknown", 400);
	if (typeof body !== "string") return fail("body_empty", 400);
	// Borne grossière avant normalisation : inutile de charger 5 Mo de texte en
	// mémoire pour découvrir ensuite qu'il dépasse la limite.
	if (body.length > COMMENT_MAX * 2) return fail("body_too_long", 413);

	try {
		const comment = await createComment({
			target,
			body,
			parentId: typeof parentId === "string" && parentId ? parentId : null,
			actor: { type: "user", id: me.id, name: me.name, isAdmin: me.isAdmin },
		});
		return NextResponse.json({ ok: true, comment }, { status: 201, headers: NO_STORE });
	} catch (err) {
		if (err instanceof SocialError) return fail(err.code, err.status);
		console.error("[social] POST comments", err);
		return fail("server_error", 500);
	}
}
