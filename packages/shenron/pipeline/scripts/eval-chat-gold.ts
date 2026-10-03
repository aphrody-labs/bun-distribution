#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Scores the live Shenron chat route on the held-out gold questions written by
 * `build-chat-rollouts.ts`. A deterministic sample of gold rows is asked through
 * Aphrody `POST /api/v1/shenron/llm/chat` with the Shenron persona; an answer
 * counts as grounded when it shares at least MIN_OVERLAP_TOKENS significant
 * tokens with the row's expected passage line. Refusals, AI mentions and
 * latency are reported; the report is written next to the gold file. The route
 * is asked with the persona only (no retrieval context), so this is a chat
 * groundedness score, never a RAG metric: any RAG evaluation goes through
 * `@shenron/pipeline/testing/live-rag` against the real Shenron stores.
 *
 *   bun scripts/eval-chat-gold.ts [--gold F] [--limit 40] [--label base] [--out F]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
	atomicWrite,
	type ChatFn,
	isRefusal,
	MIN_OVERLAP_TOKENS,
	mentionsAi,
	parseIntOption,
	parseJsonl,
	personaSystem,
	queryBucket,
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

/** Independent signals: `rejectReason` keeps only the first match, so a long answer would hide its refusal. */
export function scoreAnswer(
	answer: string,
	expect: string[]
): { grounded: boolean; refusal: boolean; aiMention: boolean } {
	return {
		grounded: isGrounded(answer, expect),
		refusal: isRefusal(answer),
		aiMention: mentionsAi(answer),
	};
}

/** Sequential on purpose: the chat route has one llama.cpp slot and latency is measured per request. */
export async function runEval(
	rows: GoldRow[],
	tone: string,
	chat: ChatFn,
	log: (line: string) => void = () => {}
): Promise<EvalScore> {
	const score: EvalScore = { asked: 0, grounded: 0, refusal: 0, aiMention: 0, errors: 0, meanLatencyMs: 0 };
	let totalMs = 0;
	for (const row of rows) {
		score.asked++;
		const started = performance.now();
		try {
			// oxlint-disable-next-line no-await-in-loop
			const { answer } = await chat([
				{ role: "system", content: personaSystem(tone) },
				{ role: "user", content: row.query },
			]);
			totalMs += performance.now() - started;
			const result = scoreAnswer(answer, row.expect ?? []);
			if (result.refusal) score.refusal++;
			if (result.aiMention) score.aiMention++;
			if (result.grounded) score.grounded++;
		} catch (error) {
			score.errors++;
			log(`error: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const answered = score.asked - score.errors;
	score.meanLatencyMs = answered ? Math.round(totalMs / answered) : 0;
	return score;
}

async function main(): Promise<void> {
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
	const limit = parseIntOption("limit", values.limit as string, 1);
	const goldText = readFileSync(values.gold as string, "utf8");
	const rows = parseJsonl(goldText) as GoldRow[];
	const sample = sampleGold(rows, limit);
	const tone = soulTone(existsSync(values.soul as string) ? readFileSync(values.soul as string, "utf8") : "");
	const { AphrodyComputeClient } = await import("@shenron/pipeline/aphrody");
	const client = new AphrodyComputeClient();
	const score = await runEval(
		sample,
		tone,
		(messages) => client.chat(messages),
		(line) => console.error(line)
	);
	const out = values.out ?? join(dirname(values.gold as string), `eval-${values.label}.json`);
	const report = {
		label: values.label,
		gold: values.gold,
		goldSha256: createHash("sha256").update(goldText, "utf8").digest("hex"),
		goldRows: rows.length,
		retrieval: "none",
		at: new Date().toISOString(),
		...score,
	};
	atomicWrite(out, `${JSON.stringify(report, null, "\t")}\n`);
	console.log(JSON.stringify(report));
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
