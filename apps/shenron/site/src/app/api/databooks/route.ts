/**
 * API Databooks — collection.
 *
 *   GET  /api/databooks?q=&kind=&category=&limit=&offset=&order=
 *   POST /api/databooks                       (jeton porteur requis)
 *
 * **Lecture publique, écriture authentifiée.** La rubrique `/wiki/databooks` est
 * fermée au public par le gating, mais l'API de lecture reste ouverte : elle sert
 * les outils externes (indexation, assistants) et n'expose que des fiches
 * `visible = true`. Les fiches masquées ne sortent QUE pour un appel porteur d'un
 * jeton valide (`includeHidden=1`).
 *
 * L'écriture exige `Authorization: Bearer <DATABOOKS_API_TOKEN>` (repli sur
 * `SHENRON_ADMIN_TOKEN`) — jamais de session par cookie, pour ne pas exposer ces
 * routes à une écriture déclenchée depuis un onglet du navigateur (CSRF).
 */
import { NextResponse } from "next/server";
import { hasValidApiToken } from "@/lib/admin-guard";
import {
	DATABOOK_LIMIT_MAX,
	createDatabook,
	listDatabooks,
	type DatabookQuery,
	type DatabookWrite,
} from "@/lib/databooks";

/** Écriture + `includeHidden` dépendent d'un en-tête : jamais mis en cache. */
export const dynamic = "force-dynamic";

const CORS = {
	// Lecture ouverte à tout outil externe. L'écriture est protégée par le jeton,
	// pas par l'origine : un `Access-Control-Allow-Origin` large ne l'affaiblit pas.
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS });
}

function entier(v: string | null, defaut?: number): number | undefined {
	if (v === null) return defaut;
	const n = Number(v);
	return Number.isFinite(n) ? Math.trunc(n) : defaut;
}

export async function GET(req: Request) {
	const url = new URL(req.url);
	const autorise = hasValidApiToken(req);
	const q: DatabookQuery = {
		q: url.searchParams.get("q") ?? undefined,
		kind: url.searchParams.get("kind") ?? undefined,
		category: url.searchParams.get("category") ?? undefined,
		order: url.searchParams.get("order") === "asc" ? "asc" : "desc",
		limit: entier(url.searchParams.get("limit")),
		offset: entier(url.searchParams.get("offset")),
		// Une fiche masquée n'est jamais servie sans jeton, quoi qu'on demande.
		includeHidden: autorise && url.searchParams.get("includeHidden") === "1",
	};
	try {
		const r = await listDatabooks(q);
		return NextResponse.json(
			{ ...r, limitMax: DATABOOK_LIMIT_MAX },
			{
				headers: {
					...CORS,
					// Une réponse qui inclut des fiches masquées dépend du jeton de
					// l'appelant : mise en cache partagée, elle les servirait ensuite à
					// n'importe qui. Même raison pour `Vary` sur la réponse publique.
					"Cache-Control": q.includeHidden
						? "private, no-store"
						: "public, max-age=60, s-maxage=300",
					Vary: "Authorization",
				},
			}
		);
	} catch (e) {
		console.error("[api/databooks] GET a échoué:", e);
		return NextResponse.json({ error: "Lecture impossible." }, { status: 500, headers: CORS });
	}
}

export async function POST(req: Request) {
	if (!hasValidApiToken(req)) {
		return NextResponse.json(
			{ error: "Jeton porteur requis." },
			{ status: 401, headers: { ...CORS, "WWW-Authenticate": "Bearer" } }
		);
	}
	let corps: DatabookWrite;
	try {
		corps = (await req.json()) as DatabookWrite;
	} catch {
		return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400, headers: CORS });
	}
	try {
		const rec = await createDatabook(corps);
		return NextResponse.json(rec, { status: 201, headers: CORS });
	} catch (e) {
		const message = e instanceof Error ? e.message : "Création impossible.";
		// Un message d'erreur de contrainte Postgres nomme la table et la colonne :
		// on ne le renvoie que pour les validations que l'on formule nous-mêmes.
		const attendu = message.includes("`title` est requis");
		if (!attendu) console.error("[api/databooks] POST a échoué:", e);
		return NextResponse.json(
			{ error: attendu ? message : "Création impossible." },
			{ status: attendu ? 400 : 500, headers: CORS }
		);
	}
}
