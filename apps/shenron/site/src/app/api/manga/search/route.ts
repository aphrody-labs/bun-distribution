/**
 * GET /api/manga/search?q=…&limit=… — chercher une réplique, obtenir des PLANCHES.
 *
 * La recherche de dialogues existait déjà côté bot, mais elle répondait en
 * coordonnées internes `(series, tome, planche)` qui ne mènent nulle part. Ici
 * chaque résultat porte l'URL de la page de lecture ET celle de la planche en
 * JSON : on passe d'une réponse à vérifier à la main à une réponse citable.
 */
import { NextResponse } from "next/server";
import { chercherPlanches } from "@/lib/manga-api";
import { CORS_MANGA } from "@/lib/manga-cors";

export const runtime = "nodejs";
export const revalidate = 300;

export function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS_MANGA });
}

export async function GET(req: Request) {
	const params = new URL(req.url).searchParams;
	const q = (params.get("q") ?? "").trim();
	if (q.length < 2) {
		return NextResponse.json(
			{ error: "Paramètre `q` requis (2 caractères minimum).", exemple: "?q=kamehameha" },
			{ status: 400, headers: CORS_MANGA }
		);
	}
	const limitRaw = params.get("limit");
	const limit = limitRaw !== null ? Number(limitRaw) : 20;
	const offsetRaw = params.get("offset");
	const offset = offsetRaw !== null ? Number(offsetRaw) : undefined;
	const pageRaw = params.get("page");
	const page = pageRaw !== null ? Number(pageRaw) : undefined;
	const series = params.get("series") ?? undefined;
	const tome = params.get("tome") ?? undefined;
	const surligner = params.get("surligner") === "true" || params.get("highlight") === "true";

	try {
		const resultats = await chercherPlanches(q, {
			limit: Number.isFinite(limit) ? limit : 20,
			offset: Number.isFinite(offset) ? offset : undefined,
			page: Number.isFinite(page) ? page : undefined,
			series,
			tome,
			surligner,
		});
		return NextResponse.json(
			{ q, count: resultats.length, resultats },
			{ headers: { ...CORS_MANGA, "Cache-Control": "public, max-age=60, s-maxage=600" } }
		);
	} catch (e) {
		console.error("[api/manga/search] échec:", e);
		return NextResponse.json(
			{ error: "Recherche indisponible." },
			{ status: 500, headers: CORS_MANGA }
		);
	}
}
