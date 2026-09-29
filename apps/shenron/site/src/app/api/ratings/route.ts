/**
 * GET  /api/ratings?type=game&id=42
 *   → { summary, mine, comments } — lecture publique ; `mine` si connecté.
 *
 * POST /api/ratings
 *   body: { type, id, score, comment? }
 *   → upsert note (Discord lié requis).
 */
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import {
	RATING_COMMENT_MAX,
	getRatingState,
	isRatingTargetType,
	upsertRating,
} from "@/lib/ratings";
import { createMemoryRateLimiter } from "@/lib/memory-rate-limit";

/** Home + page classements + badges podium (cache tag). */
function revalidateTops() {
	revalidatePath("/");
	revalidatePath("/classements");
	revalidateTag("community-tops", "max");
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postSchema = z.object({
	type: z.string(),
	id: z.string().min(1).max(64),
	score: z.number().int().min(1).max(5),
	// undefined = ne pas toucher ; null/"" = effacer
	comment: z.string().max(RATING_COMMENT_MAX).nullish(),
});

// Rate-limit mémoire : 20 notes / 10 min / user (anti-spam).
const ratingRateLimit = createMemoryRateLimiter({
	windowMs: 10 * 60_000,
	limit: 20,
	namespace: "ratings",
});

export async function GET(req: NextRequest): Promise<NextResponse> {
	const type = req.nextUrl.searchParams.get("type");
	const id = req.nextUrl.searchParams.get("id");
	if (!type || !id || !isRatingTargetType(type)) {
		return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
	}

	let userId: string | null = null;
	try {
		const me = await getCurrentUser();
		userId = me?.user?.id ?? null;
	} catch {
		userId = null;
	}

	try {
		const state = await getRatingState(type, id.trim().slice(0, 64), userId);
		return NextResponse.json(
			{ ok: true, ...state },
			{ headers: { "Cache-Control": "private, no-store" } }
		);
	} catch (err) {
		console.error("[ratings] GET failed", err);
		return NextResponse.json({ ok: false, error: "fetch_failed" }, { status: 500 });
	}
}

export async function POST(req: NextRequest): Promise<NextResponse> {
	let me: Awaited<ReturnType<typeof getCurrentUser>> = null;
	try {
		me = await getCurrentUser();
	} catch {
		me = null;
	}
	// Compte Discord lié obligatoire (user métier créé à la liaison OAuth).
	if (!me?.user?.id || !me.discordId) {
		return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
	}

	const rate = await ratingRateLimit.consume(me.user.id);
	if (rate.limited) {
		return NextResponse.json(
			{ ok: false, error: "rate_limited" },
			{ status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
		);
	}

	let parsed: z.infer<typeof postSchema>;
	try {
		parsed = postSchema.parse(await req.json());
	} catch {
		return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
	}

	if (!isRatingTargetType(parsed.type)) {
		return NextResponse.json({ ok: false, error: "bad_type" }, { status: 400 });
	}

	try {
		const state = await upsertRating({
			targetType: parsed.type,
			targetId: parsed.id,
			userId: me.user.id,
			score: parsed.score,
			comment: parsed.comment === undefined ? undefined : parsed.comment,
		});
		revalidateTops();
		return NextResponse.json({ ok: true, ...state });
	} catch (err) {
		const msg = err instanceof Error ? err.message : "upsert_failed";
		if (msg === "invalid_score" || msg === "invalid_target" || msg === "comment_too_long") {
			return NextResponse.json({ ok: false, error: msg }, { status: 400 });
		}
		console.error("[ratings] POST failed", err);
		return NextResponse.json({ ok: false, error: "upsert_failed" }, { status: 500 });
	}
}
