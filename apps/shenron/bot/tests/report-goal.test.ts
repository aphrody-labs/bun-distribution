import "./setup-training";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	AdminReportGoalService,
	isBunTestRunner,
	type AdminLabNotifier,
} from "../src/services/AdminReportGoalService";
import { DatabaseService } from "../src/db/index";
import type { AdminLabMessageOptions } from "../src/lib/admin-lab";

// Isolation totale : base SQLite, docs/ et notifier temporaires. Rien n'atteint
// apps/shenron/bot/data/bot.db (miroir PostgreSQL), docs/*.md ni le salon Discord admin.
const workDir = mkdtempSync(join(tmpdir(), "report-goal-test-"));
const docsDir = join(workDir, "docs");
const sent: AdminLabMessageOptions[] = [];
const notify: AdminLabNotifier = async (options) => {
	sent.push(options);
};

describe("AdminReportGoalService — Signalements & Objectifs de session", () => {
	const dbs = DatabaseService.forPath(join(workDir, "bot.db"));
	const service = AdminReportGoalService.create(dbs, { docsDir, notify });
	afterAll(() => {
		dbs.sqlite.close();
		rmSync(workDir, { recursive: true, force: true });
	});

	test("createReport insère en base et synchronise ADMIN-REPORTS.md", async () => {
		const testTitle = `Test Report Bug ${Date.now()}`;
		const before = sent.length;
		const rep = await service.createReport({
			userId: "1527405876695142620",
			userTag: "omlar_",
			category: "site",
			title: testTitle,
			description: "Description détaillée du bug constaté sur le site.",
			severity: "major",
		});

		expect(rep.id).toBeDefined();
		expect(rep.title).toBe(testTitle);
		expect(rep.status).toBe("open");

		const inDb = dbs.sqlite.query("SELECT * FROM admin_reports WHERE id = ?").get(rep.id) as any;
		expect(inDb).toBeDefined();
		expect(inDb.title).toBe(testTitle);

		const mdContent = await Bun.file(join(docsDir, "ADMIN-REPORTS.md")).text();
		expect(mdContent).toContain(testTitle);
		expect(sent.length).toBe(before + 1);
	});

	test("resolveReport met à jour le statut et l'historique résolu en Markdown", async () => {
		const testTitle = `Report to resolve ${Date.now()}`;
		const rep = await service.createReport({
			userId: "1527405876695142620",
			category: "bot",
			title: testTitle,
			description: "Erreur à corriger.",
		});

		const resolved = await service.resolveReport(rep.id, "Corrigé via patch", "@omlar_");
		expect(resolved).toBeDefined();

		const inDb = dbs.sqlite.query("SELECT * FROM admin_reports WHERE id = ?").get(rep.id) as any;
		expect(inDb.status).toBe("resolved");
		expect(inDb.resolution_notes).toBe("Corrigé via patch");

		const mdContent = await Bun.file(join(docsDir, "ADMIN-REPORTS.md")).text();
		expect(mdContent).toContain("Corrigé via patch");
	});

	test("syncReportsMarkdown conserve les signalements rejetés dans leur section", async () => {
		const testTitle = `Report rejected ${Date.now()}`;
		const report = await service.createReport({
			userId: "test-user",
			category: "site",
			title: testTitle,
			description: "Signalement de test à rejeter.",
		});
		dbs.sqlite.query("UPDATE admin_reports SET status = 'rejected' WHERE id = ?").run(report.id);

		await service.syncReportsMarkdown();
		const markdown = await Bun.file(join(docsDir, "ADMIN-REPORTS.md")).text();
		expect(markdown).toContain("## 3. Signalements Rejetés");
		expect(markdown).toContain(testTitle);
	});

	test("createGoal insère l'objectif et met à jour GOALS.md", async () => {
		const goalTitle = `Test Goal Session ${Date.now()}`;
		const goal = await service.createGoal({
			userId: "1527405876695142620",
			userTag: "omlar_",
			title: goalTitle,
			description: "Objectif prioritaire pour la prochaine session d'agent.",
			priority: "p0",
			targetSession: "next_session",
			assignedTo: "claude",
		});

		expect(goal.id).toBeDefined();
		expect(goal.title).toBe(goalTitle);
		expect(goal.priority).toBe("p0");

		const inDb = dbs.sqlite.query("SELECT * FROM admin_goals WHERE id = ?").get(goal.id) as any;
		expect(inDb).toBeDefined();
		expect(inDb.title).toBe(goalTitle);

		const mdContent = await Bun.file(join(docsDir, "GOALS.md")).text();
		expect(mdContent).toContain(goalTitle);
	});

	test("completeGoal marque l'objectif comme complété", async () => {
		const goalTitle = `Goal to complete ${Date.now()}`;
		const goal = await service.createGoal({
			userId: "1527405876695142620",
			title: goalTitle,
			description: "Tâche à valider.",
		});

		const completed = await service.completeGoal(goal.id, "Bilan : tout est vérifié");
		expect(completed).toBeDefined();

		const inDb = dbs.sqlite.query("SELECT * FROM admin_goals WHERE id = ?").get(goal.id) as any;
		expect(inDb.status).toBe("completed");

		const mdContent = await Bun.file(join(docsDir, "GOALS.md")).text();
		expect(mdContent).toContain("Bilan : tout est vérifié");
	});

	test("syncGoalsMarkdown distingue les objectifs différés des objectifs accomplis", async () => {
		const goal = await service.createGoal({
			userId: "test-user",
			title: `Goal deferred ${Date.now()}`,
			description: "Objectif reporté.",
		});
		dbs.sqlite.query("UPDATE admin_goals SET status = 'deferred' WHERE id = ?").run(goal.id);

		await service.syncGoalsMarkdown();
		const markdown = await Bun.file(join(docsDir, "GOALS.md")).text();
		expect(markdown).toContain("1 actif(s), 1 différé(s), 1 accompli(s)");
		expect(markdown).toContain("## 2. Objectifs Différés");
		expect(markdown).toContain(goal.title);
	});
});

describe("AdminReportGoalService — garde-fou bun test contre la production", () => {
	test("le runner bun test est détecté", () => {
		expect(isBunTestRunner()).toBe(true);
	});

	test("refuse d'écrire dans docs/ de production, sans rien insérer en base", async () => {
		const dbs = DatabaseService.forPath(join(workDir, "guard-docs.db"));
		const service = new AdminReportGoalService(dbs);
		await expect(
			service.createGoal({ userId: "0", title: "Ne doit pas exister", description: "garde-fou" })
		).rejects.toThrow(/docs\/ de production/);
		const row = dbs.sqlite.query("SELECT count(*) AS n FROM admin_goals").get() as { n: number };
		expect(row.n).toBe(0);
	});

	test("refuse la base runtime apps/shenron/bot/data/bot.db", async () => {
		const prodDb = fileURLToPath(new URL("../data/bot.db", import.meta.url));
		const dbs = DatabaseService.forPath(prodDb);
		const service = AdminReportGoalService.create(dbs, { docsDir, notify });
		const before = sent.length;
		await expect(
			service.createReport({
				userId: "0",
				category: "other",
				title: "Ne doit pas exister",
				description: "garde-fou",
			})
		).rejects.toThrow(/base de production/);
		await expect(service.syncGoalsMarkdown()).rejects.toThrow(/base de production/);
		expect(sent.length).toBe(before);
		dbs.sqlite.close();
	});
});
