import { getCurrentUser } from "@/lib/session";
import { deleteTierlistOwned } from "@/lib/tierlists";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const me = await getCurrentUser();
	if (!me?.user) {
		return Response.json({ error: "Connexion requise." }, { status: 401 });
	}
	const { id } = await params;
	if (!id) return Response.json({ error: "Identifiant manquant." }, { status: 400 });

	try {
		const ok = await deleteTierlistOwned(id, me.user.id, me.user.roleAdmin === true);
		if (!ok) {
			return Response.json({ error: "Tierlist introuvable ou non autorisée." }, { status: 404 });
		}
		return Response.json({ ok: true });
	} catch (e) {
		console.error("deleteTierlist failed:", e);
		return Response.json({ error: "Échec de la suppression." }, { status: 500 });
	}
}
