import { chercheEntites, TYPES_RATTACHABLES } from "@/lib/wiki-admin";
import { isCurrentUserAdmin } from "@/lib/session";

/**
 * Recherche d'entités du wiki pour rattacher un média depuis la galerie
 * (`/admin/db-universe/assets`). Lecture seule, réservée aux administrateurs.
 *
 * GET /api/admin/entites?type=character&q=goku → { entites: [{ id, nom }] }
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	if (!(await isCurrentUserAdmin())) {
		return Response.json({ error: "Accès réservé aux administrateurs." }, { status: 403 });
	}
	const url = new URL(req.url);
	const type = url.searchParams.get("type") ?? "";
	const q = url.searchParams.get("q") ?? "";
	if (!TYPES_RATTACHABLES.includes(type)) {
		return Response.json({ error: `Type inconnu : ${type}` }, { status: 400 });
	}
	if (q.trim().length < 2) return Response.json({ entites: [] });
	return Response.json({ entites: await chercheEntites(type, q) });
}
