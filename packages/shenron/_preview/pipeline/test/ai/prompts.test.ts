// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildGroundingInstructions,
	buildSourcesBlock,
	DEFAULT_PERSONA,
	INJECTION_GUARD,
	isChitchat,
	isFallbackAnswer,
	PERSONA_IDS,
	PERSONAS,
	PROMPT_VERSION,
	resolvePersona,
} from "../../src/ai/prompts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const LLM_TS = join(ROOT, "apps", "bot", "src", "lib", "llm.ts");
const SITE_RAG_TS = join(ROOT, "apps", "site", "src", "lib", "site-rag.ts");

describe("personas", () => {
	test("ids, default and version", () => {
		expect([...PERSONA_IDS]).toEqual(["whis", "beerus", "shenron", "grandpretre", "kaio", "enma"]);
		expect(Object.keys(PERSONAS)).toEqual([...PERSONA_IDS]);
		expect(DEFAULT_PERSONA).toBe("whis");
		expect(PROMPT_VERSION).toBe("1");
	});

	test("resolvePersona normalises like persona() in llm.ts", () => {
		expect(resolvePersona("")).toBe("whis");
		expect(resolvePersona("Beerus")).toBe("beerus");
		expect(resolvePersona("Grand-Pretre")).toBe("grandpretre");
		expect(resolvePersona("Grand-Prêtre")).toBe("whis"); // same as llm.ts: non-ASCII letters are dropped
		expect(resolvePersona("grand pretre")).toBe("grandpretre");
		expect(resolvePersona("KAIO!")).toBe("kaio");
		expect(resolvePersona("vegeta")).toBe("whis");
	});

	test.skipIf(!existsSync(LLM_TS))("llm.ts takes personas from @shenron/pipeline/ai/prompts, no local copy", () => {
		const source = readFileSync(LLM_TS, "utf8");
		expect(source).toContain('from "@shenron/pipeline/ai/prompts"');
		for (const id of PERSONA_IDS) expect(source).not.toContain(PERSONAS[id].instructions);
		expect(isFallbackAnswer(PERSONAS.enma.fallback)).toBe(true);
		expect(isFallbackAnswer("autre")).toBe(false);
	});

	test("snapshot of persona ids and texts", () => {
		expect(PERSONAS).toMatchSnapshot();
	});
});

describe("grounding instructions", () => {
	test("every instruction contains INJECTION_GUARD", () => {
		for (const id of PERSONA_IDS) {
			for (const voice of [undefined, "site-short", "site-long"] as const) {
				for (const chitchat of [false, true]) {
					expect(buildGroundingInstructions(id, voice, { chitchat })).toContain(INJECTION_GUARD);
				}
			}
		}
	});

	test("bot voice = persona text, newline, llm.ts rules, guard", () => {
		const text = buildGroundingInstructions("beerus");
		expect(
			text.startsWith(`${PERSONAS.beerus.instructions}\nRègles absolues de comportement : 1. Joue`)
		).toBe(true);
		expect(text).toContain("4. Sers-toi du CONTEXTE");
		expect(buildGroundingInstructions("beerus", undefined, { chitchat: true })).toContain(
			"4. C'est un simple bavardage"
		);
		expect(text.endsWith(` ${INJECTION_GUARD}`)).toBe(true);
	});

	test.skipIf(!existsSync(SITE_RAG_TS))("site-rag.ts builds site-short instructions from @shenron/pipeline/ai/prompts", () => {
		const source = readFileSync(SITE_RAG_TS, "utf8");
		expect(source).toContain('from "@shenron/pipeline/ai/prompts"');
		expect(source).toContain('"site-short"');
		expect(source).not.toContain("Réponds en français comme");
		for (const persona of ["whis", "shenron"] as const) {
			const text = buildGroundingInstructions(persona, "site-short");
			expect(text).toContain(INJECTION_GUARD);
			expect(text).toContain(persona === "whis" ? "Whis" : "Shenron");
		}
		expect(buildGroundingInstructions("whis", "site-long")).not.toContain("brièvement");
	});
});

describe("buildSourcesBlock", () => {
	test("site format, per-hit and total limits", () => {
		const hits = [
			{ title: "Goku", url: "/wiki/personnages/son-goku", text: "abcdef" },
			{ title: "Vegeta", url: "/wiki/personnages/vegeta", text: "ghijkl" },
		];
		expect(buildSourcesBlock(hits, { perHit: 3, total: 10_000 })).toBe(
			"[1] Goku\nabc\nSource: /wiki/personnages/son-goku\n\n[2] Vegeta\nghi\nSource: /wiki/personnages/vegeta"
		);
		expect(buildSourcesBlock(hits, { perHit: 900, total: 10 })).toBe(
			"[1] Goku\nabcdef\nSource: /wiki/personnages/son-goku"
		);
	});
});

describe("isChitchat", () => {
	test("greetings vs questions", () => {
		expect(isChitchat("Bonjour !")).toBe(true);
		expect(isChitchat("  salut  ")).toBe(true);
		expect(isChitchat("qui es-tu ?")).toBe(true);
		expect(isChitchat("Qui est Goku ?")).toBe(false);
		expect(isChitchat(`bonjour ${"x".repeat(40)}`)).toBe(false);
	});
});
