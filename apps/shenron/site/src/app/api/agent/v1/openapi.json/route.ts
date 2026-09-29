/**
 * GET /api/agent/v1/openapi.json — le contrat de l'API d'écriture, **authentifié**.
 *
 * Il a été public une demi-journée le 2026-09-12, au motif qu'un intégrateur doit
 * pouvoir lire ce qu'il pourra faire avant qu'on lui confie une clé. À l'usage,
 * c'est surtout la carte de la salle des machines : portées, routes d'écriture,
 * garde-fous — exactement ce qu'on ne publie pas. Deux accès le lisent désormais :
 *
 *   - une **clé d'agent** valide (portée `read`) : l'intégrateur en a une, c'est
 *     le moment où le schéma lui sert ;
 *   - une **session d'administration** : pour relire le contrat depuis
 *     `/admin/api-docs` sans fabriquer de jeton.
 *
 * Réponse `404` et non `403` pour un appelant anonyme : le contrat n'a pas à
 * confirmer son existence.
 */
import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/agent-openapi";
import { authenticateAgent } from "@/lib/agent-keys";
import { getCurrentUser } from "@/lib/session";
import { SITE_URL } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
	const agent = await authenticateAgent(req).catch(() => null);
	const lisible =
		(agent?.scopes.includes("read") ?? false) ||
		(await getCurrentUser()
			.then((me) => me?.user?.roleAdmin === true)
			.catch(() => false));

	if (!lisible) {
		return NextResponse.json(
			{ ok: false, error: "not_found", message: "Ressource introuvable." },
			{ status: 404, headers: { "Cache-Control": "private, no-store" } }
		);
	}

	// L'origine réelle de la requête plutôt que la constante : le schéma servi
	// depuis une préproduction doit pointer cette préproduction, sinon le client
	// généré écrit en production.
	let origin = SITE_URL;
	try {
		origin = new URL(req.url).origin;
	} catch {
		// URL illisible (jamais en pratique) : la constante du site fait l'affaire.
	}
	return NextResponse.json(buildOpenApiDocument(origin), {
		headers: { "Cache-Control": "private, no-store" },
	});
}
