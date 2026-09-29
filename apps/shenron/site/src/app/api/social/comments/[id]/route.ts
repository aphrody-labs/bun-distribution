/**
 * /api/social/comments/[id] — édition, retrait et modération d'un commentaire.
 *
 *   GET    ?replies=1   → toutes les réponses du commentaire
 *   PATCH  { body }     → l'auteur corrige son message
 *   PATCH  { action }   → la modération masque / rétablit / épingle
 *   DELETE              → l'auteur retire son message, ou la modération le masque
 *
 * Le partage d'une même route entre « éditer » et « modérer » est volontaire :
 * c'est `lib/social.ts` qui tranche qui a le droit de quoi, à un seul endroit.
 * Deux routes auraient signifié deux contrôles de droits à tenir synchrones.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import {
	editComment,
	listReplies,
	moderateComment,
	removeComment,
	SocialError,
	type SocialActor,
} from "@/lib/social";
import { COMMENT_MAX, socialErrorMessage } from "@/lib/social-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;
const MODERATION_ACTIONS = new Set(["hide", "restore", "pin", "unpin"]);

function fail(code: string, status: number): NextResponse {
	return NextResponse.json(
		{ ok: false, error: code, message: socialErrorMessage(code) },
		{ status, headers: NO_STORE }
	);
}

async function actor(): Promise<SocialActor | null> {
	try {
		const me = await getCurrentUser();
		if (!me?.user?.id) return null;
		return {
			type: "user",
			id: me.user.id,
			name: me.user.username,
			isAdmin: me.user.roleAdmin === true,
		};
	} catch {
		return null;
	}
}

export async function GET(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
	const { id } = await params;
	const me = await actor();
	const replies = await listReplies(id, {
		viewerId: me?.type === "user" ? me.id : null,
		viewerIsAdmin: me?.type === "user" ? me.isAdmin : false,
	});
	return NextResponse.json({ ok: true, replies }, { headers: NO_STORE });
}

export async function PATCH(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
	const { id } = await params;
	const me = await actor();
	if (!me) return fail("auth_required", 401);

	let payload: Record<string, unknown>;
	try {
		payload = (await req.json()) as Record<string, unknown>;
	} catch {
		return fail("body_empty", 400);
	}

	try {
		const action = payload.action;
		if (typeof action === "string") {
			if (!MODERATION_ACTIONS.has(action)) return fail("forbidden", 400);
			await moderateComment(id, action as "hide" | "restore" | "pin" | "unpin", me);
			return NextResponse.json({ ok: true }, { headers: NO_STORE });
		}

		const body = payload.body;
		if (typeof body !== "string") return fail("body_empty", 400);
		if (body.length > COMMENT_MAX * 2) return fail("body_too_long", 413);
		const comment = await editComment(id, body, me);
		return NextResponse.json({ ok: true, comment }, { headers: NO_STORE });
	} catch (err) {
		if (err instanceof SocialError) return fail(err.code, err.status);
		console.error("[social] PATCH comment", err);
		return fail("server_error", 500);
	}
}

export async function DELETE(
	_req: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
	const { id } = await params;
	const me = await actor();
	if (!me) return fail("auth_required", 401);

	try {
		const res = await removeComment(id, me);
		return NextResponse.json({ ok: true, status: res.status }, { headers: NO_STORE });
	} catch (err) {
		if (err instanceof SocialError) return fail(err.code, err.status);
		console.error("[social] DELETE comment", err);
		return fail("server_error", 500);
	}
}
