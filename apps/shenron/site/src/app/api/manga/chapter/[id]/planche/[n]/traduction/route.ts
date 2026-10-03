/**
 * GET /api/manga/chapter/:id/planche/:n/traduction — traductions FR publiées
 * d'une planche (bulles dans l'ordre de lecture, cadres optionnels).
 *
 * Résout `(chapitre, rang)` vers l'identifiant de page du bot, puis relaie
 * `GET {bot}/api/manga/planche/:pageId/traduction`. 404 quand rien n'est publié.
 */
import { NextResponse } from "next/server";
import { traductionPlanche } from "@/lib/manga-api";
import { CORS_MANGA } from "@/lib/manga-cors";

export const runtime = "nodejs";
export const revalidate = 300;

export function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS_MANGA });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
	const { id: idBrut, n: nBrut } = await ctx.params;
	const id = Number(idBrut);
	const n = Number(nBrut);
	if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(n) || n <= 0) {
		return NextResponse.json(
			{ error: "Adresse invalide : /api/manga/chapter/{id}/planche/{n}/traduction." },
			{ status: 400, headers: CORS_MANGA }
		);
	}

	const traduction = await traductionPlanche(id, n);
	if (!traduction) {
		return NextResponse.json(
			{ error: "Aucune traduction publiée pour cette planche." },
			{ status: 404, headers: CORS_MANGA }
		);
	}

	return NextResponse.json(traduction, {
		headers: { ...CORS_MANGA, "Cache-Control": "public, max-age=120, s-maxage=600" },
	});
}
