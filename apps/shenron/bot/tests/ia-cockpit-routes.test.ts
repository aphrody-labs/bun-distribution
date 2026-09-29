import "./setup-training";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	addGoldCaseRoute,
	completeGoalRoute,
	createGoalRoute,
	evaluateRagRoute,
	feedbackStatusRoute,
	type FeedbackStatus,
	type IaCockpitDeps,
} from "../src/api/ia-cockpit";
import { AdminReportGoalService, type AdminLabNotifier } from "../src/services/AdminReportGoalService";
import { DatabaseService } from "../src/db/index";
import type { EvalMetrics } from "../src/services/TrainingService";

// Isolated database, docs directory and notifier: nothing reaches
// apps/shenron/bot/data/bot.db, docs/*.md or the Discord admin channel.
const workDir = mkdtempSync(join(tmpdir(), "ia-cockpit-routes-"));
const dbs = DatabaseService.forPath(join(workDir, "bot.db"));
const notified: unknown[] = [];
const notify: AdminLabNotifier = async (options) => {
	notified.push(options);
};
const goals = AdminReportGoalService.create(dbs, { docsDir: join(workDir, "docs"), notify });

afterAll(() => {
	dbs.sqlite.close();
	rmSync(workDir, { recursive: true, force: true });
});

const METRICS: EvalMetrics = {
	cases: 25,
	recall: { 1: 0.4, 3: 0.6, 5: 0.72, 10: 0.88 },
	mrr: 0.43,
	ndcg: 0.54,
	durationMs: 1211,
	sidecarActive: false,
	misses: [],
};

function deps(overrides: Partial<IaCockpitDeps["training"]> = {}) {
	const feedback = new Map<number, FeedbackStatus>([[7, "pending"]]);
	const gold: Array<{ q: string; expect: string[]; userId: string; userTag: string }> = [];
	const evaluations: Array<{ sampleSize?: number; persist?: boolean }> = [];
	const snapshots: EvalMetrics[] = [];
	const value: IaCockpitDeps = {
		goals,
		training: {
			addGoldCase: async (q, expect, userId = "system", userTag = "admin") => {
				gold.push({ q, expect, userId, userTag });
				return true;
			},
			evaluateRag: async (sampleSize, options = {}) => {
				evaluations.push({ sampleSize, persist: options.persist });
				return { ...METRICS, cases: sampleSize ?? 172 };
			},
			recordEvalSnapshot: async (metrics) => {
				snapshots.push(metrics);
				return { id: snapshots.length };
			},
			...overrides,
		},
		setFeedbackStatus: async (id, status) => {
			if (!feedback.has(id)) return false;
			feedback.set(id, status);
			return true;
		},
	};
	return { value, feedback, gold, evaluations, snapshots };
}

describe("Cockpit IA du site — routes d'écriture du bot", () => {
	test("création puis clôture d'un objectif dans la base du bot", async () => {
		const { value } = deps();
		const created = await createGoalRoute(value, {
			title: "Objectif Test Cockpit",
			description: "Validation depuis le site",
			userId: "1527405876695142620",
			userTag: "AdminTest",
		});
		expect(created.status).toBe(201);
		const { goal } = (await created.json()) as { goal: { id: number; status: string; title: string } };
		expect(goal).toMatchObject({ title: "Objectif Test Cockpit", status: "pending" });

		const completed = await completeGoalRoute(value, String(goal.id), { notes: "Validé par test" });
		expect(completed.status).toBe(200);
		const row = dbs.sqlite.query("SELECT status, notes FROM admin_goals WHERE id = ?").get(goal.id) as { status: string; notes: string };
		expect(row).toEqual({ status: "completed", notes: "Validé par test" });
		expect(notified).toHaveLength(2);
	});

	test("validation des objectifs", async () => {
		const { value } = deps();
		expect((await createGoalRoute(value, { title: "", userId: "1" })).status).toBe(400);
		expect((await createGoalRoute(value, { title: "T" })).status).toBe(400);
		expect((await createGoalRoute(value, { title: "T", userId: "1", priority: "urgent" })).status).toBe(400);
		expect((await completeGoalRoute(value, "abc", {})).status).toBe(400);
		const missing = await completeGoalRoute(value, "999999", {});
		expect(missing.status).toBe(404);
		expect(((await missing.json()) as { error: string }).error).toBe("Objectif #999999 introuvable");
	});

	test("statut d'un retour : valeurs fermées, id existant", async () => {
		const { value, feedback } = deps();
		expect((await feedbackStatusRoute(value, "7", { status: "supprimé" })).status).toBe(400);
		expect((await feedbackStatusRoute(value, "8", { status: "rejected" })).status).toBe(404);
		const res = await feedbackStatusRoute(value, "7", { status: "rejected" });
		expect(res.status).toBe(200);
		expect(feedback.get(7)).toBe("rejected");
	});

	test("ajout au jeu doré via TrainingService.addGoldCase", async () => {
		const { value, gold } = deps();
		expect((await addGoldCaseRoute(value, { q: "Qui est Goku ?", expect: [] })).status).toBe(400);
		const res = await addGoldCaseRoute(value, { q: "Qui est Goku ?", expect: ["/wiki/personnages/son-goku", ""], userId: "42", userTag: "Admin" });
		expect(res.status).toBe(201);
		expect(gold).toEqual([{ q: "Qui est Goku ?", expect: ["/wiki/personnages/son-goku"], userId: "42", userTag: "Admin" }]);
	});

	test("évaluation : l'instantané n'est déclaré historisé qu'après écriture confirmée", async () => {
		const run = deps();
		const full = (await (await evaluateRagRoute(run.value, { samples: 25 })).json()) as { persisted: boolean; metrics: EvalMetrics };
		expect(full.persisted).toBe(true);
		expect(full.metrics.cases).toBe(25);
		expect(run.evaluations).toEqual([{ sampleSize: 25, persist: false }]);
		expect(run.snapshots).toHaveLength(1);

		const small = (await (await evaluateRagRoute(run.value, { samples: 3 })).json()) as { persisted: boolean };
		expect(small.persisted).toBe(false);
		expect(run.snapshots).toHaveLength(1);

		const all = (await (await evaluateRagRoute(run.value, {})).json()) as { metrics: EvalMetrics };
		expect(all.metrics.cases).toBe(172);
		expect(run.evaluations.at(-1)).toEqual({ sampleSize: undefined, persist: false });
	});

	test("évaluation : un échec d'écriture est rapporté, pas masqué", async () => {
		const { value } = deps({
			recordEvalSnapshot: async () => {
				throw new Error("SQLITE_BUSY");
			},
		});
		const json = (await (await evaluateRagRoute(value, { samples: 25 })).json()) as { persisted: boolean; persistError: string };
		expect(json).toMatchObject({ persisted: false, persistError: "SQLITE_BUSY" });
		expect((await evaluateRagRoute(value, { samples: -1 })).status).toBe(400);
	});
});
