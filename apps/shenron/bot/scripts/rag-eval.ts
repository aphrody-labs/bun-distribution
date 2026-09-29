/**
 * rag-eval.ts — Harnais d'évaluation retrieval RAG Dragon Ball (jeu doré).
 *
 * Mesure la récupération sur le jeu doré (`resolveDataPath("ragGold")`) avec la
 * définition unique de `@shenron/pipeline/ai/eval` : un cas est juste quand la SOURCE attendue
 * (`expectUrl`) remonte, pas quand un mot de la question réapparaît.
 *
 * Deux passes par cas :
 *   - `lexical` — BM25 seul (baseline reproductible, sans sidecar) ;
 *   - `served`  — le pipeline tel que servi en production (hybride + rerank si le
 *                 sidecar répond). Un cas dégradé en lexical reste compté ici,
 *                 dans la passe servie : le mélanger à la baseline faussait les
 *                 deux lignes (« 82/68 cas servis en lexical »).
 *
 * Métriques : Recall@{1,3,5,10}, MRR, nDCG@10, latence p50/p95, ventilation par tag.
 *
 * Lecture seule sur apps/shenron/bot/data/bot.db (ou RAG_DB). Embedder : EMBED_URL ou
 * APHRODY_SHENRON_EMBED_BASE_URL, obligatoire hors --lexical-only (B13).
 *
 * Usage : bun scripts/rag-eval.ts [--ci] [--details] [--tag=<tag>] [--lexical-only] [--json=<fichier>]
 *   --ci : exit 1 si Recall@5 de la passe servie < seuil (régression franche).
 */
import { Database } from "bun:sqlite";
import { redis } from "bun";
import { join } from "node:path";
import {
	aggregate,
	aggregateByTag,
	matchesExpectedUrl,
	parseGold,
	runCase,
	type CaseResult,
	type Metrics,
} from "@shenron/pipeline/ai/eval";
import { resolveDataPath } from "@shenron/config/paths";
import { hybridSearch } from "../src/lib/rag";
import { repoRootFromScript, requireEmbedBaseUrl, servedBotDbPath } from "../../../../packages/shenron/pipeline/scripts/lib/script-env";

const REPO_ROOT = repoRootFromScript(import.meta.url);
const DB = process.env.RAG_DB ?? servedBotDbPath(REPO_ROOT);
// Jeu doré : RAG_GOLD_PATH / RAG_GOLD, sinon apps/shenron/bot/tests/rag-gold.jsonl (l'ancien
// défaut, relatif au script, visait un chemin du pipeline qui n'existe pas).
const GOLD = resolveDataPath("ragGold", {
	env: process.env,
	legacyDefault: join(REPO_ROOT, "apps", "bot", "tests", "rag-gold.jsonl"),
}).path;
const LIMIT = 10;

// Seuil CI de la passe servie. Calé sous la mesure du 2026-09-14 (jeu doré v2,
// matcher par URL) avec une marge pour le bruit de classement : il ne doit
// sonner que sur une régression franche (corpus appauvri, sidecar cassé).
const CI_RECALL5_MIN = Number(process.env.RAG_CI_RECALL5_MIN ?? 0.8);

const arg = (name: string) =>
	process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);

async function sidecarUp(origin: string): Promise<boolean> {
	try {
		const res = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1500) });
		return res.ok;
	} catch {
		return false;
	}
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(7);

function ligne(label: string, m: Metrics, width = 26): string {
	return [
		label.padEnd(width),
		String(m.cases).padStart(4),
		pct(m.recall[1]),
		pct(m.recall[3]),
		pct(m.recall[5]),
		pct(m.recall[10]),
		m.mrr.toFixed(3).padStart(6),
		m.ndcg.toFixed(3).padStart(7),
	].join("  ");
}

function entete(label: string, width = 26): string {
	const h = [label.padEnd(width), "cas".padStart(4), ...["R@1", "R@3", "R@5", "R@10"].map((x) => x.padStart(7)), "MRR".padStart(6), "nDCG@10"];
	return `${h.join("  ")}\n${"-".repeat(width + 58)}`;
}

function quantile(values: number[], q: number): number {
	if (values.length === 0) return 0;
	const sorted = values.toSorted((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

async function main(): Promise<void> {
	const tag = arg("tag");
	let gold = parseGold(await Bun.file(GOLD).text());
	if (tag) gold = gold.filter((c) => c.tags?.includes(tag));
	console.log(`→ jeu doré : ${gold.length} cas (${GOLD})${tag ? ` · tag=${tag}` : ""}`);

	if (!(await Bun.file(DB).exists())) {
		console.log(`⚠ base SQLite absente (${DB}) — fournir RAG_DB.`);
		return;
	}
	const db = new Database(DB, { readonly: true });
	let chunkCount = 0;
	let invalides = 0;
	try {
		chunkCount = (db.query("SELECT COUNT(*) c FROM rag_chunks").get() as { c: number }).c;
	} catch {
		console.log("⚠ rag_chunks absent (index non construit).");
		process.exit(flag("ci") ? 1 : 0);
	}
	if (chunkCount === 0) {
		console.log("⚠ index vide.");
		process.exit(flag("ci") ? 1 : 0);
	}

	// Un cas dont la source attendue n'existe pas dans l'index mesure un trou de
	// couverture, pas la qualité du classement : on le signale à part.
	if (flag("validate") || flag("ci")) {
		const indexedUrls = (db.query("SELECT DISTINCT url FROM rag_chunks WHERE url <> ''").all() as { url: string }[]).map(
			(row) => row.url
		);
		for (const c of gold) {
			const urls = (c.expectUrl ?? []).filter(
				(expected) => indexedUrls.some((actual) => matchesExpectedUrl(actual, expected))
			);
			const titres = (c.expectTitle ?? []).filter(
				(t) => (db.query("SELECT count(*) n FROM rag_chunks WHERE title LIKE '%' || ?1 || '%'").get(t) as { n: number }).n > 0
			);
			if ((c.expectUrl?.length || c.expectTitle?.length) && urls.length + titres.length === 0) {
				invalides++;
				console.log(`  ✗ source absente de l'index : ${c.q} → ${[...(c.expectUrl ?? []), ...(c.expectTitle ?? [])].join(" | ")}`);
			}
		}
		console.log(`→ validation : ${gold.length - invalides}/${gold.length} cas ont leur source dans l'index.\n`);
	}

	// B13 : hors --lexical-only, l'adresse de l'embedder est obligatoire (aucun défaut).
	const embed = flag("lexical-only") ? null : requireEmbedBaseUrl(process.env);
	const sidecar = embed !== null && (await sidecarUp(embed.origin));
	console.log(`→ index : ${chunkCount} chunks · sidecar ${sidecar ? "OK" : "absent"} (${embed ? embed.origin : "--lexical-only"})\n`);

	const lexical: CaseResult[] = [];
	const served: CaseResult[] = [];
	for (const c of gold) {
		lexical.push(await runCase(c, (q) => hybridSearch(db, q, LIMIT, { lexicalOnly: true })));
		if (sidecar) served.push(await runCase(c, (q) => hybridSearch(db, q, LIMIT)));
	}

	console.log(entete("passe"));
	console.log(ligne("lexical (BM25)", aggregate(lexical)));
	if (sidecar) {
		const parMode: Record<string, number> = {};
		for (const r of served) parMode[r.mode] = (parMode[r.mode] ?? 0) + 1;
		const modes = Object.entries(parMode)
			.map(([m, n]) => `${m}=${n}`)
			.join(" ");
		console.log(ligne("servie", aggregate(served)));
		const lat = served.map((r) => r.latencyMs);
		console.log(`\nmodes servis : ${modes} · latence p50=${quantile(lat, 0.5)} ms p95=${quantile(lat, 0.95)} ms`);
	}

	const principal = sidecar ? served : lexical;
	console.log(`\n${entete(`par tag (${sidecar ? "servie" : "lexical"})`)}`);
	for (const [t, m] of Object.entries(aggregateByTag(principal))) console.log(ligne(t, m));

	if (flag("details")) {
		const rates = principal.filter((r) => r.rank === 0 || r.rank > 3);
		console.log(`\nCas hors top-3 (${rates.length}) :`);
		for (const r of rates) {
			console.log(
				`  ${r.rank ? `#${r.rank}` : "MISS"} · ${r.case.q}\n      attendu : ${(r.case.expectUrl ?? r.case.expect ?? []).join(" | ")}\n      obtenu  : ${r.top.map((h) => `${h.url} [${h.kind}]`).join(" · ")}`
			);
		}
	}

	const m = aggregate(principal);
	const report = {
		chunkCount,
		date: new Date().toISOString(),
		gold: gold.length,
		sidecar,
		lexical: aggregate(lexical),
		served: sidecar ? aggregate(served) : null,
		byTag: aggregateByTag(principal),
		latency: sidecar
			? { p50: quantile(served.map((r) => r.latencyMs), 0.5), p95: quantile(served.map((r) => r.latencyMs), 0.95) }
			: null,
		misses: principal
			.filter((r) => r.rank === 0)
			.map((r) => ({ q: r.case.q, expected: r.case.expectUrl ?? r.case.expect, got: r.top })),
	};
	const jsonOut = arg("json");
	if (jsonOut) await Bun.write(jsonOut, JSON.stringify(report, null, 2));
	try {
		await redis.set("dbz:eval:report:rag", JSON.stringify(report));
		console.log("\n✓ Rapport RAG poussé dans Redis.");
	} catch (err) {
		console.error("✗ Impossible d'enregistrer le rapport RAG dans Redis :", err);
	}
	db.close();

	if (flag("ci")) {
		if (invalides > 0) {
			console.log(`✗ CI : ${invalides} attente(s) gold absente(s) de l'index`);
			process.exit(1);
		}
		const r5 = m.recall[5];
		if (r5 < CI_RECALL5_MIN) {
			console.log(`✗ CI : Recall@5 ${pct(r5).trim()} < seuil ${pct(CI_RECALL5_MIN).trim()}`);
			process.exit(1);
		}
		console.log(`✓ CI : Recall@5 ${pct(r5).trim()} ≥ seuil ${pct(CI_RECALL5_MIN).trim()}`);
	}
	if (flag("validate") && invalides > 0) process.exit(1);
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
