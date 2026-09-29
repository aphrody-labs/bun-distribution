import "./setup-training";
import { describe, expect, test } from "bun:test";
import { AutoEvalCronEvent } from "../src/events/AutoEvalCron";
import { CronRegistry } from "../src/api/cron-registry";
import { TrainingService } from "../src/services/TrainingService";
import { DatabaseService } from "../src/db/index";
import { CanonService } from "../src/services/CanonService";

describe("AutoEvalCron — Automatisation de l'évaluation RAG", () => {
	const cron = new CronRegistry();
	const dbs = new DatabaseService();
	const canon = new CanonService(null as any);
	const training = new TrainingService(dbs, canon);
	const event = new AutoEvalCronEvent(cron, training);

	test("register() enregistre la tâche 'rag-auto-eval' dans CronRegistry avec intervalle de 6h", async () => {
		await event.register();
		const jobs = cron.list();
		const ragJob = jobs.find((j) => j.name === "rag-auto-eval");

		expect(ragJob).toBeDefined();
		expect(ragJob?.intervalMs).toBe(6 * 3_600_000);
		expect(ragJob?.description).toContain("RAG");
	});

	test("le job 'rag-auto-eval' s'exécute sans erreur", async () => {
		// Mock rapide pour tester le cycle du cron sans timeout réseau/embed
		const origEval = training.evaluateRag.bind(training);
		(training as any).evaluateRag = async (n: number) => ({
			cases: n,
			recall: { 1: 0.9, 3: 0.95, 5: 1.0, 10: 1.0 },
			mrr: 0.92,
			ndcg: 0.94,
			durationMs: 150,
			sidecarActive: true,
			misses: [],
		});

		try {
			const result = await cron.run("rag-auto-eval");
			expect(result.ok).toBe(true);
			expect(result.error).toBeNull();
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		} finally {
			training.evaluateRag = origEval;
		}
	});
});
