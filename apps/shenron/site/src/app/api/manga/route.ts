/**
 * GET /api/manga — la porte d'entrée du manga pour un agent ou un `curl`.
 *
 * Elle répond ce que le catalogue contient (tomes, chapitres, planches,
 * transcriptions) ET comment aller plus loin : chaque ressource est annoncée
 * avec son URL exacte, pas décrite en prose. C'est ce qui permet à un client qui
 * ne connaît rien du site de descendre jusqu'à une planche en trois appels.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { SITE_URL } from "@/lib/config";
import { CORS_MANGA } from "@/lib/manga-cors";

export const runtime = "nodejs";
export const revalidate = 3600;

export function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS_MANGA });
}

export async function GET() {
	let series: Array<{ series: string; tomes: number; chapitres: number; planches: number }> = [];
	let catalogue: Array<{
		id: number;
		series: string;
		numero: number | null;
		titre: string | null;
		titreJa: string | null;
		datePublication: number | null;
		isbn: string | null;
		couverture: string | null;
		url: string;
		lectureDisponibleIci: boolean;
	}> = [];
	let transcrites = 0;
	try {
		const rows = await db.execute<{
			series: string;
			chapitres: number;
			planches: number;
		}>(sql`
			SELECT series,
			       count(*)::int AS chapitres,
			       coalesce(sum(CASE WHEN jsonb_typeof(pages) = 'array'
			                         THEN jsonb_array_length(pages) ELSE 0 END), 0)::int AS planches
			FROM bot.db_manga_chapters
			WHERE visible IS NOT false
			GROUP BY series ORDER BY series
		`);
		const tomes = await db.execute<{ series: string; tomes: number }>(sql`
			SELECT series, count(*)::int AS tomes FROM bot.db_manga_volumes
			WHERE visible IS NOT false GROUP BY series
		`);
		const parSerie = new Map(tomes.map((t) => [t.series, Number(t.tomes)]));
		series = rows.map((r) => ({
			series: r.series,
			tomes: parSerie.get(r.series) ?? 0,
			chapitres: Number(r.chapitres),
			planches: Number(r.planches),
		}));
		const catalogueRows = await db.execute<{
			id: number;
			series: string;
			volume_number: number | null;
			title: string | null;
			title_ja: string | null;
			published_at: number | null;
			isbn: string | null;
			cover: string | null;
			readable_here: boolean;
		}>(sql`
			SELECT
				v.id, v.series, v.volume_number, v.title, v.title_ja,
				v.published_at, v.isbn, v.cover,
				EXISTS (
					SELECT 1
					FROM bot.db_manga_chapters c
					WHERE c.volume_id = v.id
						AND c.visible IS NOT FALSE
						AND jsonb_typeof(c.pages) = 'array'
						AND jsonb_array_length(c.pages) > 0
				) AS readable_here
			FROM bot.db_manga_volumes v
			WHERE v.visible IS NOT FALSE
			ORDER BY v.series, v.volume_number NULLS LAST, v.id
		`);
		catalogue = catalogueRows.map((volume) => ({
			id: Number(volume.id),
			series: volume.series,
			numero: volume.volume_number == null ? null : Number(volume.volume_number),
			titre: volume.title,
			titreJa: volume.title_ja,
			datePublication: volume.published_at == null ? null : Number(volume.published_at),
			isbn: volume.isbn,
			couverture: volume.cover,
			url: `${SITE_URL}/api/manga/volume/${volume.id}`,
			lectureDisponibleIci: Boolean(volume.readable_here),
		}));
		const ocr = await db.execute<{ n: number }>(sql`
			SELECT count(*)::int AS n FROM bot.db_manga_pages
			WHERE nullif(btrim(text), '') IS NOT NULL
		`);
		transcrites = Number(ocr[0]?.n ?? 0);
	} catch (e) {
		console.error("[api/manga] index indisponible:", e);
	}

	return NextResponse.json(
		{
			nom: "Manga Dragon Ball — API de lecture",
			description:
				"Tomes, chapitres et planches du manga. Chaque planche est une ressource : " +
				"son image, sa transcription, et l'URL de la page de lecture correspondante.",
			licence:
				"Catalogue, couvertures et ressources de lecture. Les droits et les statuts de publication restent attachés à chaque source.",
			series,
			catalogue,
			planchesTranscrites: transcrites,
			routes: {
				tome: `${SITE_URL}/api/manga/volume/{id}`,
				chapitre: `${SITE_URL}/api/manga/chapter/{id}`,
				planche: `${SITE_URL}/api/manga/chapter/{id}/planche/{n}`,
				plancheImage: `${SITE_URL}/api/manga/chapter/{id}/planche/{n}?format=image`,
				plancheTexte: `${SITE_URL}/api/manga/chapter/{id}/planche/{n}?format=text`,
				recherche: `${SITE_URL}/api/manga/search?q={texte}`,
				chronologie: `${SITE_URL}/api/chronologie`,
				tomesLisibles: `${SITE_URL}/wiki/manga`,
			},
			exemples: [
				`curl ${SITE_URL}/api/manga/search?q=kamehameha`,
				`curl ${SITE_URL}/api/manga/chapter/1421`,
				`curl ${SITE_URL}/api/manga/chapter/1421/planche/12`,
				`curl -L -o planche.webp "${SITE_URL}/api/manga/chapter/1421/planche/12?format=image"`,
			],
			// Pas de champ `mcp` : `mcp.dragonballfr.com` a été retiré le 2026-09-25
			// (shenron-mcp fusionné dans les outils `aphrody-mcp` dragonball.*, qui ne
			// sont pas exposés en HTTP public — cf. yolo
			// config/host/nginx/routes.json et config/service-catalog.json). Republier
			// cette URL la ferait 404 pour quiconque l'appelle depuis cette réponse.
		},
		{ headers: { ...CORS_MANGA, "Cache-Control": "public, max-age=300, s-maxage=3600" } }
	);
}
