// SPDX-License-Identifier: Apache-2.0
/**
 * Central supervisor for a complete databook translation session.
 *
 * Workers use stable FNV-1a shards, so lanes can run concurrently and resume
 * without translating the same page twice. PostgreSQL remains the sole write
 * authority; each worker still applies the shared atomic quality gate.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const value = (name: string, fallback: string) => {
	const index = args.indexOf(`--${name}`);
	return index >= 0 && args[index + 1] && !args[index + 1]!.startsWith("--") ? args[index + 1]! : fallback;
};
const has = (name: string) => args.includes(`--${name}`);

const workers = Math.max(1, Math.min(8, Number(value("workers", "4")) || 4));
const batch = Math.max(1, Math.min(32, Number(value("batch", "8")) || 8));
const dryRun = has("dry-run");
const lots = value("lots", dryRun ? "1" : "0");
const moteur = value("moteur", "auto");
const databook = value("databook", "");
const appliquer = !dryRun;
const root = process.cwd();
const runId = `databook-translation-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
const runDir = join(root, "var", "runs", runId);
const bxcRoot = process.env.BXC_ROOT ?? join(root, "..", "aphrody-web", "apps", "bxc");
const manifestPath = join(runDir, "manifest.json");

type LaneResult = { lane: number; code: number; startedAt: string; endedAt: string };

async function main() {
	await Promise.all(["pending", "results", "logs", "evidence"].map((name) => mkdir(join(runDir, name), { recursive: true })));
	const manifest = {
		run_id: runId,
		requested_scope: "all eligible databook pages: Japanese OCR -> protected FR translation -> atomic PostgreSQL deposit -> RAG ingest",
		tool_versions: { bun: Bun.version, workers, batch, bxcRoot },
		inputs: { repository: root, database: "shenron_site via configured tunnel", source: "bot.db_databooks" },
		actions: [`spawn ${workers} stable translation shards`, "ingest databooks corpus into RAG"],
		outputs: {},
		status: "running",
		evidence: { runDir },
	};
	await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

	const results: LaneResult[] = [];
	await Promise.all(
		Array.from({ length: workers }, async (_, lane) => {
			const startedAt = new Date().toISOString();
			const logPath = join(runDir, "logs", `lane-${String(lane + 1).padStart(2, "0")}.log`);
			// BXC owns one local model bootstrap path. Stagger startup so concurrent
			// lanes do not race while opening the same engine; translation itself stays
			// concurrent after initialization.
			if (lane > 0) await new Promise((resolve) => setTimeout(resolve, lane * 3000));
			const command = [
				"bun",
				"apps/site/scripts/traduction-boucle.ts",
				"--lots",
				lots,
				"--taille",
				String(batch),
				"--moteur",
				moteur,
				...(appliquer ? ["--appliquer"] : []),
				...(databook ? ["--databook", databook] : []),
				"--shards",
				String(workers),
				"--shard-index",
				String(lane),
				"--worker-id",
				`${runId}-lane-${lane + 1}`,
			];
			const child = Bun.spawn(command, {
				cwd: root,
				env: {
					...process.env,
					BXC_ROOT: bxcRoot,
					BXC_CLI: join(bxcRoot, "src", "cli", "index.ts"),
					SHENRON_TRANSLATION_RUN_ID: runId,
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			await writeFile(logPath, `${stdout}\n--- STDERR ---\n${stderr}`);
			const code = await child.exited;
			results.push({ lane: lane + 1, code, startedAt, endedAt: new Date().toISOString() });
			console.log(`[SESSION] lane ${lane + 1}/${workers} terminée: exit ${code}`);
		})
	);

	const failed = results.filter((result) => result.code !== 0);
	const resultPayload = { runId, workers, batch, lanes: results.toSorted((a, b) => a.lane - b.lane), failed: failed.length };
	await writeFile(join(runDir, "results", "lanes.json"), JSON.stringify(resultPayload, null, 2));
	if (failed.length) throw new Error(`${failed.length} lane(s) ont échoué; voir ${join(runDir, "logs")}`);

	if (dryRun) {
		console.log("[SESSION] Mode --dry-run : simulation réussie, ingestion RAG ignorée.");
		const completed = { ...manifest, outputs: { lanes: resultPayload, dryRun: true }, status: "completed", evidence: { runDir } };
		await writeFile(manifestPath, JSON.stringify(completed, null, 2));
		console.log(`[SESSION] FAIT (simulation) — manifeste: ${manifestPath}`);
		return;
	}

	console.log("[SESSION] Toutes les lanes sont terminées; ingestion databooks -> RAG.");
	let ingestCode = 1;
	let ingestLog = "";
	for (let attempt = 1; attempt <= 3; attempt++) {
		const ingest = Bun.spawn(["bun", "packages/pipeline/scripts/ingest-databooks-rag.ts"], {
			cwd: root,
			stdout: "pipe",
			stderr: "pipe",
			env: process.env,
		});
		const [ingestOutput, ingestError] = await Promise.all([
			new Response(ingest.stdout).text(),
			new Response(ingest.stderr).text(),
		]);
		ingestCode = await ingest.exited;
		ingestLog += `\n=== tentative ${attempt}/3 (exit ${ingestCode}) ===\n${ingestOutput}\n${ingestError}`;
		if (ingestCode === 0) break;
		if (attempt < 3) await Bun.sleep(2000);
	}
	await writeFile(join(runDir, "logs", "rag-ingest.log"), ingestLog);
	if (ingestCode !== 0) throw new Error(`ingestion RAG échouée (exit ${ingestCode})`);

	const completed = { ...manifest, outputs: { lanes: resultPayload, ragIngest: "completed" }, status: "completed", evidence: { runDir } };
	await writeFile(manifestPath, JSON.stringify(completed, null, 2));
	console.log(`[SESSION] FAIT — manifeste: ${manifestPath}`);
}

main().catch(async (error) => {
	const previous = await Bun.file(manifestPath).json().catch(() => null);
	if (previous) {
		await writeFile(
			manifestPath,
			JSON.stringify(
				{ ...previous, status: "failed", error: (error as Error).message, failedAt: new Date().toISOString() },
				null,
				2
			),
		);
	}
	console.error(`[SESSION] INCOMPLET: ${(error as Error).message}`);
	process.exit(1);
});
