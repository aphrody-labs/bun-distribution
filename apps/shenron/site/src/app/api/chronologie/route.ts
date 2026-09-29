/**
 * GET /api/chronologie — la frise officielle, telle qu'elle est publiée.
 *
 * La chronologie est une DÉCISION éditoriale (curation admin appliquée par
 * `applyChronology`), pas un tri que l'on peut refaire chez soi : un agent qui
 * reconstruisait « l'ordre » à partir des dates de diffusion se trompait
 * systématiquement sur les films et sur GT. On rend donc l'ordre résolu,
 * numéroté, avec pour chaque entrée son URL de page — et, pour les tomes, son
 * API de lecture planche par planche.
 *
 * `?era=` filtre une ère (`DB`, `DBZ`, `GT`, `Super`, `Daima`, `Manga`),
 * `?kind=` une nature (`episode`, `movie`, `manga`).
 */
import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/config";
import { dbUniverse } from "@/lib/db-universe";
import { getChronologyConfig } from "@/lib/chronology-config";
import { applyChronology, ERA_LABELS, type Era, type TimelineKind } from "@/lib/chronology";
import { CORS_MANGA } from "@/lib/manga-cors";

export const runtime = "nodejs";
export const revalidate = 300;

export function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS_MANGA });
}

export async function GET(req: Request) {
	const params = new URL(req.url).searchParams;
	const era = params.get("era");
	const kind = params.get("kind") as TimelineKind | null;

	const [raw, config] = await Promise.all([dbUniverse.timeline(), getChronologyConfig()]);
	if (!raw || raw.length === 0) {
		return NextResponse.json(
			{ error: "Chronologie momentanément indisponible." },
			{ status: 503, headers: CORS_MANGA }
		);
	}

	const ordonnee = applyChronology(raw, config);
	const entrees = ordonnee
		// Le rang est calculé AVANT filtrage : « 412ᵉ de la frise » doit rester
		// la même position qu'on demande l'ère Super seule ou la frise entière.
		.map((it, i) => ({
			rang: i + 1,
			kind: it.kind,
			id: it.id,
			titre: it.title,
			titreJa: it.titleJa,
			serie: it.series,
			ere: it.era,
			ereLabel: ERA_LABELS[it.era as Era] ?? it.era,
			numero: it.number,
			date: it.date ? new Date(it.date * 1000).toISOString().slice(0, 10) : null,
			href: `${SITE_URL}${it.href}`,
			api:
				it.kind === "manga"
					? `${SITE_URL}/api/manga/volume/${it.id}`
					: it.kind === "episode"
						? `${SITE_URL}/api/episodes/${it.id}`
						: `${SITE_URL}/api/movies/${it.id}`,
		}))
		.filter((e) => (era ? e.ere.toLowerCase() === era.toLowerCase() : true))
		.filter((e) => (kind ? e.kind === kind : true));

	return NextResponse.json(
		{
			source: `${SITE_URL}/wiki/chronologie`,
			note: "Ordre éditorial officiel de dragonballfr.com (curation humaine appliquée). Ne pas le recalculer à partir des dates.",
			total: entrees.length,
			totalFrise: ordonnee.length,
			entrees,
		},
		{ headers: { ...CORS_MANGA, "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400" } }
	);
}
