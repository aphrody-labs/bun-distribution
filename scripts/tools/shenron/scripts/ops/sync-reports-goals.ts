#!/usr/bin/env bun
/**
 * sync-reports-goals.ts — Synchronisation bidirectionnelle DB SQLite ↔ Markdown.
 *
 * Usage :
 *   bun scripts/ops/sync-reports-goals.ts [--dry-run]
 *   bun scripts/ops/sync-reports-goals.ts --complete-goal <ID> [bilan]
 *   bun scripts/ops/sync-reports-goals.ts --resolve-report <ID> [notes]
 */

import "reflect-metadata";
import "../../../../../apps/shenron/bot/tests/setup-training";
import { AdminReportGoalService } from "../../../../../apps/shenron/bot/src/services/AdminReportGoalService";
import { DatabaseService } from "../../../../../apps/shenron/bot/src/db/index";

const args = process.argv.slice(2);

async function main() {
	const dbs = new DatabaseService();
	const service = new AdminReportGoalService(dbs);

	// Action : compléter un objectif directement
	const completeGoalIdx = args.indexOf("--complete-goal");
	if (completeGoalIdx !== -1 && args[completeGoalIdx + 1]) {
		const goalId = parseInt(args[completeGoalIdx + 1]!, 10);
		const notes = args.slice(completeGoalIdx + 2).join(" ") || "Complété via CLI sync-reports-goals";
		console.log(`Validation de l'objectif #${goalId}...`);
		const res = await service.completeGoal(goalId, notes, "admin-cli");
		if (res) {
			console.log(`✓ Objectif #${goalId} complété avec succès.`);
		} else {
			console.error(`❌ Objectif #${goalId} introuvable.`);
			process.exit(1);
		}
		return;
	}

	// Action : résoudre un rapport directement
	const resolveReportIdx = args.indexOf("--resolve-report");
	if (resolveReportIdx !== -1 && args[resolveReportIdx + 1]) {
		const reportId = parseInt(args[resolveReportIdx + 1]!, 10);
		const notes = args.slice(resolveReportIdx + 2).join(" ") || "Résolu via CLI sync-reports-goals";
		console.log(`Résolution du signalement #${reportId}...`);
		const res = await service.resolveReport(reportId, notes, "admin-cli");
		if (res) {
			console.log(`✓ Signalement #${reportId} résolu avec succès.`);
		} else {
			console.error(`❌ Signalement #${reportId} introuvable.`);
			process.exit(1);
		}
		return;
	}

	console.log("🔄 Synchronisation SQLite ↔ Markdown (docs/ADMIN-REPORTS.md, docs/GOALS.md)...");

	// Synchronisation
	await service.syncReportsMarkdown();
	await service.syncGoalsMarkdown();

	const openReports = service.listReports("open");
	const activeGoals = service.listGoals("pending");

	console.log(`✓ Synchronisation terminée avec succès.`);
	console.log(`  • Signalements ouverts : ${openReports.length}`);
	console.log(`  • Objectifs actifs      : ${activeGoals.length}`);
}

main().catch((err) => {
	console.error("Erreur sync-reports-goals:", err);
	process.exit(1);
});
