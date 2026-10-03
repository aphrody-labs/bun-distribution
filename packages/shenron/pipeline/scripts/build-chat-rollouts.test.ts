// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";
import {
	ANTIGRAVITY_TIMEOUT_MS,
	antigravityChat,
	antigravityTimeoutMs,
	generate,
	goldKeys,
	isGoldQuery,
	isRefusal,
	mentionsAi,
	overlapsGold,
	parseIntOption,
	parseTeacher,
	queryBucket,
	rejectReason,
	segmentHashes,
	splitTriples,
	type RolloutRow,
} from "./build-chat-rollouts";
import { runEval, sampleGold, scoreAnswer } from "./eval-chat-gold";

const positive =
	"Titre japonais : ドラゴンボール 大全集 4\nAuteur : Shueisha\nEncyclopédie du monde, des personnages et des lieux de Namek.";

describe("split", () => {
	test("bucket is deterministic and normalization-insensitive", () => {
		expect(queryBucket("Qui est Goku ?")).toBe(queryBucket("  qui   EST goku ?"));
		const queries = Array.from({ length: 2000 }, (_, i) => `question numéro ${i}`);
		const gold = queries.filter(isGoldQuery).length;
		expect(gold).toBeGreaterThan(120);
		expect(gold).toBeLessThan(280);
	});

	test("dedupes on normalized query and keeps sides disjoint", () => {
		const rows = Array.from({ length: 500 }, (_, i) => ({ query: `Q ${i}`, positive: `Réponse ${i}\nsuite` }));
		rows.push({ query: "q  0", positive: "doublon" }, { query: "", positive: "x" } as never);
		const a = splitTriples(rows);
		const b = splitTriples(rows);
		expect(a).toEqual(b);
		expect(a.duplicates).toBe(1);
		expect(a.invalid).toBe(1);
		expect(a.gold.length + a.candidates.length).toBe(500);
		const goldQ = new Set(a.gold.map((g) => g.query));
		expect(a.candidates.some((c) => goldQ.has(c.query))).toBe(false);
		const g = a.gold[0];
		expect(g?.expect[0]).toMatch(/^Réponse \d+$/);
	});
});

describe("filter", () => {
	const good = "Selon le Daizenshuu 4 (Shueisha), cette encyclopédie couvre le monde et les personnages de Namek.";
	test("accepts a grounded answer", () => expect(rejectReason(good, positive)).toBeNull());
	test("rejects empty", () => expect(rejectReason("  ", positive)).toBe("empty"));
	test("rejects too long", () => expect(rejectReason(`${good} `.repeat(20), positive)).toBe("too_long"));
	test("rejects refusal", () =>
		expect(rejectReason("Je ne sais pas, Shueisha encyclopédie personnages.", positive)).toBe("refusal"));
	test("rejects AI mention", () =>
		expect(rejectReason(`En tant qu'IA, ${good}`, positive)).toBe("ai_mention"));
	test("rejects ungrounded", () =>
		expect(rejectReason("Végéta affronte Freezer sur une planète lointaine.", positive)).toBe("no_overlap"));
});

describe("gold anti-join", () => {
	test("segment hashes match python semantics on quoted sentences", () => {
		const keys = segmentHashes("Qui est le père de Trunks ?");
		const embedded = segmentHashes("Intro. « Qui est le père de Trunks ? » Fin.");
		expect([...keys].some((k) => embedded.has(k))).toBe(true);
	});
	test("overlapsGold detects nested strings", () => {
		const keys = goldKeys([{ query: "Qui est le père de Trunks", expect: [] }]);
		expect(overlapsGold({ a: ["x", "Qui est le père de Trunks"] }, keys)).toBe(true);
		expect(overlapsGold("autre chose entièrement", keys)).toBe(false);
	});
});

describe("generate with fake fetch", () => {
	test("produces trainer-shaped rows, resumes and filters", async () => {
		const calls: unknown[] = [];
		const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body));
			calls.push(body);
			const question: string = body.messages.at(-1).content;
			const answer = question.includes("bad")
				? "Je suis un modèle de langage."
				: "D'après le Daizenshuu 4 de Shueisha, l'encyclopédie présente les personnages de Namek.";
			return new Response(JSON.stringify({ answer, model: "teacher-x" }), {
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
		const client = new AphrodyComputeClient({ baseUrl: "http://127.0.0.1:9", token: "t", fetcher });
		const accepted: RolloutRow[] = [];
		const stats = await generate({
			candidates: [
				{ query: "Que contient le Daizenshuu 4 ?", positive },
				{ query: "bad question", positive },
				{ query: "déjà faite", positive },
				{ query: "hors limite", positive },
			],
			goldKeys: new Set(),
			done: new Set(["déjà faite"]),
			tone: "solennel",
			chat: (m) => client.chat(m),
			limit: 2,
			concurrency: 2,
			onAccept: (row) => accepted.push(row),
		});
		expect(stats.skippedDone).toBe(1);
		expect(stats.attempted).toBe(2);
		expect(stats.accepted).toBe(1);
		expect(stats.rejected.ai_mention).toBe(1);
		expect(stats.models).toEqual({ "teacher-x": 1 });
		const row = accepted[0] as RolloutRow;
		expect(row.prompt).toBe("Que contient le Daizenshuu 4 ?");
		expect(row.messages[0]).toEqual({ role: "user", parts: [{ text: row.prompt }] });
		expect(row.messages[1].role).toBe("model");
		expect(Object.keys(row).toSorted()).toEqual(["messages", "prompt"]);
		const first = calls[0] as { messages: { role: string; content: string }[] };
		expect(first.messages[0]?.role).toBe("system");
		expect(first.messages[0]?.content).toContain("<source>");
		expect(first.messages[0]?.content).toContain("Shenron");
	});
});

describe("filter predicates", () => {
	test("refusal and AI mention are independent of length", () => {
		const long = `Je ne sais pas. ${"Namek ".repeat(300)}`;
		expect(rejectReason(long, positive)).toBe("too_long");
		expect(isRefusal(long)).toBe(true);
		expect(mentionsAi(`${long} En tant que modèle de langage.`)).toBe(true);
		expect(mentionsAi("Le Daizenshuu 4 présente Namek.")).toBe(false);
	});
});

describe("options", () => {
	test("parseIntOption is strict", () => {
		expect(parseIntOption("limit", "0", 0)).toBe(0);
		expect(parseIntOption("concurrency", " 3 ", 1)).toBe(3);
		for (const bad of ["", "abc", "1.5", "-1", "1e3", "0x10"])
			expect(() => parseIntOption("limit", bad, 0)).toThrow(/--limit must be an integer >= 0/);
		expect(() => parseIntOption("concurrency", "0", 1)).toThrow(/>= 1/);
	});
	test("parseTeacher rejects typos instead of falling back to the local teacher", () => {
		expect(parseTeacher("aphrody")).toBe("aphrody");
		expect(parseTeacher("antigravity")).toBe("antigravity");
		expect(() => parseTeacher("antigravty")).toThrow(/aphrody\|antigravity/);
	});
	test("antigravityTimeoutMs reads a positive override only", () => {
		expect(antigravityTimeoutMs({})).toBe(ANTIGRAVITY_TIMEOUT_MS);
		expect(antigravityTimeoutMs({ APHRODY_ANTIGRAVITY_TIMEOUT_MS: "2500" })).toBe(2500);
		for (const bad of ["0", "-5", "abc", ""])
			expect(antigravityTimeoutMs({ APHRODY_ANTIGRAVITY_TIMEOUT_MS: bad })).toBe(ANTIGRAVITY_TIMEOUT_MS);
	});
});

const scratch: string[] = [];
afterAll(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "chat-rollouts-"));
	scratch.push(dir);
	return dir;
}

function fakeAphrody(body: string): string {
	const path = join(scratchDir(), "aphrody");
	writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
	return path;
}

async function withBin<T>(bin: string, run: () => Promise<T>): Promise<T> {
	const previous = Bun.env.APHRODY_BIN;
	Bun.env.APHRODY_BIN = bin;
	try {
		return await run();
	} finally {
		if (previous === undefined) delete Bun.env.APHRODY_BIN;
		else Bun.env.APHRODY_BIN = previous;
	}
}

const reply = (text: string) =>
	JSON.stringify({
		candidates: [{ content: { parts: [{ text }, { text: "pensée", thought: true }] } }],
		modelVersion: "gemini-test",
	});

describe("antigravityChat", () => {
	const messages = [
		{ role: "system", content: "sys" },
		{ role: "user", content: "question" },
	];

	test("passes the prompt and model, drops thought parts", async () => {
		const bin = fakeAphrody(`printf '%s\\n' "$@" > "$0.args"\nprintf '%s' '${reply("Réponse finale")}'`);
		const result = await withBin(bin, () => antigravityChat(messages, "m"));
		expect(result).toEqual({ answer: "Réponse finale", model: "antigravity/gemini-test" });
		const args = readFileSync(`${bin}.args`, "utf8");
		expect(args.startsWith("antigravity\nchat\n--prompt\n[system]\nsys")).toBe(true);
		expect(args.endsWith("--model\nm\n")).toBe(true);
	});

	test("surfaces the exit code with the stderr tail", async () => {
		const bin = fakeAphrody("echo 'quota exceeded' >&2\nexit 3");
		await expect(withBin(bin, () => antigravityChat(messages))).rejects.toThrow(
			/exited 3: quota exceeded/,
		);
	});

	test("rejects non-JSON output", async () => {
		const bin = fakeAphrody("echo 'not json'");
		await expect(withBin(bin, () => antigravityChat(messages))).rejects.toThrow(/non-JSON/);
	});

	test("kills a hung teacher at the timeout", async () => {
		const bin = fakeAphrody("exec sleep 5");
		const started = performance.now();
		await expect(withBin(bin, () => antigravityChat(messages, undefined, 200))).rejects.toThrow(
			/timed out after 200 ms/,
		);
		expect(performance.now() - started).toBeLessThan(3000);
	});
});

describe("eval-chat-gold scoring", () => {
	const expectLine = ["Encyclopédie du monde, des personnages et des lieux de Namek."];

	test("scoreAnswer reports each signal on its own", () => {
		const long = `Je ne sais pas. personnages lieux ${"Namek ".repeat(300)}`;
		expect(scoreAnswer(long, expectLine)).toEqual({ grounded: true, refusal: true, aiMention: false });
		expect(
			scoreAnswer("En tant qu'IA : des personnages et des lieux de Namek.", expectLine),
		).toEqual({ grounded: true, refusal: false, aiMention: true });
		expect(scoreAnswer("Végéta affronte Freezer.", expectLine).grounded).toBe(false);
		expect(scoreAnswer("Namek personnages lieux", []).grounded).toBe(false);
	});

	test("sampleGold is stable and bounded", () => {
		const rows = Array.from({ length: 50 }, (_, i) => ({ query: `question ${i}` }));
		const a = sampleGold(rows, 7);
		expect(a).toHaveLength(7);
		expect(sampleGold(rows.toReversed(), 7)).toEqual(a);
		expect(sampleGold([{ query: "  " }, { query: "ok" }], 5).map((row) => row.query)).toEqual(["ok"]);
	});

	test("runEval counts per signal, errors and mean latency over answered rows", async () => {
		const logs: string[] = [];
		const answers: Record<string, string | Error> = {
			grounded: "Les personnages et les lieux de Namek.",
			refusal: "Désolé, je ne sais pas.",
			ai: "Je suis un modèle de langage.",
			boom: new Error("route down"),
		};
		const asked: string[] = [];
		const score = await runEval(
			Object.keys(answers).map((query) => ({ query, expect: expectLine })),
			"solennel",
			async (messages) => {
				const query = messages.at(-1)?.content ?? "";
				asked.push(`${messages[0]?.role}/${query}`);
				const value = answers[query] as string | Error;
				if (value instanceof Error) throw value;
				return { answer: value, model: "m" };
			},
			(line) => logs.push(line),
		);
		expect(asked).toEqual(["system/grounded", "system/refusal", "system/ai", "system/boom"]);
		expect(score).toMatchObject({ asked: 4, grounded: 1, refusal: 1, aiMention: 1, errors: 1 });
		expect(score.meanLatencyMs).toBeGreaterThanOrEqual(0);
		expect(logs).toEqual(["error: route down"]);
	});

	test("runEval over no rows reports zero latency", async () => {
		const score = await runEval([], "solennel", async () => ({ answer: "x", model: "m" }));
		expect(score).toEqual({ asked: 0, grounded: 0, refusal: 0, aiMention: 0, errors: 0, meanLatencyMs: 0 });
	});
});

function triplesFile(dir: string, count: number): string {
	const rows: { query: string; positive: string }[] = [];
	for (let i = 0; rows.length < count; i++) {
		const query = `Question synthétique numéro ${i}`;
		if (!isGoldQuery(query)) rows.push({ query, positive });
	}
	const path = join(dir, "triples.jsonl");
	writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
	return path;
}

describe("build-chat-rollouts CLI", () => {
	const script = join(import.meta.dir, "build-chat-rollouts.ts");

	test("rejects invalid options before touching any output", async () => {
		const dir = scratchDir();
		const input = triplesFile(dir, 5);
		for (const [flag, value, message] of [
			["--teacher", "antigravty", /--teacher must be one of/],
			["--limit", "abc", /--limit must be an integer/],
			["--concurrency", "0", /--concurrency must be an integer/],
		] as const) {
			const out = join(dir, `out${flag}`);
			const proc = Bun.spawn(
				[process.execPath, script, "--input", input, "--out", out, "--split-only", flag, value],
				{ stdout: "pipe", stderr: "pipe", stdin: "ignore" },
			);
			// oxlint-disable-next-line no-await-in-loop -- one child at a time keeps the cases independent
			const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
			expect(code).toBe(1);
			expect(stderr).toMatch(message);
			expect(existsSync(join(out, "gold.jsonl"))).toBe(false);
		}
	});

	test("SIGTERM flushes the rollouts accepted since the last periodic flush", async () => {
		const dir = scratchDir();
		const input = triplesFile(dir, 10);
		const out = join(dir, "out");
		const counter = join(dir, "calls");
		const answer = reply("D'après le Daizenshuu 4 de Shueisha, l'encyclopédie présente les personnages de Namek.");
		const bin = fakeAphrody(
			[
				`n=$(cat '${counter}' 2>/dev/null || echo 0)`,
				"n=$((n+1))",
				`echo $n > '${counter}'`,
				`if [ "$n" -le 3 ]; then printf '%s' '${answer}'; else exec sleep 10; fi`,
			].join("\n"),
		);
		const proc = Bun.spawn(
			[
				process.execPath,
				script,
				"--input",
				input,
				"--out",
				out,
				"--soul",
				join(dir, "missing-soul.md"),
				"--teacher",
				"antigravity",
				"--concurrency",
				"1",
			],
			{ env: { ...process.env, APHRODY_BIN: bin }, stdout: "pipe", stderr: "pipe", stdin: "ignore" },
		);
		const stderr = new Response(proc.stderr).text();
		for (let i = 0; i < 400 && !(existsSync(counter) && readFileSync(counter, "utf8").trim() === "4"); i++)
			// oxlint-disable-next-line no-await-in-loop -- polling for the fourth (hanging) teacher call
			await Bun.sleep(25);
		expect(readFileSync(counter, "utf8").trim()).toBe("4");
		proc.kill("SIGTERM");
		expect(await proc.exited).toBe(143);
		expect(await stderr).toMatch(/SIGTERM: flushed 3 rollouts/);
		const rows = readFileSync(join(out, "rollouts.jsonl"), "utf8").trim().split("\n");
		expect(rows).toHaveLength(3);
		expect(rows.map((line) => (JSON.parse(line) as RolloutRow).prompt)).toEqual(
			Array.from({ length: 3 }, () => expect.stringContaining("Question synthétique")),
		);
	});
});
