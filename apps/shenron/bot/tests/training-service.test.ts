import "./setup-training";
import { describe, expect, test } from "bun:test";
import { TrainingService } from "../src/services/TrainingService";
import { DatabaseService } from "../src/db/index";
import { CanonService } from "../src/services/CanonService";
import { ragTrainingFeedback } from "../src/db/schema";
import { eq } from "drizzle-orm";

const botDbPath = ":memory:";

describe("TrainingService — Interface d'entraînement direct RAG & APIs", () => {
	const dbs = DatabaseService.forPath(botDbPath);
	const canon = new CanonService(null as any);
	const training = new TrainingService(dbs, canon);

	dbs.sqlite.exec(
		"CREATE VIRTUAL TABLE rag_chunks USING fts5(kind, title, url, content, lang, source_id, entity, tokenize='unicode61 remove_diacritics 2')"
	);
	const insertChunk = dbs.sqlite.query(
		"INSERT INTO rag_chunks (kind, title, url, content, lang, source_id, entity) VALUES (?, ?, ?, ?, ?, ?, ?)"
	);
	insertChunk.run("character", "Son Goku", "/wiki/personnages/son-goku", "Son Goku est le héros Saiyan de Dragon Ball.", "fr", "db_characters", "Goku");
	insertChunk.run("technique", "Kamehameha", "/wiki/techniques/kamehameha", "Le Kamehameha est une technique d'énergie emblématique de Son Goku.", "fr", "db_techniques", "Kamehameha");
	insertChunk.run("location", "Planète Namek", "/wiki/cosmologie/namek", "Les Namekiens vivent sur la planète Namek.", "fr", "db_locations", "Namek");

	test("isSidecarOnline s'exécute sans exception et renvoie un booléen", async () => {
		const status = await training.isSidecarOnline();
		expect(typeof status).toBe("boolean");
	});

	test("loadGoldCases charge le fichier tests/rag-gold.jsonl avec succès", async () => {
		const cases = await training.loadGoldCases();
		expect(cases.length).toBeGreaterThanOrEqual(60);
		expect(cases[0]).toBeDefined();
		expect(typeof cases[0]?.q).toBe("string");
		const c = cases[0]!;
		expect(Boolean(c.expectUrl?.length || c.expectTitle?.length || c.expect?.length)).toBe(true);
	});

	test("inspectRag diagnostique les tokens, pondérations de vérité et scores", async () => {
		const diag = await training.inspectRag("Kamehameha");
		expect(diag.query).toBe("Kamehameha");
		expect(Array.isArray(diag.tokens)).toBe(true);
		expect(diag.tokens.length).toBeGreaterThan(0);
		expect(diag.results.length).toBeGreaterThan(0);

		const top = diag.results[0]!;
		expect(top.title.toLowerCase()).toContain("kamehameha");
		expect(top.truthMultiplier).toBeGreaterThanOrEqual(1.0);
		expect(top.score).toBeGreaterThan(0);
	}, 20000);

	test("evaluateRag sur un échantillon rapide calcule les métriques de retrieval", async () => {
		const metrics = await training.evaluateRag(3);
		expect(metrics.cases).toBe(3);
		expect(metrics.recall[1]).toBeDefined();
		expect(metrics.recall[5]).toBeDefined();
		expect(metrics.mrr).toBeDefined();
		expect(metrics.durationMs).toBeGreaterThan(0);
		// Base et sidecar réels : sous charge (embedding en masse), trois requêtes
		// hybrides + rerank dépassent largement 15 s sans que rien ne soit cassé.
	}, 90000);

	test("recordFeedback enregistre et persiste un retour d'entraînement", async () => {
		const testQuery = `test_query_${Date.now()}`;
		await training.recordFeedback({
			userId: "1527405876695142620",
			userTag: "omlar_",
			type: "rag",
			query: testQuery,
			rating: 5,
			expected: "Son Goku Super Saiyan",
			comment: "Validation automatique de test",
			status: "gold_added",
		});

		const inserted = dbs.sqlite
			.query("SELECT * FROM rag_training_feedback WHERE query = ?")
			.get(testQuery) as any;

		expect(inserted).toBeDefined();
		expect(inserted.user_id).toBe("1527405876695142620");
		expect(inserted.rating).toBe(5);
		expect(inserted.status).toBe("gold_added");
		expect(inserted.expected).toBe("Son Goku Super Saiyan");
	});

	test("getStats retourne les métriques globales et l'état des composants", async () => {
		const stats = await training.getStats();
		expect(stats.totalChunks).toBeGreaterThan(0);
		expect(stats.totalGoldCases).toBeGreaterThanOrEqual(60);
		expect(stats.totalFeedbacks).toBeGreaterThanOrEqual(1);
		expect(["online", "offline"]).toContain(stats.sidecarStatus);
		expect(["online", "offline"]).toContain(stats.siteApiStatus);
		expect(["online", "offline"]).toContain(stats.botApiStatus);
	});
});

describe("TrainingService — chemin du jeu doré (D15)", () => {
	test("RAG_GOLD_PATH déplace le jeu doré, le défaut reste le fichier livré", async () => {
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const training = new TrainingService(DatabaseService.forPath(":memory:"), new CanonService(null as any));
		const saved = { path: process.env.RAG_GOLD_PATH, legacy: process.env.RAG_GOLD };
		const file = join(tmpdir(), `shenron-gold-${process.pid}-${Date.now()}.jsonl`);
		await Bun.write(file, `${JSON.stringify({ q: "Qui est Goku ?", expectUrl: ["/wiki/personnages/son-goku"] })}\n`);
		try {
			delete process.env.RAG_GOLD;
			process.env.RAG_GOLD_PATH = file;
			expect((await training.loadGoldCases()).map((c) => c.q)).toEqual(["Qui est Goku ?"]);
			delete process.env.RAG_GOLD_PATH;
			expect((await training.loadGoldCases()).length).toBeGreaterThanOrEqual(60);
		} finally {
			if (saved.path === undefined) delete process.env.RAG_GOLD_PATH;
			else process.env.RAG_GOLD_PATH = saved.path;
			if (saved.legacy === undefined) delete process.env.RAG_GOLD;
			else process.env.RAG_GOLD = saved.legacy;
			await Bun.file(file).delete().catch(() => undefined);
		}
	});
});
