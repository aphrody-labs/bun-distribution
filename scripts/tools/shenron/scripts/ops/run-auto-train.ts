#!/usr/bin/env bun
/**
 * run-auto-train.ts — Banc d'évaluation et d'entraînement automatisé du RAG Shenron.
 *
 * Exécutable manuellement, via cron système ou pipeline CI/CD :
 *   bun scripts/ops/run-auto-train.ts [--samples N] [--alert] [--strict] [--json]
 *
 * Options :
 *   --samples <N>   Nombre de cas dorés à tester (défaut : tous les cas de tests/rag-gold.jsonl)
 *   --alert         Envoie systématiquement le bilan dans le salon admin (1548677623935139901)
 *   --strict        Quitte avec code 1 si régression détectée (Recall@5 ou MRR en baisse > 5%)
 *   --json          Sortie brute JSON pour monitoring / dashboards
 */

import "reflect-metadata";
import { Database } from "bun:sqlite";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
	const idx = args.indexOf(flag);
	return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const hasFlag = (flag: string) => args.includes(flag);

async function main() {
	Bun.env.DATABASE_PATH ??= join(import.meta.dir, "../../../../../apps/shenron/bot/data/bot.db");
	if (Bun.env.RAG_DB) Bun.env.DATABASE_PATH = resolve(Bun.env.RAG_DB);
	const botEnvPath = join(import.meta.dir, "../../apps/bot/.env");
	if (Bun.env.NODE_ENV !== "test" && (await Bun.file(botEnvPath).exists())) {
		for (const line of (await Bun.file(botEnvPath).text()).split("\n")) {
			const entry = line.trim();
			if (!entry || entry.startsWith("#")) continue;
			const separator = entry.indexOf("=");
			if (separator > 0) {
				const key = entry.slice(0, separator).trim();
				const value = entry
					.slice(separator + 1)
					.replace(/^['"]|['"]$/g, "")
					.trim();
				if (!Bun.env[key]) Bun.env[key] = value;
			}
		}
	}
	if (!Bun.env.GUILD_ID) Bun.env.GUILD_ID = "111111111111111111";
	if (!Bun.env.OWNER_ID) Bun.env.OWNER_ID = "111111111111111111";
	if (!Bun.env.DISCORD_TOKEN && !Bun.env.DISCORD_TOKEN_SHENRON)
		Bun.env.DISCORD_TOKEN = "rag-evaluation-local";
	if (!Bun.env.NODE_ENV) Bun.env.NODE_ENV = "test";
	if (!Bun.env.LOG_LEVEL) Bun.env.LOG_LEVEL = "error";
	const runtimeEnvPromise = import("../../../../../apps/shenron/bot/src/lib/env");
	const { env: runtimeEnv } = await runtimeEnvPromise;
	const [{ TrainingService }, { DatabaseService }, { CanonService }, { sendAdminLabMessage }] =
		await Promise.all([
			import("../../../../../apps/shenron/bot/src/services/TrainingService"),
			import("../../../../../apps/shenron/bot/src/db/index"),
			import("../../../../../apps/shenron/bot/src/services/CanonService"),
			import("../../../../../apps/shenron/bot/src/lib/admin-lab"),
		]);
	const samplesArg = getArg("--samples");
	const samples = samplesArg ? parseInt(samplesArg, 10) : undefined;
	const shouldAlert = hasFlag("--alert");
	const strict = hasFlag("--strict");
	const jsonOutput = hasFlag("--json");

	if (!jsonOutput) {
		console.log("🐉 Démarrage de l'évaluation automatisée RAG Shenron...\n");
	}

	const databasePath = resolve(Bun.env.DATABASE_PATH!);
	const readOnlyEval = Bun.env.RAG_DB !== undefined || Bun.env.RAG_EVAL_READ_ONLY === "1";
	const checkDb = new Database(databasePath, { readonly: true });
	try {
		const tables = checkDb
			.query(
				"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('rag_chunks', 'rag_eval_history')"
			)
			.all() as { name: string }[];
		const tableNames = new Set(tables.map((table) => table.name));
		if (!tableNames.has("rag_chunks"))
			throw new Error("La base sélectionnée ne contient pas l'index rag_chunks.");
		if (!tableNames.has("rag_eval_history"))
			throw new Error("La base sélectionnée ne contient pas rag_eval_history.");
	} finally {
		checkDb.close();
	}
	const dbs = readOnlyEval
		? DatabaseService.forReadOnlyPath(databasePath)
		: DatabaseService.forPath(databasePath);
	const canon = new CanonService(null as any);
	const service = new TrainingService(dbs, canon);

	// Récupère l'historique précédent pour calculer le delta
	const prevHistory = readOnlyEval ? [] : service.getEvalHistory(1);
	const prev = prevHistory.length > 0 ? prevHistory[0] : null;

	const start = performance.now();
	const metrics = await service.evaluateRag(samples, { persist: !readOnlyEval });
	const elapsed = Math.round(performance.now() - start);

	const deltaR1 = prev ? (metrics.recall[1] ?? 0) - prev.recall_1 : 0;
	const deltaR5 = prev ? (metrics.recall[5] ?? 0) - prev.recall_5 : 0;
	const deltaMrr = prev ? metrics.mrr - prev.mrr : 0;
	const isRegression = deltaR5 <= -0.05 || deltaMrr <= -0.05;

	if (jsonOutput) {
		console.log(
			JSON.stringify(
				{ metrics, prev, delta: { r1: deltaR1, r5: deltaR5, mrr: deltaMrr }, isRegression },
				null,
				2
			)
		);
		if (strict && isRegression) process.exit(1);
		return;
	}

	console.log("=================================================");
	console.log(` Cas testés     : ${metrics.cases}`);
	console.log(` Durée totale   : ${elapsed} ms`);
	console.log(
		` Sidecar ONNX   : ${metrics.sidecarActive ? "🟢 En ligne" : "🟠 Hors-ligne (repli BM25)"}`
	);
	console.log("-------------------------------------------------");
	console.log(
		` Recall@1       : ${((metrics.recall[1] ?? 0) * 100).toFixed(1)}% (${formatDelta(deltaR1)})`
	);
	console.log(` Recall@3       : ${((metrics.recall[3] ?? 0) * 100).toFixed(1)}%`);
	console.log(
		` Recall@5       : ${((metrics.recall[5] ?? 0) * 100).toFixed(1)}% (${formatDelta(deltaR5)})`
	);
	console.log(` Recall@10      : ${((metrics.recall[10] ?? 0) * 100).toFixed(1)}%`);
	console.log(` MRR            : ${(metrics.mrr * 100).toFixed(1)}% (${formatDelta(deltaMrr)})`);
	console.log(` nDCG@10        : ${(metrics.ndcg * 100).toFixed(1)}%`);
	console.log(` Échecs (misses): ${metrics.misses.length} / ${metrics.cases}`);
	console.log("=================================================");

	if (metrics.misses.length > 0) {
		console.log("\n⚠️ Échantillons de requêtes manquées :");
		for (const m of metrics.misses.slice(0, 5)) {
			console.log(` • "${m.q}"`);
			console.log(`   Attendu : [${m.expected.join(", ")}]`);
			if (m.returnedTitle)
				console.log(`   Reçu #1 : "${m.returnedTitle}" (score: ${m.returnedScore?.toFixed(2)})`);
		}
	}

	// Notification salon admin si demandé ou en cas de régression
	if (!readOnlyEval && (shouldAlert || isRegression)) {
		console.log("\n📢 Envoi du rapport dans le salon admin 🤖・lab-ia-admin...");
		const color = isRegression ? 0xef4444 : metrics.sidecarActive ? 0x22c55e : 0xeab308;
		const title = isRegression
			? "🚨 ALERTE : RÉGRESSION RETRIEVAL RAG DÉTECTÉE"
			: "📊 RAPPORT ÉVALUATION RAG — OPS";

		await sendAdminLabMessage({
			embeds: [
				{
					color,
					title,
					description: [
						`Banc d'évaluation exécuté sur **${metrics.cases}** requêtes dorées.`,
						"",
						`• **Recall@1 :** \`${((metrics.recall[1] ?? 0) * 100).toFixed(1)}%\` (${formatDelta(deltaR1)})`,
						`• **Recall@5 :** \`${((metrics.recall[5] ?? 0) * 100).toFixed(1)}%\` (${formatDelta(deltaR5)})`,
						`• **MRR :** \`${(metrics.mrr * 100).toFixed(1)}%\` (${formatDelta(deltaMrr)})`,
						`• **nDCG@10 :** \`${(metrics.ndcg * 100).toFixed(1)}%\``,
						`• **Sidecar ONNX :** ${metrics.sidecarActive ? "🟢 En ligne (aphrody-shenron-embed)" : "🟠 Hors-ligne"}`,
						`• **Misses :** \`${metrics.misses.length} / ${metrics.cases}\``,
					].join("\n"),
					timestamp: new Date().toISOString(),
				},
			],
		});
		console.log("✓ Rapport transmis.");
	}

	if (strict && isRegression) {
		console.error("\n❌ Échec: Régression supérieure au seuil critique de 5%.");
		process.exit(1);
	}
}

function formatDelta(delta: number): string {
	const pct = (delta * 100).toFixed(1);
	if (delta > 0) return `+${pct}%`;
	if (delta < 0) return `${pct}%`;
	return "= 0.0%";
}

main().catch((err) => {
	console.error("Erreur fatale run-auto-train:", err);
	process.exit(1);
});
