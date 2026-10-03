#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Builds Shenron chat LoRA rollouts from retrieval triples.
 *
 * Input: `{query, positive, negative}` JSONL (default
 * `~/.aphrody/workspaces/dbfr/training/triples.jsonl`). Queries are deduped on
 * their normalized form and split deterministically by sha256 BEFORE any
 * generation: ~10 % go to `gold.jsonl` (`{query, expect}`), the rest become
 * candidates answered by the Aphrody teacher (`llm/chat`) with the positive
 * passage as the only evidence. Accepted rows match the aphrody-train
 * `lora.load_examples` contract and are anti-joined against the gold set with
 * a port of `aphrody_train.hashing.segment_hashes`.
 *
 * Usage: bun scripts/build-chat-rollouts.ts [--input F] [--out DIR]
 *        [--soul F] [--limit N] [--concurrency 2] [--model ID] [--teacher aphrody|antigravity] [--split-only]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import type { AphrodyChatMessage } from "@shenron/pipeline/aphrody";

export interface Triple {
	query: string;
	positive: string;
	negative?: string;
}

export interface GoldRow {
	query: string;
	expect: string[];
}

export interface RolloutRow {
	prompt: string;
	messages: [
		{ role: "user"; parts: [{ text: string }] },
		{ role: "model"; parts: [{ text: string }] },
	];
}

export type ChatFn = (
	messages: AphrodyChatMessage[]
) => Promise<{ answer: string; model: string }>;

export const GOLD_PERCENT = 10;
export const MAX_ANSWER_CHARS = 1200;
export const MIN_OVERLAP_TOKENS = 2;

// --- hashing (port of aphrody_train/hashing.py) ---------------------------

const SEGMENT_SPLIT = /[.!?;:\n\r。！？]+/u;
const SEGMENT_STRIP = new Set(" \t\"'`«»“”‘’()[]{}<>,-–—*#_|.!?;:…。！？");
const MIN_SEGMENT_CHARS = 12;

/** `normalize_text`: NFC, optional casefold, whitespace collapsed. */
export function normalizeText(text: string, casefold = false): string {
	let value = text.normalize("NFC");
	if (casefold) value = value.toLowerCase().normalize("NFC");
	return value.split(/\s+/u).filter(Boolean).join(" ");
}

function stripChars(value: string): string {
	const chars = [...value];
	let start = 0;
	let end = chars.length;
	while (start < end && SEGMENT_STRIP.has(chars[start] as string)) start++;
	while (end > start && SEGMENT_STRIP.has(chars[end - 1] as string)) end--;
	return chars.slice(start, end).join("");
}

function segmentKey(text: string): string {
	return stripChars(normalizeText(text, true));
}

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

/** `segment_hashes`: whole text plus each sentence segment >= 12 chars. */
export function segmentHashes(text: string): Set<string> {
	const out = new Set<string>();
	const whole = segmentKey(text);
	if (whole) out.add(sha256(whole));
	for (const part of text.split(SEGMENT_SPLIT)) {
		const value = segmentKey(part);
		if ([...value].length >= MIN_SEGMENT_CHARS && value !== whole) out.add(sha256(value));
	}
	return out;
}

function* iterStrings(value: unknown): Generator<string> {
	if (typeof value === "string") yield value;
	else if (Array.isArray(value)) for (const item of value) yield* iterStrings(item);
	else if (value && typeof value === "object")
		for (const item of Object.values(value)) yield* iterStrings(item);
}

/** Gold text keys, mirroring `GoldIndex.add_query` / `add_target` (non-URL). */
export function goldKeys(gold: GoldRow[]): Set<string> {
	const keys = new Set<string>();
	for (const row of gold)
		for (const text of [row.query, ...row.expect])
			if (text.trim()) for (const key of segmentHashes(text.trim())) keys.add(key);
	return keys;
}

export function overlapsGold(value: unknown, keys: Set<string>): boolean {
	for (const text of iterStrings(value))
		for (const key of segmentHashes(text)) if (keys.has(key)) return true;
	return false;
}

// --- split ----------------------------------------------------------------

export function normalizeQuery(query: string): string {
	return normalizeText(query, true);
}

/** Deterministic bucket in [0, 100) from sha256 of the normalized query. */
export function queryBucket(query: string): number {
	return Number.parseInt(sha256(normalizeQuery(query)).slice(0, 8), 16) % 100;
}

export function isGoldQuery(query: string): boolean {
	return queryBucket(query) < GOLD_PERCENT;
}

export function firstLine(text: string): string {
	return (
		text
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.find(Boolean) ?? ""
	);
}

export interface Split {
	gold: GoldRow[];
	candidates: Triple[];
	duplicates: number;
	invalid: number;
}

/** Dedupes on normalized query (first wins) then splits by hash bucket. */
export function splitTriples(triples: Iterable<unknown>): Split {
	const seen = new Set<string>();
	const gold: GoldRow[] = [];
	const candidates: Triple[] = [];
	let duplicates = 0;
	let invalid = 0;
	for (const raw of triples) {
		const row = raw as Partial<Triple> | null;
		if (
			!row ||
			typeof row.query !== "string" ||
			typeof row.positive !== "string" ||
			!row.query.trim() ||
			!row.positive.trim()
		) {
			invalid++;
			continue;
		}
		const key = normalizeQuery(row.query);
		if (seen.has(key)) {
			duplicates++;
			continue;
		}
		seen.add(key);
		const query = row.query.trim();
		if (isGoldQuery(query)) {
			const line = firstLine(row.positive);
			gold.push({ query, expect: line ? [line] : [] });
		} else {
			candidates.push({ query, positive: row.positive });
		}
	}
	return { gold, candidates, duplicates, invalid };
}

// --- prompt ---------------------------------------------------------------

/** Extracts the frontmatter `tone` of SOUL.md; falls back to the canonical tone. */
export function soulTone(soul: string): string {
	const match = /^tone:\s*"?([^"\n]+)"?\s*$/mu.exec(soul);
	return match?.[1]?.trim() || "solennel, imposant, omniscient et bienveillant";
}

export function personaSystem(tone: string): string {
	return [
		"Tu es Shenron, le Dragon Sacré de l'univers Dragon Ball.",
		`Ton : ${tone}. Réponds toujours en français, de façon claire, concise et structurée.`,
		"Appuie chaque affirmation sur une source canonique et cite-la (tome, chapitre, databook, guide ou fiche).",
		"Si l'information n'est pas établie par tes sources, dis-le simplement au lieu d'inventer.",
	].join("\n");
}

export function teacherMessages(
	tone: string,
	question: string,
	evidence: string
): AphrodyChatMessage[] {
	return [
		{
			role: "system",
			content: [
				personaSystem(tone),
				"",
				"Pour cette question, ta seule source est l'extrait ci-dessous. N'utilise aucune autre connaissance.",
				"Rédige une réponse en français de 1 à 5 phrases, fidèle à l'extrait, en citant la source (titre ou référence de l'extrait).",
				"Ne mentionne jamais l'extrait comme « fourni », ni toi-même, ni une quelconque technologie.",
				"",
				"<source>",
				evidence.trim(),
				"</source>",
			].join("\n"),
		},
		{ role: "user", content: question },
	];
}

// --- quality filter ---------------------------------------------------------

const REFUSAL =
	/(je ne (peux|sais|suis) pas|je n['’]ai pas (assez|d['’]information|de donn)|d[ée]sol[ée]|impossible de r[ée]pondre|aucune information|pas d['’]information|l['’]extrait ne (pr[ée]cise|mentionne|contient|permet)|i cannot|i can['’]t|i['’]m sorry|as an ai)/iu;
const AI_CASED = /\b(IA|AI|LLM|GPT|ChatGPT|OpenAI|Anthropic|Claude|Gemini|Gemma|Mistral|Llama|Qwen)\b/u;
const AI_FOLDED =
	/(intelligence artificielle|mod[eè]le (de langage|d['’]ia|linguistique)|language model|assistant virtuel|chatbot)/iu;

const STOPWORDS = new Set(
	"avec dans pour plus sont cette comme mais elle elles ils leur leurs nous vous sans sous entre aussi tout tous toute toutes être avoir fait était sont sera dont quel quelle quels quelles selon chez vers depuis alors donc ainsi après avant encore même très peut celui celle ceux the and that this with from have type titre source sources auteur éditeur publication catégorie".split(
		" "
	)
);

export function significantTokens(text: string): Set<string> {
	const out = new Set<string>();
	for (const raw of text.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
		const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(raw);
		if ((cjk && [...raw].length >= 2) || (/\d/u.test(raw) && raw.length >= 2)) out.add(raw);
		else if (raw.length >= 4 && !STOPWORDS.has(raw)) out.add(raw);
	}
	return out;
}

export function mentionsAi(text: string): boolean {
	return AI_CASED.test(text) || AI_FOLDED.test(text);
}

export function isRefusal(text: string): boolean {
	return REFUSAL.test(text);
}

export type RejectReason = "empty" | "too_long" | "refusal" | "no_overlap" | "ai_mention";

export function rejectReason(answer: string, positive: string): RejectReason | null {
	const text = answer.trim();
	if (!text) return "empty";
	if (text.length > MAX_ANSWER_CHARS) return "too_long";
	if (mentionsAi(text)) return "ai_mention";
	if (isRefusal(text)) return "refusal";
	const evidence = significantTokens(positive);
	let shared = 0;
	for (const token of significantTokens(text)) if (evidence.has(token)) shared++;
	if (shared < MIN_OVERLAP_TOKENS) return "no_overlap";
	return null;
}

export function rolloutRow(question: string, answer: string): RolloutRow {
	return {
		prompt: question,
		messages: [
			{ role: "user", parts: [{ text: question }] },
			{ role: "model", parts: [{ text: answer.trim() }] },
		],
	};
}

// --- generation -----------------------------------------------------------

/** Text of a Cloud Code `generateContent` reply, thought parts excluded. */
export function antigravityAnswer(raw: unknown): string {
	const parts = (raw as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }> })
		?.candidates?.[0]?.content?.parts;
	if (!Array.isArray(parts)) return "";
	return parts
		.filter((part) => typeof part.text === "string" && part.thought !== true)
		.map((part) => part.text as string)
		.join("")
		.trim();
}

export const ANTIGRAVITY_TIMEOUT_MS = 180_000;
const ERROR_TAIL_CHARS = 300;

/** `APHRODY_ANTIGRAVITY_TIMEOUT_MS` when a positive number, else the default. */
export function antigravityTimeoutMs(env: Record<string, string | undefined> = Bun.env): number {
	const value = Number(env.APHRODY_ANTIGRAVITY_TIMEOUT_MS);
	return Number.isFinite(value) && value > 0 ? value : ANTIGRAVITY_TIMEOUT_MS;
}

const liveTeachers = new Set<{ kill: (signal?: NodeJS.Signals) => void }>();

/** Stops in-flight teacher processes so an interrupted run leaves no orphan behind. */
export function killTeachers(): void {
	for (const proc of liveTeachers) proc.kill("SIGKILL");
}

/** Teacher through `aphrody antigravity chat` (network model, no local GPU). */
export async function antigravityChat(
	messages: Array<{ role: string; content: string }>,
	model?: string,
	timeoutMs: number = antigravityTimeoutMs(),
): Promise<{ answer: string; model: string }> {
	const prompt = messages.map((message) => `[${message.role}]\n${message.content}`).join("\n\n");
	const args = ["antigravity", "chat", "--prompt", prompt, ...(model ? ["--model", model] : [])];
	const proc = Bun.spawn([Bun.env.APHRODY_BIN ?? "aphrody", ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
	liveTeachers.add(proc);
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill("SIGKILL");
	}, timeoutMs);
	let stdout: string;
	let stderr: string;
	let code: number | null;
	try {
		[stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
	} finally {
		clearTimeout(timer);
		liveTeachers.delete(proc);
	}
	if (timedOut) throw new Error(`antigravity chat timed out after ${timeoutMs} ms`);
	if (code !== 0) {
		const detail = stderr.trim().slice(-ERROR_TAIL_CHARS);
		throw new Error(`antigravity chat exited ${code ?? proc.signalCode}${detail ? `: ${detail}` : ""}`);
	}
	let raw: { modelVersion?: string };
	try {
		raw = JSON.parse(stdout) as { modelVersion?: string };
	} catch {
		throw new Error("antigravity chat returned non-JSON output");
	}
	return { answer: antigravityAnswer(raw), model: `antigravity/${raw.modelVersion ?? model ?? "default"}` };
}

// --- options ----------------------------------------------------------------

export const TEACHERS = ["aphrody", "antigravity"] as const;
export type Teacher = (typeof TEACHERS)[number];

/** Strict integer option: NaN, fractions and values below `min` are errors, never silent defaults. */
export function parseIntOption(name: string, raw: string, min: number): number {
	const value = Number(raw.trim());
	if (!/^\d+$/u.test(raw.trim()) || !Number.isSafeInteger(value) || value < min)
		throw new Error(`--${name} must be an integer >= ${min}, got "${raw}"`);
	return value;
}

export function parseTeacher(raw: string): Teacher {
	if ((TEACHERS as readonly string[]).includes(raw)) return raw as Teacher;
	throw new Error(`--teacher must be one of ${TEACHERS.join("|")}, got "${raw}"`);
}

export interface GenerateOptions {
	candidates: Triple[];
	goldKeys: Set<string>;
	done: Set<string>;
	tone: string;
	chat: ChatFn;
	limit?: number;
	concurrency?: number;
	onAccept?: (row: RolloutRow) => void;
	log?: (line: string) => void;
}

export interface GenerateStats {
	attempted: number;
	accepted: number;
	skippedDone: number;
	skippedGoldOverlap: number;
	errors: number;
	rejected: Record<RejectReason | "gold_overlap", number>;
	models: Record<string, number>;
}

export async function generate(o: GenerateOptions): Promise<GenerateStats> {
	const stats: GenerateStats = {
		attempted: 0,
		accepted: 0,
		skippedDone: 0,
		skippedGoldOverlap: 0,
		errors: 0,
		rejected: { empty: 0, too_long: 0, refusal: 0, no_overlap: 0, ai_mention: 0, gold_overlap: 0 },
		models: {},
	};
	const queue: Triple[] = [];
	for (const candidate of o.candidates) {
		if (o.done.has(normalizeQuery(candidate.query))) {
			stats.skippedDone++;
			continue;
		}
		if (overlapsGold(candidate.query, o.goldKeys)) {
			stats.skippedGoldOverlap++;
			continue;
		}
		if (o.limit !== undefined && queue.length >= o.limit) break;
		queue.push(candidate);
	}
	let next = 0;
	const worker = async () => {
		while (next < queue.length) {
			const candidate = queue[next++] as Triple;
			stats.attempted++;
			let result: { answer: string; model: string };
			try {
				result = await o.chat(teacherMessages(o.tone, candidate.query, candidate.positive));
			} catch (error) {
				stats.errors++;
				o.log?.(`error: ${error instanceof Error ? error.message : String(error)}`);
				continue;
			}
			const reason = rejectReason(result.answer ?? "", candidate.positive);
			if (reason) {
				stats.rejected[reason]++;
				continue;
			}
			const row = rolloutRow(candidate.query, result.answer);
			if (overlapsGold(row, o.goldKeys)) {
				stats.rejected.gold_overlap++;
				continue;
			}
			o.done.add(normalizeQuery(candidate.query));
			stats.accepted++;
			stats.models[result.model] = (stats.models[result.model] ?? 0) + 1;
			o.onAccept?.(row);
		}
	};
	await Promise.all(
		Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 2, queue.length || 1)) }, worker)
	);
	return stats;
}

// --- io ---------------------------------------------------------------------

export function atomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, content, { mode: 0o600 });
	renameSync(tmp, path);
}

export function toJsonl(rows: unknown[]): string {
	return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}

export function parseJsonl(text: string): unknown[] {
	return text
		.split("\n")
		.filter((line) => line.trim())
		.map((line, index) => {
			try {
				return JSON.parse(line);
			} catch {
				throw new Error(`invalid JSON at line ${index + 1}`);
			}
		});
}

async function main(): Promise<void> {
	const home = homedir();
	const { values } = parseArgs({
		options: {
			input: { type: "string", default: join(home, ".aphrody/workspaces/dbfr/training/triples.jsonl") },
			out: { type: "string", default: join(home, ".aphrody/private/training/shenron/chat") },
			soul: { type: "string", default: join(home, ".aphrody/workspaces/dbfr/SOUL.md") },
			limit: { type: "string" },
			concurrency: { type: "string", default: "2" },
			model: { type: "string" },
			teacher: { type: "string", default: "aphrody" },
			"split-only": { type: "boolean", default: false },
		},
	});
	// Validate before any file is read or written.
	const teacher = parseTeacher(values.teacher as string);
	const limit = values.limit === undefined ? undefined : parseIntOption("limit", values.limit, 0);
	const concurrency = parseIntOption("concurrency", values.concurrency as string, 1);
	const inputText = readFileSync(values.input as string, "utf8");
	const sourceSha256 = sha256(inputText);
	const split = splitTriples(parseJsonl(inputText));
	const out = values.out as string;
	const rolloutsPath = join(out, "rollouts.jsonl");
	const goldPath = join(out, "gold.jsonl");
	atomicWrite(goldPath, toJsonl(split.gold));
	const keys = goldKeys(split.gold);

	const rows: RolloutRow[] = existsSync(rolloutsPath)
		? (parseJsonl(readFileSync(rolloutsPath, "utf8")) as RolloutRow[])
		: [];
	const kept = rows.filter((row) => !overlapsGold(row, keys));
	const done = new Set(kept.map((row) => normalizeQuery(row.prompt)));
	const tone = soulTone(existsSync(values.soul as string) ? readFileSync(values.soul as string, "utf8") : "");

	let stats: GenerateStats | null = null;
	if (!values["split-only"]) {
		const chat: ChatFn =
			teacher === "antigravity"
				? (messages) => antigravityChat(messages, values.model)
				: await (async () => {
						const { AphrodyComputeClient } = await import("@shenron/pipeline/aphrody");
						const client = new AphrodyComputeClient();
						return (messages) => client.chat(messages, values.model);
					})();
		// Interrupting a run keeps the rows accepted since the last periodic flush.
		for (const signal of ["SIGINT", "SIGTERM"] as const)
			process.once(signal, () => {
				killTeachers();
				atomicWrite(rolloutsPath, toJsonl(kept));
				console.error(`${signal}: flushed ${kept.length} rollouts (manifest not updated)`);
				process.exit(signal === "SIGINT" ? 130 : 143);
			});
		let sinceFlush = 0;
		stats = await generate({
			candidates: split.candidates,
			goldKeys: keys,
			done,
			tone,
			chat,
			limit,
			concurrency,
			onAccept: (row) => {
				kept.push(row);
				if (++sinceFlush >= 25) {
					sinceFlush = 0;
					atomicWrite(rolloutsPath, toJsonl(kept));
				}
			},
			log: (line) => console.error(line),
		});
	}
	atomicWrite(rolloutsPath, toJsonl(kept));
	const manifest = {
		generatedAt: new Date().toISOString(),
		source: { path: values.input, sha256: sourceSha256 },
		split: {
			goldPercent: GOLD_PERCENT,
			gold: split.gold.length,
			candidates: split.candidates.length,
			duplicates: split.duplicates,
			invalid: split.invalid,
		},
		rollouts: kept.length,
		droppedExistingGoldOverlap: rows.length - kept.length,
		teacher: { kind: teacher, requestedModel: values.model ?? null, models: stats?.models ?? {} },
		run: stats,
	};
	atomicWrite(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	console.log(JSON.stringify({ out, rollouts: kept.length, gold: split.gold.length, run: stats }));
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
