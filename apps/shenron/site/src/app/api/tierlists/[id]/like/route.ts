import { getCurrentUser } from "@/lib/session";
import { getTierlistLikeState, toggleTierlistLike } from "@/lib/tierlists";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const me = await getCurrentUser();
	const state = await getTierlistLikeState(id, me?.user?.id ?? null);
	return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const me = await getCurrentUser();
	if (!me?.user) {
		return Response.json({ error: "Connexion requise." }, { status: 401 });
	}
	const { id } = await params;
	try {
		const state = await toggleTierlistLike(id, me.user.id);
		return Response.json(state);
	} catch {
		// FK violation = tierlist inexistante.
		return Response.json({ error: "Tierlist introuvable." }, { status: 404 });
	}
}
