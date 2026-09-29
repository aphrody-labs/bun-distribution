// SPDX-License-Identifier: Apache-2.0
/**
 * Ratchet of `tsconfig.scripts.json` (W4-AI-01): the list of scripts excluded
 * from the type-check gate may only shrink. Removing an entry once the script
 * type-checks is the expected move; adding one fails here.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = fileURLToPath(new URL("..", import.meta.url));

/** Upper bound: every entry excluded when the gate was introduced. */
const BASELINE = [
	"scripts/_aphrody-remote-ocr.test.ts",
	"scripts/_rag-aphrody-sync.test.ts",
	"scripts/crawl-guides.ts",
	"scripts/ingest-databooks-rag.ts",
	"scripts/lib/aphrody-web-scrape.test.ts",
	"scripts/rag-harvest.ts",
	"scripts/rag-recon.ts",
	"scripts/selfhost-manga-pages.ts",
] as const;

/** Scripts repaired by W4-AI-01: they must stay covered by the gate. */
const MUST_BE_CHECKED = [
	"scripts/rag-build.ts",
	"scripts/rag-embed-vectors.ts",
	"scripts/rag-lexique.ts",
	"scripts/ingest-aphrody-rag.ts",
	"scripts/rag-resync-entites.ts",
	"scripts/rag-status.ts",
	"scripts/lib/script-env.ts",
] as const;

interface ScriptsTsconfig {
	extends?: string;
	include?: string[];
	exclude?: string[];
}

async function readConfig(): Promise<ScriptsTsconfig> {
	return (await Bun.file(join(PKG, "tsconfig.scripts.json")).json()) as ScriptsTsconfig;
}

function listScripts(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...listScripts(full));
		else if (name.endsWith(".ts")) out.push(relative(PKG, full).split(sep).join("/"));
	}
	return out;
}

describe("tsconfig.scripts.json ratchet", () => {
	it("extends the package tsconfig and includes every script", async () => {
		const cfg = await readConfig();
		expect(cfg.extends).toBe("./tsconfig.json");
		expect(cfg.include).toEqual(["scripts/**/*.ts"]);
	});

	it("never grows the exclude list beyond the baseline", async () => {
		const exclude = (await readConfig()).exclude ?? [];
		const added = exclude.filter((entry) => !(BASELINE as readonly string[]).includes(entry));
		expect(added).toEqual([]);
		expect(exclude.length).toBeLessThanOrEqual(BASELINE.length);
		expect(new Set(exclude).size).toBe(exclude.length);
	});

	it("excludes only exact existing files (no globs)", async () => {
		for (const entry of (await readConfig()).exclude ?? []) {
			expect(entry).not.toContain("*");
			expect(existsSync(join(PKG, entry))).toBe(true);
		}
	});

	it("keeps the repaired scripts under the gate", async () => {
		const exclude = (await readConfig()).exclude ?? [];
		const all = listScripts(join(PKG, "scripts"));
		for (const script of MUST_BE_CHECKED) {
			expect(all).toContain(script);
			expect(exclude).not.toContain(script);
		}
	});
});
