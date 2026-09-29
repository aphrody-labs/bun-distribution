/**
 * DELETE /api/ratings/[id]
 *   body optionnel: { mode?: "full" | "comment" }
 *   - full (défaut) : supprime la note entière
 *   - comment : efface seulement le texte du commentaire (garde le score)
 *
 * Autorisé : auteur de la note OU admin.
 */
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { siteRatings } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath, revalidateTag } from "next/cache";
import {
	clearRatingComment,
	deleteRating,
	getRatingState,
	isRatingTargetType,
} from "@/lib/ratings";

function revalidateTops() {
	revalidatePath("/");
	revalidatePath("/classements");
	revalidateTag("community-tops", "max");
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
	const { id } = await params;
	if (!id) {
		return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
	}

	let me: Awaited<ReturnType<typeof getCurrentUser>> = null;
	try {
		me = await getCurrentUser();
	} catch {
		me = null;
	}
	if (!me?.user?.id) {
		return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
	}

	const [row] = await db.select().from(siteRatings).where(eq(siteRatings.id, id)).limit(1);
	if (!row) {
		return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
	}

	const isAuthor = row.userId === me.user.id;
	const isAdmin = me.user.roleAdmin === true;
	if (!isAuthor && !isAdmin) {
		return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
	}

	let mode: "full" | "comment" = "full";
	try {
		const body = (await req.json().catch(() => null)) as { mode?: string } | null;
		if (body?.mode === "comment") mode = "comment";
	} catch {
		/* pas de body = full */
	}

	// Les non-admins ne peuvent supprimer que leur propre note entière ;
	// un admin peut aussi n'effacer que le commentaire (modération soft).
	if (mode === "comment") {
		if (!isAdmin && !isAuthor) {
			return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
		}
		await clearRatingComment(id);
	} else {
		await deleteRating(id);
	}

	revalidateTops();

	// Renvoie l'état à jour pour rafraîchir le panneau sans re-fetch.
	const targetType = row.targetType;
	const targetId = row.targetId;
	if (isRatingTargetType(targetType)) {
		const state = await getRatingState(targetType, targetId, me.user.id);
		return NextResponse.json({ ok: true, ...state });
	}
	return NextResponse.json({ ok: true });
}
