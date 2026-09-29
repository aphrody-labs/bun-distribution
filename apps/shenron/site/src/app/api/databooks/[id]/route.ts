/**
 * API Databooks — fiche unique.
 *
 *   GET    /api/databooks/:id
 *   PATCH  /api/databooks/:id   (jeton porteur requis)
 *   DELETE /api/databooks/:id   (jeton porteur requis)
 *
 * Mêmes règles que la collection : lecture publique des fiches publiées,
 * écriture réservée au porteur du jeton. `PATCH` est un patch partiel — une clé
 * absente n'est pas touchée, `null` efface.
 */
import { NextResponse } from "next/server";
import { hasValidApiToken } from "@/lib/admin-guard";
import { deleteDatabook, getDatabook, updateDatabook, type DatabookWrite } from "@/lib/databooks";
import { parseDatabookId } from "@/lib/databooks-rules";

export const dynamic = "force-dynamic";

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS });
}

const introuvable = () =>
	NextResponse.json({ error: "Fiche introuvable." }, { status: 404, headers: CORS });

const nonAutorise = () =>
	NextResponse.json(
		{ error: "Jeton porteur requis." },
		{ status: 401, headers: { ...CORS, "WWW-Authenticate": "Bearer" } }
	);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
	const id = parseDatabookId((await ctx.params).id);
	if (id === null) return introuvable();
	try {
		const rec = await getDatabook(id);
		// Une fiche masquée n'existe pas pour un appel non authentifié.
		if (!rec || (!rec.visible && !hasValidApiToken(req))) return introuvable();
		return NextResponse.json(rec, {
			headers: {
				...CORS,
				// Une fiche masquée n'est servie qu'au porteur du jeton : elle ne doit
				// jamais atterrir dans un cache partagé, d'où elle repartirait vers un
				// appelant sans jeton.
				"Cache-Control": rec.visible ? "public, max-age=60, s-maxage=300" : "private, no-store",
				Vary: "Authorization",
			},
		});
	} catch (e) {
		console.error("[api/databooks/:id] GET a échoué:", e);
		return NextResponse.json({ error: "Lecture impossible." }, { status: 500, headers: CORS });
	}
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
	if (!hasValidApiToken(req)) return nonAutorise();
	const id = parseDatabookId((await ctx.params).id);
	if (id === null) return introuvable();
	let corps: DatabookWrite;
	try {
		corps = (await req.json()) as DatabookWrite;
	} catch {
		return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400, headers: CORS });
	}
	try {
		const rec = await updateDatabook(id, corps);
		return rec ? NextResponse.json(rec, { headers: CORS }) : introuvable();
	} catch (e) {
		console.error("[api/databooks/:id] PATCH a échoué:", e);
		return NextResponse.json({ error: "Mise à jour impossible." }, { status: 500, headers: CORS });
	}
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
	if (!hasValidApiToken(req)) return nonAutorise();
	const id = parseDatabookId((await ctx.params).id);
	if (id === null) return introuvable();
	try {
		return (await deleteDatabook(id))
			? new NextResponse(null, { status: 204, headers: CORS })
			: introuvable();
	} catch (e) {
		console.error("[api/databooks/:id] DELETE a échoué:", e);
		return NextResponse.json({ error: "Suppression impossible." }, { status: 500, headers: CORS });
	}
}
