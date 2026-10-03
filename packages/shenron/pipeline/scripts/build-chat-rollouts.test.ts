// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";
import {
	generate,
	goldKeys,
	isGoldQuery,
	overlapsGold,
	queryBucket,
	rejectReason,
	segmentHashes,
	splitTriples,
	type RolloutRow,
} from "./build-chat-rollouts";

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
		expect(Object.keys(row).sort()).toEqual(["messages", "prompt"]);
		const first = calls[0] as { messages: { role: string; content: string }[] };
		expect(first.messages[0]?.role).toBe("system");
		expect(first.messages[0]?.content).toContain("<source>");
		expect(first.messages[0]?.content).toContain("Shenron");
	});
});
