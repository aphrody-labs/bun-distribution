/**
 * /api/wiki/events — API publique de recherche et facettes des événements narratifs.
 *
 * Unifie les combats (db_battles), tournois (db_tournaments) et événements
 * chronologiques (db_timeline_events) sous un contrat d'architecture conforme à
 * la Phase 3 de docs/architecture-refonte-wiki-dragon-ball.md.
 *
 * Query params supportés :
 *   - q : terme de recherche (titre, titre japonais, participants, techniques)
 *   - type / kind : battle | tournament | timeline (répétable ou séparé par virgule)
 *   - canon : all | true | false | manga
 *   - series : DB | DBZ | DBS | DBGT | DB_DAIMA
 *   - sort : chronology | title
 *   - page : entier (défaut 1)
 *   - limit : entier (défaut 24, max 100)
 */
import { NextRequest, NextResponse } from "next/server";
import { dbUniverse } from "@/lib/db-universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS });
}

export interface NarrativeEventApiResponse {
	data: Array<{
		kind: "battle" | "tournament" | "timeline";
		id: number;
		slug: string;
		title: string;
		title_ja: string | null;
		series: string;
		timeline?: string;
		canon: boolean;
		href: string;
		summary?: string | null;
		participants?: string[];
		location?: string | null;
		orderRank?: number;
	}>;
	facets: {
		kinds: Record<string, number>;
		canon: { canon: number; non_canon: number };
		series: Record<string, number>;
		timelines: Record<string, number>;
	};
	page: number;
	limit: number;
	total: number;
	pageCount: number;
	canonicalUrl: string;
}

export async function GET(req: NextRequest) {
	const url = req.nextUrl;
	const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

	// Récupérer les types / kinds (supporte ?type=battle&type=tournament ou ?type=battle,tournament)
	const rawTypes = [
		...url.searchParams.getAll("type"),
		...url.searchParams.getAll("kind"),
	].flatMap((t) => t.split(",").map((s) => s.trim().toLowerCase())).filter(Boolean);
	const filterKinds = new Set(rawTypes);

	// Récupérer les timelines (ex: ?timeline=manga-canon&timeline=xenoverse)
	const rawTimelines = [
		...url.searchParams.getAll("timeline"),
	].flatMap((t) => t.split(",").map((s) => s.trim().toLowerCase())).filter(Boolean);
	const filterTimelines = new Set(rawTimelines);

	const rawCanon = (url.searchParams.get("canon") ?? "all").toLowerCase();
	const seriesFilter = (url.searchParams.get("series") ?? "").toUpperCase();
	const sort = (url.searchParams.get("sort") ?? "chronology").toLowerCase();

	const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
	const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "24", 10) || 24));

	const [battles, tournaments, timelineEvents] = await Promise.all([
		dbUniverse.battles().then((r) => r ?? []).catch(() => []),
		dbUniverse.tournaments().then((r) => r ?? []).catch(() => []),
		dbUniverse.timelineEvents().then((r) => r ?? []).catch(() => []),
	]);

	// Transformer en liste unifiée
	type UnifiedItem = NarrativeEventApiResponse["data"][number];
	const allItems: UnifiedItem[] = [];

	for (const b of battles) {
		const combatants = Array.isArray(b.combatants) ? b.combatants.map((c: any) => c?.name ?? String(c)) : [];
		const timeline = b.series?.includes("XV") ? "xenoverse" : b.canon ? "manga-canon" : "anime-toei";
		allItems.push({
			kind: "battle",
			id: b.id,
			slug: b.slug,
			title: b.title,
			title_ja: b.title_ja ?? null,
			series: b.series || "DBZ",
			timeline,
			canon: Boolean(b.canon),
			href: `/wiki/combats/${b.slug}`,
			summary: b.winner_name ? `Vainqueur : ${b.winner_name}` : null,
			participants: combatants,
			location: b.location ?? null,
			orderRank: b.manga_volume_start ? b.manga_volume_start * 1000 + (b.manga_chapter_start ?? 0) : 50000 + b.id,
		});
	}

	for (const t of tournaments) {
		const timeline = t.canon ? "manga-canon" : "anime-toei";
		allItems.push({
			kind: "tournament",
			id: t.id,
			slug: t.slug,
			title: t.name,
			title_ja: t.name_ja ?? null,
			series: t.saga?.includes("Super") ? "DBS" : t.saga?.includes("GT") ? "DBGT" : "DB",
			timeline,
			canon: Boolean(t.canon),
			href: `/wiki/tournois/${t.slug}`,
			summary: t.winner_name ? `Champion : ${t.winner_name}` : t.rules_summary,
			participants: [t.winner_name, t.runner_up_name].filter(Boolean) as string[],
			location: t.location ?? null,
			orderRank: 20000 + t.id,
		});
	}

	for (const e of timelineEvents) {
		const timeline = e.canon ? "manga-canon" : "anime-toei";
		allItems.push({
			kind: "timeline",
			id: e.id,
			slug: `age-${e.age_year}-${e.id}`,
			title: e.title,
			title_ja: e.title_ja ?? null,
			series: e.age_year >= 778 ? "DBS" : e.age_year >= 761 ? "DBZ" : "DB",
			timeline,
			canon: Boolean(e.canon),
			href: `/wiki/chronologie#age-${e.age_year}`,
			summary: e.description,
			participants: Array.isArray(e.characters_involved) ? e.characters_involved : [],
			location: null,
			orderRank: e.age_year,
		});
	}

	// Calcul des facettes avant filtrage restrictif de kind/canon/series/timeline
	const kindsFacet: Record<string, number> = { battle: 0, tournament: 0, timeline: 0 };
	const canonFacet = { canon: 0, non_canon: 0 };
	const seriesFacet: Record<string, number> = {};
	const timelinesFacet: Record<string, number> = {};

	for (const item of allItems) {
		kindsFacet[item.kind] = (kindsFacet[item.kind] ?? 0) + 1;
		if (item.canon) canonFacet.canon++;
		else canonFacet.non_canon++;
		if (item.series) seriesFacet[item.series] = (seriesFacet[item.series] ?? 0) + 1;
		if (item.timeline) timelinesFacet[item.timeline] = (timelinesFacet[item.timeline] ?? 0) + 1;
	}

	// Filtrage
	let filtered = allItems.filter((item) => {
		// Type filter
		if (filterKinds.size > 0 && !filterKinds.has(item.kind)) {
			// Autoriser alias 'war' ou 'event' vers 'timeline'
			if (!((filterKinds.has("war") || filterKinds.has("event")) && item.kind === "timeline")) {
				return false;
			}
		}

		// Timeline filter
		if (filterTimelines.size > 0) {
			const itemTl = item.timeline ?? "";
			const matches = filterTimelines.has(itemTl) ||
				(filterTimelines.has("manga") && itemTl === "manga-canon") ||
				(filterTimelines.has("anime") && itemTl === "anime-toei") ||
				(filterTimelines.has("movies") && itemTl === "movies-dbz");
			if (!matches) return false;
		}

		// Canon filter
		if (rawCanon === "true" || rawCanon === "canon" || rawCanon === "absolute" || rawCanon === "manga") {
			if (!item.canon) return false;
		} else if (rawCanon === "false" || rawCanon === "non_canon") {
			if (item.canon) return false;
		}

		// Series filter
		if (seriesFilter && item.series !== seriesFilter) {
			return false;
		}

		// Text search q
		if (q) {
			const inTitle = item.title.toLowerCase().includes(q);
			const inTitleJa = item.title_ja ? item.title_ja.toLowerCase().includes(q) : false;
			const inParticipants = item.participants?.some((p) => p.toLowerCase().includes(q)) ?? false;
			const inSummary = item.summary ? item.summary.toLowerCase().includes(q) : false;
			const inLocation = item.location ? item.location.toLowerCase().includes(q) : false;
			if (!inTitle && !inTitleJa && !inParticipants && !inSummary && !inLocation) {
				return false;
			}
		}

		return true;
	});

	// Tri
	if (sort === "title") {
		filtered.sort((a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }));
	} else {
		// Chronologie
		filtered.sort((a, b) => (a.orderRank ?? 0) - (b.orderRank ?? 0));
	}

	const total = filtered.length;
	const pageCount = Math.max(1, Math.ceil(total / limit));
	const startIndex = (page - 1) * limit;
	const paginatedData = filtered.slice(startIndex, startIndex + limit);

	const responsePayload: NarrativeEventApiResponse = {
		data: paginatedData,
		facets: {
			kinds: kindsFacet,
			canon: canonFacet,
			series: seriesFacet,
			timelines: timelinesFacet,
		},
		page,
		limit,
		total,
		pageCount,
		canonicalUrl: "/api/wiki/events",
	};

	return NextResponse.json(responsePayload, {
		status: 200,
		headers: {
			...CORS,
			"Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
		},
	});
}
