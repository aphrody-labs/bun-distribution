/**
 * /api/wiki/contributors — API publique des contributeurs et bâtisseurs de Dragon Ball.
 *
 * Expose les auteurs, éditeurs, scénaristes, animateurs, seiyū et compositeurs
 * depuis bot.contributors et bot.contributor_credits, conformément à la Phase 3
 * de docs/architecture-refonte-wiki-dragon-ball.md.
 *
 * Query params supportés :
 *   - q : terme de recherche (nom, kanji, romaji, biographie)
 *   - category : author | editorial_staff | scenario | animation | voice | music | publisher | other
 *   - spotlight : all | true | false
 *   - sort : spotlight | name
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

export interface ContributorApiResponse {
	data: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		name_romaji: string | null;
		category: string;
		spotlight_rank: number | null;
		birth_date: string | null;
		death_date: string | null;
		biography_fr: string | null;
		href: string;
	}>;
	facets: {
		categories: Record<string, number>;
		spotlight: { yes: number; no: number };
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

	const rawCategories = [
		...url.searchParams.getAll("category"),
	].flatMap((c) => c.split(",").map((s) => s.trim().toLowerCase())).filter(Boolean);
	const filterCategories = new Set(rawCategories);

	const rawSpotlight = (url.searchParams.get("spotlight") ?? "all").toLowerCase();
	const sort = (url.searchParams.get("sort") ?? "spotlight").toLowerCase();

	const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
	const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "24", 10) || 24));

	const rawContributors = await dbUniverse.contributors().catch(() => []);
	const allContributors = rawContributors ?? [];

	// Calcul des facettes avant filtrage restrictif
	const categoriesFacet: Record<string, number> = {};
	const spotlightFacet = { yes: 0, no: 0 };

	for (const c of allContributors) {
		categoriesFacet[c.category] = (categoriesFacet[c.category] ?? 0) + 1;
		if (c.spotlight_rank !== null) spotlightFacet.yes++;
		else spotlightFacet.no++;
	}

	// Filtrage
	let filtered = allContributors.filter((c) => {
		// Category filter
		if (filterCategories.size > 0 && !filterCategories.has(c.category)) {
			return false;
		}

		// Spotlight filter
		if (rawSpotlight === "true" || rawSpotlight === "1") {
			if (c.spotlight_rank === null) return false;
		} else if (rawSpotlight === "false" || rawSpotlight === "0") {
			if (c.spotlight_rank !== null) return false;
		}

		// Text search q
		if (q) {
			const inName = c.name.toLowerCase().includes(q);
			const inNameJa = c.name_ja ? c.name_ja.toLowerCase().includes(q) : false;
			const inNameRomaji = c.name_romaji ? c.name_romaji.toLowerCase().includes(q) : false;
			const inBio = c.biography_fr ? c.biography_fr.toLowerCase().includes(q) : false;
			if (!inName && !inNameJa && !inNameRomaji && !inBio) {
				return false;
			}
		}

		return true;
	});

	// Tri
	if (sort === "name") {
		filtered.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
	} else {
		// Tri par spotlightRank ascendant (0 = Toriyama en tête), puis nom
		filtered.sort((a, b) => {
			const rankA = a.spotlight_rank !== null ? a.spotlight_rank : 9999;
			const rankB = b.spotlight_rank !== null ? b.spotlight_rank : 9999;
			if (rankA !== rankB) return rankA - rankB;
			return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
		});
	}

	const total = filtered.length;
	const pageCount = Math.max(1, Math.ceil(total / limit));
	const startIndex = (page - 1) * limit;
	const paginatedData = filtered.slice(startIndex, startIndex + limit).map((c) => ({
		id: c.id,
		slug: c.slug,
		name: c.name,
		name_ja: c.name_ja,
		name_romaji: c.name_romaji,
		category: c.category,
		spotlight_rank: c.spotlight_rank,
		birth_date: c.birth_date,
		death_date: c.death_date,
		biography_fr: c.biography_fr,
		href: `/wiki/staff#${c.slug}`,
	}));

	const responsePayload: ContributorApiResponse = {
		data: paginatedData,
		facets: {
			categories: categoriesFacet,
			spotlight: spotlightFacet,
		},
		page,
		limit,
		total,
		pageCount,
		canonicalUrl: "/api/wiki/contributors",
	};

	return NextResponse.json(responsePayload, {
		status: 200,
		headers: {
			...CORS,
			"Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
		},
	});
}
