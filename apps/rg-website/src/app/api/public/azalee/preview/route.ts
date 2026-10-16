import { NextResponse } from "next/server";
import { getInaglePgPool } from "@rosegriffon/db/pg";

export const dynamic = "force-dynamic";

export interface PreviewCharacter {
	id: string;
	slug?: string | null;
	base_slug?: string | null;
	name_fr: string;
	name_en: string;
	name_ja: string | null;
	element: string;
	position: string;
	rarity: string | number;
	internal_code: string;
}

export interface PreviewSkill {
	id: string;
	name_fr: string;
	name_en: string;
	name_ja: string | null;
	category: string;
	element: string;
	power_max: number | null;
	tension_cost: number | null;
	image_url: string | null;
}

export interface PreviewItem {
	id: string;
	name_fr: string;
	name_en: string;
	category: string;
	rarity: number | null;
	internal_code: string;
	stat_boost_1: string | null;
	stat_boost_2: string | null;
}

export interface PreviewTeam {
	id: string;
	name_fr: string;
	name_en: string;
	name_ja: string | null;
	emblem_url: string | null;
}

export interface AzaleePreviewData {
	characters: PreviewCharacter[];
	skills: PreviewSkill[];
	items: PreviewItem[];
	teams: PreviewTeam[];
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const type = searchParams.get("type"); // "characters" | "skills" | "items" | "teams" | null

	try {
		const pool = getInaglePgPool();

		// Requêtes parallèles directes en base
		const [charactersRes, skillsRes, itemsRes, teamsRes] = await Promise.all([
			pool.query<PreviewCharacter>(
				`SELECT id, slug, base_slug, name_fr, name_en, name_ja, element, position, rarity, internal_code
				 FROM inagle_characters
				 WHERE is_primary = true
				   AND internal_code IN ('c01000010', 'c05024710', 'c01010970', 'c01000020')
				 ORDER BY CASE internal_code
				   WHEN 'c01000010' THEN 1
				   WHEN 'c05024710' THEN 2
				   WHEN 'c01010970' THEN 3
				   WHEN 'c01000020' THEN 4
				   ELSE 5 END`,
			),
			pool.query<PreviewSkill>(
				`SELECT id, name_fr, name_en, name_ja, category, element, power_max, tension_cost, image_url
				 FROM inagle_skills
				 WHERE id IN ('whs02160_or', 'whk00010', 'whd01400', 'who01352')
				 ORDER BY CASE id
				   WHEN 'whs02160_or' THEN 1
				   WHEN 'whk00010' THEN 2
				   WHEN 'who01352' THEN 3
				   WHEN 'whd01400' THEN 4
				   ELSE 5 END`,
			),
			pool.query<PreviewItem>(
				`SELECT id, name_fr, name_en, category, rarity, internal_code, stat_boost_1, stat_boost_2
				 FROM inagle_items
				 WHERE internal_code IN ('eq_sh010101', 'eq_sh010201', 'eq_sh021201', 'eq_sh080101')
				 ORDER BY CASE internal_code
				   WHEN 'eq_sh010101' THEN 1
				   WHEN 'eq_sh010201' THEN 2
				   WHEN 'eq_sh021201' THEN 3
				   WHEN 'eq_sh080101' THEN 4
				   ELSE 5 END`,
			),
			pool.query<PreviewTeam>(
				`SELECT id, name_fr, name_en, name_ja, emblem_url
				 FROM inagle_teams
				 WHERE name_fr IN ('Raimon', 'Royal Academy', 'Nouvelle Royal Ac.', 'Inazuma KFT')
				 ORDER BY CASE name_fr
				   WHEN 'Raimon' THEN 1
				   WHEN 'Royal Academy' THEN 2
				   WHEN 'Nouvelle Royal Ac.' THEN 3
				   WHEN 'Inazuma KFT' THEN 4
				   ELSE 5 END`,
			),
		]);

		const result: AzaleePreviewData = {
			characters: charactersRes.rows,
			items: itemsRes.rows,
			skills: skillsRes.rows,
			teams: teamsRes.rows,
		};

		if (type && type in result) {
			return NextResponse.json(
				{ [type]: result[type as keyof AzaleePreviewData] },
				{
					headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
				},
			);
		}

		return NextResponse.json(result, {
			headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
		});
	} catch (error) {
		console.error("Erreur API azalee/preview:", error);
		return NextResponse.json(
			{
				characters: [],
				items: [],
				skills: [],
				teams: [],
				source: "offline-fallback",
			},
			{ status: 200 },
		);
	}
}
