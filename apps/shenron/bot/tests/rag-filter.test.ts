import "reflect-metadata";
import "./setup";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { container } from "tsyringe";
import * as sqliteVec from "sqlite-vec";
import { Database } from "bun:sqlite";
import { DatabaseService } from "../src/db/index";
import { hybridSearch, resetQueryEmbeddingModel, type RagHit } from "../src/lib/rag";

// hybridSearch lit l'environnement et garde un modèle d'embedding en cache de
// module : un autre fichier de la suite (même processus) ou un .env local peut
// le pointer ailleurs, et le chemin chaud a un délai réel de 3 s. Sans ce
// verrou, une suite chargée retombait en mode lexical et les assertions
// dépendaient du mode obtenu. On fige donc un transport loopback intercepté par
// le mock fetch, un délai large, et le backend local.
const PINNED_ENV = {
	EMBED_URL: "http://127.0.0.1:9",
	APHRODY_SHENRON_EMBED_BASE_URL: "http://127.0.0.1:9",
	EMBED_TIMEOUT_MS: "60000",
	RAG_BACKEND: undefined,
} as const;
function pinEmbeddingEnv(): () => void {
	const saved = Object.fromEntries(Object.keys(PINNED_ENV).map((k) => [k, process.env[k]]));
	for (const [k, v] of Object.entries(PINNED_ENV)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	resetQueryEmbeddingModel();
	return () => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
		resetQueryEmbeddingModel();
	};
}

describe("RAG Metadata Filtering", () => {
	let dbs: { sqlite: Database };
	const originalFetch = global.fetch;
	let restoreEnv: () => void = () => {};

	beforeAll(async () => {
		restoreEnv = pinEmbeddingEnv();
		const memDb = new Database(":memory:");
		dbs = { sqlite: memDb };
		sqliteVec.load(dbs.sqlite);

		// Initialisation des tables FTS5 et vecteurs pour le test
		dbs.sqlite.run("DROP TABLE IF EXISTS rag_chunks");
		dbs.sqlite.run("DROP TABLE IF EXISTS vec_chunks");
		dbs.sqlite.run("DROP TABLE IF EXISTS rag_meta");

		dbs.sqlite.run(
			`CREATE VIRTUAL TABLE rag_chunks USING fts5(kind, title, url, content, lang, source_id, entity, tokenize='unicode61 remove_diacritics 2')`
		);
		dbs.sqlite.run(`CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[384])`);
		dbs.sqlite.run(
			`CREATE TABLE rag_meta (model TEXT, dim INTEGER, count INTEGER, built_at INTEGER)`
		);

		// Insertion de données de test
		const insChunk = dbs.sqlite.query(
			"INSERT INTO rag_chunks (rowid, kind, title, url, content, lang, source_id, entity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
		);
		const insVector = dbs.sqlite.query("INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)");

		// Helper pour générer un Float32Array de vecteur factice (384 dimensions)
		const mockVecBlob = (val: number) => {
			return new Float32Array(384).fill(val);
		};

		// Chunk 1: Goku en Français (db_characters)
		insChunk.run(
			1,
			"character",
			"Goku",
			"/wiki/goku",
			"Goku est un puissant guerrier de la race des Saiyans.",
			"fr",
			"db_characters",
			"Goku"
		);
		insVector.run(1, mockVecBlob(0.9));

		// Chunk 2: Goku en Anglais (db_characters)
		insChunk.run(
			2,
			"character",
			"Goku (EN)",
			"/wiki/goku-en",
			"Goku is a powerful Saiyan warrior from Earth.",
			"en",
			"db_characters",
			"Goku"
		);
		insVector.run(2, mockVecBlob(0.8));

		// Chunk 3: Vegeta en Français (db_characters)
		insChunk.run(
			3,
			"character",
			"Vegeta",
			"/wiki/vegeta",
			"Vegeta est le prince de tous les Saiyans.",
			"fr",
			"db_characters",
			"Vegeta"
		);
		insVector.run(3, mockVecBlob(0.7));

		// Chunk 4: Kamehameha (techniques)
		insChunk.run(
			4,
			"technique",
			"Kamehameha",
			"/wiki/kamehameha",
			"Le Kamehameha is la technique signature de Goku.",
			"fr",
			"db_techniques",
			"Goku"
		);
		insVector.run(4, mockVecBlob(0.6));

		// Insertion des méta
		dbs.sqlite.run(
			"INSERT INTO rag_meta (model, dim, count, built_at) VALUES (?, ?, ?, ?)",
			"mock-model",
			384,
			4,
			Date.now()
		);

		// Mock fetch pour l'API embeddings
		global.fetch = async (url, options) => {
			const urlStr = url.toString();
			console.log(`[MOCK FETCH] Request URL: ${urlStr}`);
			if (urlStr.endsWith("/v1/embeddings")) {
				console.log(`[MOCK FETCH] Matched /v1/embeddings, returning mock vector.`);
				return new Response(
					JSON.stringify({
						data: [{ index: 0, embedding: Array(384).fill(0.1) }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } }
				);
			}
			if (urlStr.includes("/rerank")) {
				console.log(`[MOCK FETCH] Matched /rerank, returning mock scores.`);
				let count = 1;
				try {
					if (options?.body) {
						const body = JSON.parse(options.body as string);
						if (Array.isArray(body.passages)) {
							count = body.passages.length;
						}
					}
				} catch {}
				return new Response(
					JSON.stringify({
						scores: Array(count).fill(0.5),
					}),
					{ status: 200, headers: { "content-type": "application/json" } }
				);
			}
			return originalFetch(url, options);
		};
	});

	afterAll(() => {
		global.fetch = originalFetch;
		restoreEnv();
		try {
			dbs.sqlite.close();
		} catch {}
	});

	it("devrait retourner tous les résultats pertinents sans aucun filtre", async () => {
		const { results } = await hybridSearch(dbs.sqlite, "Goku Saiyan", 10);
		expect(results.length).toBeGreaterThan(0);
		// Devrait contenir Goku FR et Goku EN
		const titles = results.map((r) => r.title);
		expect(titles).toContain("Goku");
		expect(titles).toContain("Goku (EN)");
	});

	it("devrait permettre une baseline lexicale déterministe", async () => {
		const { results, mode } = await hybridSearch(dbs.sqlite, "Goku Saiyan", 10, {
			lexicalOnly: true,
		});
		expect(mode).toBe("lexical");
		expect(results.map((r) => r.title)).toContain("Goku");
	});

	it("devrait filtrer les résultats par langue (fr)", async () => {
		const { results } = await hybridSearch(dbs.sqlite, "Goku Saiyan", 10, { lang: "fr" });
		const titles = results.map((r) => r.title);
		expect(titles).toContain("Goku");
		expect(titles).not.toContain("Goku (EN)");
	});

	it("devrait filtrer les résultats par langue (en)", async () => {
		const { results } = await hybridSearch(dbs.sqlite, "Goku Saiyan", 10, { lang: "en" });
		const titles = results.map((r) => r.title);
		expect(titles).not.toContain("Goku");
		expect(titles).toContain("Goku (EN)");
	});

	it("devrait filtrer les résultats par entité (Goku)", async () => {
		const { results } = await hybridSearch(dbs.sqlite, "Saiyan prince", 10, { entity: "Goku" });
		const titles = results.map((r) => r.title);
		// Devrait exclure Vegeta, même s'il correspond à "prince Saiyan", car l'entité est filtrée sur Goku
		expect(titles).not.toContain("Vegeta");
	});

	it("devrait filtrer les résultats par sourceId (db_techniques)", async () => {
		const { results } = await hybridSearch(dbs.sqlite, "Goku", 10, { sourceId: "db_techniques" });
		const titles = results.map((r) => r.title);
		expect(titles).toContain("Kamehameha");
		expect(titles).not.toContain("Goku");
	});

	it("devrait combiner les filtres d'entité et de langue", async () => {
		const { results } = await hybridSearch(dbs.sqlite, "Goku", 10, { entity: "Goku", lang: "fr" });
		const titles = results.map((r) => r.title);
		expect(titles).toContain("Goku");
		expect(titles).not.toContain("Goku (EN)");
		expect(titles).not.toContain("Vegeta");
	});

	it("devrait exposer un score normalisé ∈ [0,1] sur chaque hit", async () => {
		const { results } = await hybridSearch(dbs.sqlite, "Goku Saiyan", 10);
		expect(results.length).toBeGreaterThan(0);
		for (const r of results) {
			expect(typeof r.score).toBe("number");
			expect(r.score).toBeGreaterThanOrEqual(0);
			expect(r.score).toBeLessThanOrEqual(1);
		}
	});

	it("devrait tolérer une requête saturée de stopwords FR", async () => {
		// « comment / est / un » sont des stopwords → la requête ne doit pas se vider
		// et doit toujours ramener Goku (garde-fou ≥2 tokens de contenu).
		const { results } = await hybridSearch(dbs.sqlite, "comment Goku est un Saiyan", 10);
		expect(results.map((r) => r.title)).toContain("Goku");
	});
});

describe("RAG Déduplication & diversification", () => {
	let dbs: { sqlite: Database };
	const originalFetch = global.fetch;
	let restoreEnv: () => void = () => {};

	beforeAll(() => {
		restoreEnv = pinEmbeddingEnv();
		const memDb = new Database(":memory:");
		dbs = { sqlite: memDb };
		sqliteVec.load(dbs.sqlite);
		dbs.sqlite.run("DROP TABLE IF EXISTS rag_chunks");
		dbs.sqlite.run("DROP TABLE IF EXISTS vec_chunks");
		dbs.sqlite.run(
			`CREATE VIRTUAL TABLE rag_chunks USING fts5(kind, title, url, content, lang, source_id, entity, tokenize='unicode61 remove_diacritics 2')`
		);
		dbs.sqlite.run(`CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[384])`);
		const insChunk = dbs.sqlite.query(
			"INSERT INTO rag_chunks (rowid, kind, title, url, content, lang, source_id, entity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
		);
		const insVector = dbs.sqlite.query("INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)");
		const vec = (v: number) => new Float32Array(384).fill(v);
		// Deux chunks DISTINCTS partageant la MÊME url Fandom → doivent fusionner en 1.
		insChunk.run(
			10,
			"technique",
			"Kamehameha",
			"/wiki/kamehameha",
			"Le Kamehameha de Goku.",
			"fr",
			"kanzenshuu",
			"Goku"
		);
		insVector.run(10, vec(0.9));
		insChunk.run(
			11,
			"technique",
			"Kamehameha (variante)",
			"/wiki/kamehameha",
			"Kamehameha encore Goku.",
			"fr",
			"kanzenshuu",
			"Goku"
		);
		insVector.run(11, vec(0.85));
		// Deux planches manga distinctes partageant l'url générique → NE doivent PAS fusionner.
		insChunk.run(
			12,
			"source",
			"DB Tome 1 p5",
			"/wiki/manga",
			"Goku lance un Kamehameha planche 5.",
			"fr",
			"manga",
			"Goku"
		);
		insVector.run(12, vec(0.8));
		insChunk.run(
			13,
			"source",
			"DB Tome 1 p6",
			"/wiki/manga",
			"Goku Kamehameha planche 6.",
			"fr",
			"manga",
			"Goku"
		);
		insVector.run(13, vec(0.78));
		// Deux chunks Fandom au TITRE identique mais URL VIDE → repli titre → fusion.
		insChunk.run(
			14,
			"source",
			"Genkidama",
			"",
			"Genkidama de Goku, Kamehameha cousin.",
			"fr",
			"kanzenshuu",
			"Goku"
		);
		insVector.run(14, vec(0.7));
		insChunk.run(
			15,
			"source",
			"Genkidama",
			"",
			"Genkidama Goku encore Kamehameha.",
			"fr",
			"kanzenshuu",
			"Goku"
		);
		insVector.run(15, vec(0.69));

		global.fetch = async (url, options) => {
			const u = url.toString();
			if (u.endsWith("/v1/embeddings"))
				return new Response(JSON.stringify({ data: [{ index: 0, embedding: Array(384).fill(0.1) }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			if (u.includes("/rerank")) {
				let n = 1;
				try {
					const b = JSON.parse((options?.body as string) ?? "{}");
					if (Array.isArray(b.passages)) n = b.passages.length;
				} catch {}
				// Scores décroissants distincts → ordre stable + dedup garde le max.
				return new Response(
					JSON.stringify({ scores: Array.from({ length: n }, (_, i) => 1 - i * 0.05) }),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					}
				);
			}
			return originalFetch(url, options);
		};
	});

	afterAll(() => {
		global.fetch = originalFetch;
		restoreEnv();
	});

	it("fusionne les chunks Fandom partageant la même URL (1 seule occurrence)", async () => {
		const { results } = await hybridSearch(dbs.sqlite, "Kamehameha Goku", 10);
		const kameh = results.filter((r) => r.url === "/wiki/kamehameha");
		expect(kameh.length).toBe(1);
	});

	it("ne fusionne PAS les planches manga distinctes (préserve le quota manga)", async () => {
		const { results } = await hybridSearch(dbs.sqlite, "Kamehameha Goku", 10);
		const mangaRowids = results.filter((r) => r.url === "/wiki/manga").map((r) => r.rowid);
		expect(new Set(mangaRowids).size).toBe(mangaRowids.length); // pas de doublon rowid
		expect(mangaRowids.length).toBeGreaterThanOrEqual(2); // les 2 planches survivent
	});

	it("ne fusionne PAS les planches manga en repli lexical non plus", async () => {
		// Le repli lexical (embeddings indisponibles ou hors délai) applique la même
		// clé de diversification que le mode hybride.
		const { results, mode } = await hybridSearch(dbs.sqlite, "Kamehameha Goku", 10, {
			lexicalOnly: true,
		});
		expect(mode).toBe("lexical");
		const mangaRowids = results.filter((r) => r.url === "/wiki/manga").map((r) => r.rowid);
		expect(new Set(mangaRowids).size).toBe(mangaRowids.length);
		expect(mangaRowids.length).toBeGreaterThanOrEqual(2);
		expect(results.filter((r) => r.url === "/wiki/kamehameha").length).toBe(1);
	});

	it("fusionne les chunks au titre identique mais URL vide (repli titre)", async () => {
		const { results } = await hybridSearch(dbs.sqlite, "Genkidama Goku Kamehameha", 10);
		const genki = results.filter((r) => r.title === "Genkidama");
		expect(genki.length).toBe(1);
	});

	it("tolère la ponctuation spéciale et japonaise sans erreur FTS5", async () => {
		const res1 = await hybridSearch(dbs.sqlite, "[Attaque] \"Kamehameha\" : (Goku)?", 10);
		expect(res1.results.length).toBeGreaterThan(0);

		const res2 = await hybridSearch(dbs.sqlite, "「かめはめ波！」", 10);
		expect(Array.isArray(res2.results)).toBe(true);
	});

	afterAll(() => {
		try {
			dbs.sqlite.close();
		} catch {}
	});
});
