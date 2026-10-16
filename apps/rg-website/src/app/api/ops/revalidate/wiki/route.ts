import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Pages dont le contenu provient exclusivement du miroir `inagle_*`. */
const WIKI_DETAIL_PATHS = [
	"/chara/[id]",
	"/skill/[id]",
	"/item/[id]",
	"/passive/[id]",
	"/tactic/[id]",
	"/aura/[category]/[id]",
] as const;

function hasValidToken(request: Request): boolean {
	const expected = process.env.AZALEE_REVALIDATE_SECRET?.trim();
	if (!expected) return false;

	const authorization = request.headers.get("authorization");
	const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
	const received = request.headers.get("x-azalee-revalidate-token") ?? bearer;
	if (!received) return false;

	const receivedBytes = Buffer.from(received);
	const expectedBytes = Buffer.from(expected);
	if (receivedBytes.length !== expectedBytes.length) return false;

	return timingSafeEqual(receivedBytes, expectedBytes);
}

/**
 * Invalide les fiches ISR après l'échange atomique du miroir.
 *
 * Le publisher `niers` peut appeler cette route après une publication réussie;
 * l'absence de secret désactive volontairement l'opération plutôt que de
 * laisser une route d'administration ouverte par défaut.
 */
export async function POST(request: Request) {
	if (!hasValidToken(request)) {
		return NextResponse.json({ error: "unauthorized" }, { status: 401 });
	}

	for (const path of WIKI_DETAIL_PATHS) {
		revalidatePath(path, "page");
	}

	return NextResponse.json({
		paths: WIKI_DETAIL_PATHS,
		revalidated: true,
	});
}
