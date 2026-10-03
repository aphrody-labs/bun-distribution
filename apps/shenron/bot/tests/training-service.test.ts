// SPDX-License-Identifier: Apache-2.0
import "./setup-training";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { TrainingService } from "../src/services/TrainingService";
import { DatabaseService } from "../src/db/index";
import { CanonService } from "../src/services/CanonService";

const botDbPath = ":memory:";

// Unités pures : aucune récupération ni embedding ici. isSidecarOnline,
// inspectRag/evaluateRag/getStats (runtime réel) sont qualifiés dans
// training-rag-live.test.ts. Toute requête réseau sortante fait échouer la suite.
const realFetch = globalThis.fetch;
let fetchCalls = 0;
beforeAll(() => {
	globalThis.fetch = (() => {
		fetchCalls++;
		throw new Error("réseau interdit dans les unités pures TrainingService");
	}) as unknown as typeof fetch;
});
afterEach(() => expect(fetchCalls).toBe(0));
afterAll(() => {
	globalThis.fetch = realFetch;
});

describe("TrainingService — jeu doré, sonde et stockage des retours (sans retrieval)", () => {
	const dbs = DatabaseService.forPath(botDbPath);
	const canon = new CanonService(null as any);
	const training = new TrainingService(dbs, canon);

	test("loadGoldCases charge le fichier tests/rag-gold.jsonl avec succès", async () => {
		const cases = await training.loadGoldCases();
		expect(cases.length).toBeGreaterThanOrEqual(60);
		expect(cases[0]).toBeDefined();
		expect(typeof cases[0]?.q).toBe("string");
		const c = cases[0]!;
		expect(Boolean(c.expectUrl?.length || c.expectTitle?.length || c.expect?.length)).toBe(true);
	});

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
