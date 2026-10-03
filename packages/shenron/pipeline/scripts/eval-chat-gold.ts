#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Scores the live Shenron chat route on the held-out gold questions written by
 * `build-chat-rollouts.ts`. A deterministic sample of gold rows is asked through
 * Aphrody `POST /api/v1/shenron/llm/chat` with the Shenron persona; an answer
 * counts as grounded when it shares at least MIN_OVERLAP_TOKENS significant
 * tokens with the row's expected passage line. Refusals, AI mentions and
 * latency are reported; the report is written next to the gold file.
 *
 *   bun scripts/eval-chat-gold.ts [--gold F] [--limit 40] [--label base] [--out F]
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
	atomicWrite,
	MIN_OVERLAP_TOKENS,
	parseJsonl,
	personaSystem,
	queryBucket,
	rejectReason,
	significantTokens,
	soulTone,
} from "./build-chat-rollouts";

interface GoldRow {
	query: string;
	expect?: string[];
}

export interface EvalScore {
	asked: number;
	grounded: number;
	refusal: number;
	aiMention: number;
	errors: number;
	meanLatencyMs: number;
}

/** Stable sample: gold rows ordered by query bucket then text, first `limit`. */
export function sampleGold(rows: GoldRow[], limit: number): GoldRow[] {
	return rows
		.filter((row) => typeof row.query === "string" && row.query.trim())
		.toSorted((a, b) => queryBucket(a.query) - queryBucket(b.query) || a.query.localeCompare(b.query))
		.slice(0, limit);
}

/** Whether an answer is grounded in the expected passage line(s). */
export function isGrounded(answer: string, expect: string[]): boolean {
	const want = significantTokens(expect.join(" "));
	let shared = 0;
	for (const token of significantTokens(answer)) if (want.has(token)) shared++;
	return shared >= MIN_OVERLAP_TOKENS;
}

if (import.meta.main) {
	const home = homedir();
	const { values } = parseArgs({
		options: {
			gold: { type: "string", default: join(home, ".aphrody/private/training/shenron/chat/gold.jsonl") },
			soul: { type: "string", default: join(home, ".aphrody/workspaces/dbfr/SOUL.md") },
			limit: { type: "string", default: "40" },
			label: { type: "string", default: "live" },
			out: { type: "string" },
		},
	});
	const rows = parseJsonl(readFileSync(values.gold as string, "utf8")) as GoldRow[];
	const sample = sampleGold(rows, Number.parseInt(values.limit as string, 10) || 40);
	const tone = soulTone(existsSync(values.soul as string) ? readFileSync(values.soul as string, "utf8") : "");
	const { AphrodyComputeClient } = await import("@shenron/pipeline/aphrody");
	const client = new AphrodyComputeClient();
	const score: EvalScore = { asked: 0, grounded: 0, refusal: 0, aiMention: 0, errors: 0, meanLatencyMs: 0 };
	let totalMs = 0;
	for (const row of sample) {
		score.asked++;
		const started = performance.now();
		try {
			const { answer } = await client.chat([
				{ role: "system", content: personaSystem(tone) },
				{ role: "user", content: row.query },
			]);
			totalMs += performance.now() - started;
			const expect = row.expect ?? [];
			const reason = rejectReason(answer, expect.join("\n"));
			if (reason === "refusal") score.refusal++;
			if (reason === "ai_mention") score.aiMention++;
			if (isGrounded(answer, expect)) score.grounded++;
		} catch {
			score.errors++;
		}
	}
	const answered = score.asked - score.errors;
	score.meanLatencyMs = answered ? Math.round(totalMs / answered) : 0;
	const out = values.out ?? join(dirname(values.gold as string), `eval-${values.label}.json`);
	const report = { label: values.label, gold: values.gold, at: new Date().toISOString(), ...score };
	atomicWrite(out, `${JSON.stringify(report, null, "\t")}\n`);
	console.log(JSON.stringify(report));
}
