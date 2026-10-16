/**
 * Garde-fou de portabilité : `@rosegriffon/achillea-core` doit rester
 * importable dans un navigateur, un React Server Component Next.js, une edge
 * function et un binaire Bun. Un seul `import "node:fs"` glissé dans un
 * domaine suffit à casser la cible web — ce test l'attrape en CI.
 */

import { describe, expect, test } from "bun:test";

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "src");

/** Imports qui trahissent un couplage à un runtime ou à un framework. */
const FORBIDDEN = [
	/from\s+["']node:/u,
	/from\s+["']bun:/u,
	/require\(\s*["']node:/u,
	/from\s+["']@angular\//u,
	/from\s+["']react["']/u,
	/from\s+["']rxjs["']/u,
	/from\s+["']discord\.js["']/u,
	/from\s+["']@mikro-orm\//u,
	/from\s+["']tsyringe["']/u,
	/\bBun\./u,
	/\bprocess\.env\b/u,
	/\bdocument\./u,
	/\bwindow\./u,
	/\blocalStorage\b/u,
];

/** Retire commentaires de ligne, de bloc et littéraux de chaîne. */
function stripNonCode(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//gu, " ")
		.replace(/(^|[^:])\/\/.*$/gmu, "$1")
		.replace(/`(?:\\.|[^`\\])*`/gu, "``")
		.replace(/'(?:\\.|[^'\\])*'/gu, "''");
}

async function sourceFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
	}
	return files;
}

describe("portabilité", () => {
	test("aucune source de @core ne touche un runtime ou un framework", async () => {
		const files = await sourceFiles(SRC);
		expect(files.length).toBeGreaterThan(20);

		const offenders: string[] = [];
		for (const file of files) {
			const content = stripNonCode(await readFile(file, "utf8"));
			for (const pattern of FORBIDDEN) {
				if (pattern.test(content)) {
					offenders.push(`${file.slice(SRC.length + 1)} → ${pattern}`);
				}
			}
		}

		expect(offenders).toEqual([]);
	});

	test("les seules dépendances runtime déclarées sont universelles", async () => {
		const manifest = JSON.parse(
			await readFile(join(import.meta.dir, "..", "package.json"), "utf8")
		) as { dependencies?: Record<string, string> };

		expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
			"@casl/ability",
			"@rosegriffon/achillea-types",
			"@sindresorhus/transliterate",
		]);
	});

	test("chaque domaine exporté existe et expose au moins un symbole", async () => {
		const manifest = JSON.parse(
			await readFile(join(import.meta.dir, "..", "package.json"), "utf8")
		) as { exports: Record<string, string> };

		for (const [subpath, target] of Object.entries(manifest.exports)) {
			const mod = (await import(join(import.meta.dir, "..", target))) as Record<
				string,
				unknown
			>;
			expect(Object.keys(mod).length, `${subpath} est vide`).toBeGreaterThan(0);
		}
	});
});
