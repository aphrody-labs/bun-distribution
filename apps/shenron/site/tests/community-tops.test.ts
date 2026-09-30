/**
 * Top 3 communautaires — helpers bayésiens + catalogue + smoke source.
 */
import { describe, expect, test } from "bun:test";
import {
	COMMUNITY_TOP_BOARDS,
	COMMUNITY_TOP_LIMIT,
	bayesianScore,
	boardById,
} from "../src/lib/community-tops";

describe("community tops catalog", () => {
	test("9 boards (DB + DBZ + DBS + GT + Daima + Kai + arcs + jeux + films)", () => {
		expect(COMMUNITY_TOP_BOARDS).toHaveLength(9);
		const ids = COMMUNITY_TOP_BOARDS.map((b) => b.id);
		expect(ids).toEqual([
			"episodes-db",
			"episodes-dbz",
			"episodes-dbs",
			"episodes-gt",
			"episodes-daima",
			"episodes-kai",
			"arcs",
			"games",
			"movies",
		]);
	});

	test("DB classique + arcs présents", () => {
		expect(boardById("episodes-db")?.series).toEqual(["DB"]);
		expect(boardById("arcs")?.kind).toBe("arc");
	});

	test("Kai regroupe DBZ_KAI + FINAL", () => {
		const kai = boardById("episodes-kai");
		expect(kai?.series).toEqual(["DBZ_KAI", "DBZ_KAI_FINAL"]);
	});

	test("plafond top 3", () => {
		expect(COMMUNITY_TOP_LIMIT).toBe(3);
	});
});

describe("bayesianScore", () => {
	test("sans votes → 0", () => {
		expect(bayesianScore(5, 0)).toBe(0);
	});

	test("beaucoup de votes → proche de la moyenne brute", () => {
		const s = bayesianScore(5, 100);
		expect(s).toBeGreaterThan(4.9);
		expect(s).toBeLessThanOrEqual(5);
	});

	test("un seul 5★ est moins fort que dix 4.5★", () => {
		const oneFive = bayesianScore(5, 1);
		const manyHigh = bayesianScore(4.5, 10);
		expect(manyHigh).toBeGreaterThan(oneFive);
	});
});

describe("source features", () => {
	test("CommunityTops exporté + page classements", async () => {
		const ui = await Bun.file(
			new URL("../src/components/ratings/CommunityTops.tsx", import.meta.url)
		).text();
		expect(ui).toContain("CommunityTops");
		expect(ui).toContain("CommunityTopsFull");
		expect(ui).toContain("PODIUM_ORDER");

		const page = await Bun.file(new URL("../src/app/classements/page.tsx", import.meta.url)).text();
		expect(page).toContain("getCommunityTops");
		expect(page).toContain("CommunityTopsFull");
	});

	test("home section tops branchée", async () => {
		const home = await Bun.file(
			new URL("../src/components/home/HomeExperience.tsx", import.meta.url)
		).text();
		expect(home).toContain('case "tops"');
		expect(home).toContain("communityTops");

		const scenes = await Bun.file(new URL("../src/lib/home-scenes.ts", import.meta.url)).text();
		expect(scenes).toContain('"tops"');
		expect(scenes).toContain("Les Top 3 de la communauté");
	});
});

const dbUrl = process.env.DATABASE_URL?.trim();

describe.skipIf(!dbUrl)("intégration community tops (SQL)", () => {
	test("notes agrégées par type existent et max 3 par série DBZ", async () => {
		const postgres = (await import("postgres")).default;
		const client = postgres(dbUrl!, { max: 1 });
		try {
			const types = await client<{ targetType: string; n: string }[]>`
				SELECT "targetType", count(*)::text AS n
				FROM site_ratings
				GROUP BY 1
			`;
			expect(Array.isArray(types)).toBe(true);

			// Top 3 DBZ via join ratings × episodes (miroir de la query data-layer)
			const top = await client<{ id: number; avg: string; n: string }[]>`
				SELECT e.id, avg(r.score)::text AS avg, count(*)::text AS n
				FROM site_ratings r
				JOIN bot.db_episodes e ON e.id::text = r."targetId"
				WHERE r."targetType" = 'episode' AND e.series = 'DBZ'
				GROUP BY e.id
				ORDER BY avg(r.score) DESC, count(*) DESC
				LIMIT 3
			`;
			expect(top.length).toBeLessThanOrEqual(3);
		} finally {
			await client.end({ timeout: 5 });
		}
	});
});
