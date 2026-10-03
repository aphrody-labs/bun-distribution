/**
 * Tests unitaires + intégration légère des features databooks / jeux médias.
 * - Helpers client-safe (catégories, YouTube, plafond pages)
 * - PostgreSQL Shenron réel (lecture seule, RAG préchargé obligatoire) : colonnes + données seed.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { loadLiveRagEnv, requireLiveRag } from "@shenron/pipeline/testing/live-rag";
import {
	DATABOOK_CATEGORIES,
	kindFromCategory,
	resolveDatabookCategory,
} from "../src/lib/databook-categories";
import { extractYoutubeId, youtubeEmbedUrl, youtubeThumbUrl } from "../src/lib/youtube";

describe("databook categories", () => {
	test("liste canonique unifiée (types + éditoriales)", () => {
		expect([...DATABOOK_CATEGORIES]).toEqual([
			"Databook",
			"Interview",
			"Art Book",
			"Saikyō Jump",
			"V-Jump",
			"Weekly Shonen Jump",
			"Pamphlet & Fair",
			"Autre",
		]);
		expect(DATABOOK_CATEGORIES).toHaveLength(8);
	});

	test("resolve null / vide → Autre", () => {
		expect(resolveDatabookCategory(null)).toBe("Autre");
		expect(resolveDatabookCategory(undefined)).toBe("Autre");
		expect(resolveDatabookCategory("")).toBe("Autre");
		expect(resolveDatabookCategory("   ")).toBe("Autre");
	});

	test("resolve valeurs connues", () => {
		for (const c of DATABOOK_CATEGORIES) {
			expect(resolveDatabookCategory(c)).toBe(c);
		}
	});

	test("resolve valeur inconnue → Autre", () => {
		expect(resolveDatabookCategory("Daizenshuu")).toBe("Autre");
		expect(resolveDatabookCategory("v-jump")).toBe("Autre"); // case-sensitive
	});

	test("kindFromCategory dérive la colonne technique", () => {
		expect(kindFromCategory("Interview")).toBe("interview");
		expect(kindFromCategory("Art Book")).toBe("artbook");
		expect(kindFromCategory("Saikyō Jump")).toBe("guidebook");
		expect(kindFromCategory("Databook")).toBe("databook");
		expect(kindFromCategory("V-Jump")).toBe("databook");
		expect(kindFromCategory("Autre")).toBe("databook");
		expect(kindFromCategory(null)).toBe("databook");
	});
});

describe("youtube helpers", () => {
	test("extrait id depuis watch?v=", () => {
		expect(extractYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
	});

	test("extrait id depuis youtu.be", () => {
		expect(extractYoutubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
	});

	test("extrait id depuis embed / shorts", () => {
		expect(extractYoutubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
		expect(extractYoutubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
	});

	test("id brut 11 chars", () => {
		expect(extractYoutubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
	});

	test("URL invalide → null", () => {
		expect(extractYoutubeId("")).toBeNull();
		expect(extractYoutubeId("https://example.com/watch?v=abc")).toBeNull();
		expect(extractYoutubeId("not-a-url")).toBeNull();
	});

	test("embed + thumb", () => {
		expect(youtubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
			"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
		);
		expect(youtubeThumbUrl("dQw4w9WgXcQ")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
		expect(youtubeEmbedUrl("bad")).toBeNull();
	});
});

describe("databook page limit", () => {
	/** Miroir de la règle resizeTo du panneau admin (plafond 400). */
	function clampPageCount(n: number): number {
		return Math.max(0, Math.min(400, Math.floor(n)));
	}

	test("plafond 400 (ex-200) — databooks 360+ pages", () => {
		expect(clampPageCount(200)).toBe(200);
		expect(clampPageCount(360)).toBe(360);
		expect(clampPageCount(400)).toBe(400);
		expect(clampPageCount(401)).toBe(400);
		expect(clampPageCount(999)).toBe(400);
		expect(clampPageCount(-5)).toBe(0);
	});

	test("source admin contient max 400 (pas 200)", async () => {
		const src = await Bun.file(
			new URL("../src/components/admin/DatabookPagesPanel.tsx", import.meta.url)
		).text();
		expect(src).toContain("Math.min(400");
		expect(src).toContain("max={400}");
		expect(src).not.toContain("Math.min(200");
		expect(src).not.toMatch(/max=\{200\}/);
	});
});

describe("source features shipped", () => {
	test("DatabookReader : layout côte-à-côte + lightbox + zoom", async () => {
		let src = await Bun.file(
			new URL("../src/components/databooks/DatabookReader.tsx", import.meta.url)
		).text();
		if (src.includes("@shenron/ui/reader")) {
			src = await Bun.file(
				new URL("../../../../packages/shenron/ui/src/reader/DatabookReader.tsx", import.meta.url)
			).text();
		}
		expect(src).toContain("lightbox");
		expect(src).toContain("cursor-zoom-in");
		expect(src).toContain("lg:flex-row");
		expect(src).toContain("Agrandir");
	});

	// `WikiAdminBar` n'est plus qu'un alias déprécié : les 9 fiches détail
	// portent `WikiEditBar`, qui ajoute le bouton public « Proposer une
	// correction » à côté des actions d'administration. Le test vérifie donc
	// qu'UNE barre d'édition est câblée sur la bonne table, sans exiger le nom
	// d'hier.
	test("fiche databook : barre d'édition câblée", async () => {
		const src = await Bun.file(
			new URL("../src/app/wiki/databooks/[id]/page.tsx", import.meta.url)
		).text();
		expect(src).toMatch(/Wiki(Edit|Admin)Bar/);
		expect(src).toContain('table="db_databooks"');
	});

	test("fiche jeu : galerie + barre d'édition", async () => {
		const src = await Bun.file(
			new URL("../src/app/wiki/jeux/[slug]/page.tsx", import.meta.url)
		).text();
		expect(src).toContain("GameMediaGallery");
		expect(src).toMatch(/Wiki(Edit|Admin)Bar/);
		expect(src).toContain("g.media");
	});

	test("grille : filtres unifiés (une seule liste de catégories)", async () => {
		const src = await Bun.file(
			new URL("../src/components/databooks/DatabookGrid.tsx", import.meta.url)
		).text();
		expect(src).toContain("DATABOOK_CATEGORIES");
		expect(src).toContain("FILTER_TABS");
		// Plus de 2e rangée de chips secondaires ni dualité kind/category
		expect(src).not.toContain("Toutes catégories");
		expect(src).not.toContain('mode: "kind"');
		// Types d'ouvrage dans les icônes de filtre
		expect(src).toContain('"Art Book"');
		expect(src).toContain("Saikyō Jump");
		expect(src).toContain('mode: "category"');
	});

	test("grille : le filtre de complétude remet la pagination à la première page", async () => {
		const src = await Bun.file(
			new URL("../src/components/databooks/DatabookGrid.tsx", import.meta.url)
		).text();
		expect(src).toContain("useEffect(() => setPage(1), [filter, contentFilter, q, order])");
	});

	test("fiche : les scans publics comptent comme pages publiques", async () => {
		const src = await Bun.file(
			new URL("../src/app/wiki/databooks/[id]/page.tsx", import.meta.url)
		).text();
		expect(src).toContain("Boolean(publicDatabookImage(p.image)) || Boolean(p.text?.trim())");
		expect(src).not.toContain("const blockedScanReferences = 0");
	});
});

describe("intégration Postgres (Shenron configuré, RAG préchargé)", () => {
	let dbUrl = "";
	beforeAll(async () => {
		loadLiveRagEnv();
		await requireLiveRag();
		dbUrl = process.env.DATABASE_URL?.trim() ?? "";
		if (!dbUrl) throw new Error("DATABASE_URL absent après loadLiveRagEnv");
	}, 120_000);
	async function sql<T = Record<string, unknown>>(q: string): Promise<T[]> {
		const postgres = (await import("postgres")).default;
		const client = postgres(dbUrl, { max: 1 });
		try {
			return (await client.unsafe(q)) as T[];
		} finally {
			await client.end({ timeout: 5 });
		}
	}

	test("colonne bot.db_databooks.category existe", async () => {
		const rows = await sql<{ column_name: string }>(`
			SELECT column_name FROM information_schema.columns
			WHERE table_schema = 'bot' AND table_name = 'db_databooks' AND column_name = 'category'
		`);
		expect(rows.length).toBe(1);
	});

	test("colonne bot.db_games.media existe", async () => {
		const rows = await sql<{ column_name: string }>(`
			SELECT column_name FROM information_schema.columns
			WHERE table_schema = 'bot' AND table_name = 'db_games' AND column_name = 'media'
		`);
		expect(rows.length).toBe(1);
	});

	test("toutes les catégories canoniques sont assignables (au moins Autre peuplé)", async () => {
		const rows = await sql<{ category: string; n: string }>(`
			SELECT COALESCE(category, 'Autre') AS category, count(*)::text AS n
			FROM bot.db_databooks WHERE visible IS DISTINCT FROM false GROUP BY 1
		`);
		const map = Object.fromEntries(rows.map((r) => [r.category, Number(r.n)]));
		expect(map["Autre"] ?? 0).toBeGreaterThan(0);
		// Au moins 3 catégories distinctes peuplées après seed heuristique
		expect(Object.keys(map).length).toBeGreaterThanOrEqual(3);
		for (const cat of Object.keys(map)) {
			// Compatibilité pendant le déploiement : les deux catégories sont
			// converties par la migration 0017 puis masquées.
			expect([...DATABOOK_CATEGORIES, "Light Novel", "Jump Anime Comics"]).toContain(cat);
		}
	});

	test("jeux phares ont une galerie media non vide", async () => {
		const rows = await sql<{ slug: string; n: string }>(`
			SELECT slug, jsonb_array_length(media)::text AS n
			FROM bot.db_games
			WHERE slug IN ('kakarot', 'sparking-zero', 'xenoverse-2')
			  AND media IS NOT NULL AND jsonb_typeof(media) = 'array'
		`);
		expect(rows.length).toBe(3);
		for (const r of rows) {
			expect(Number(r.n)).toBeGreaterThanOrEqual(1);
		}
	});

	test("Exciting Guide Character Volume a des pages (lecteur)", async () => {
		const rows = await sql<{ n: string }>(`
			SELECT jsonb_array_length(COALESCE(pages, '[]'::jsonb))::text AS n
			FROM bot.db_databooks
			WHERE title ILIKE '%Exciting Guide%Character%'
			LIMIT 1
		`);
		expect(rows.length).toBe(1);
		expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(6);
	});
});
