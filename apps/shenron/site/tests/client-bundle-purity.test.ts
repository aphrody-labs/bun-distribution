// SPDX-License-Identifier: Apache-2.0
/**
 * Pureté du bundle client (W5-TOOL-01, docs/STACK.md §4.2) : depuis chaque
 * module `"use client"` d'`apps/shenron/site/src`, le graphe d'imports statiques
 * (relatifs, alias `@/`, et entrées source des paquets `@shenron/*`) ne doit
 * jamais atteindre `@shenron/pipeline/ai`, `@shenron/db/{postgres-js,sql,bun-sql,redis}`,
 * `@shenron/api/server` ni `@shenron/pipeline/aphrody`.
 *
 * Les imports `import type` sont effacés à la compilation et ne comptent pas ;
 * un module `"use server"` n'est jamais embarqué côté client (Next ne transmet
 * qu'une référence d'action) : le parcours s'y arrête.
 */
import { describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { stripNonCode } from "@shenron/config/guards";

const SITE = resolve(import.meta.dir, "..");
const SRC = join(SITE, "src");
const ROOT = resolve(SITE, "..", "..");

const FORBIDDEN = [
	"@shenron/pipeline/ai",
	"@shenron/db/postgres-js",
	"@shenron/db/sql",
	"@shenron/db/bun-sql",
	"@shenron/db/redis",
	"@shenron/api/server",
	"@shenron/pipeline/aphrody",
];

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];
const toPosix = (p: string) => p.replaceAll("\\", "/");

function isForbidden(specifier: string): boolean {
	return FORBIDDEN.some((f) => specifier === f || specifier.startsWith(`${f}/`));
}

function directive(source: string, name: "use client" | "use server"): boolean {
	return new RegExp(String.raw`^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*["']${name}["']`).test(
		source
	);
}

/** Runtime (non type-only) import specifiers of a module. */
export function runtimeImports(source: string): string[] {
	const code = stripNonCode(source);
	const specifiers: string[] = [];
	const readAt = (quoteIndex: number): string | null => {
		const quote = source[quoteIndex];
		if (quote !== "'" && quote !== '"') return null;
		const end = source.indexOf(quote, quoteIndex + 1);
		return end === -1 ? null : source.slice(quoteIndex + 1, end);
	};
	const patterns: { re: RegExp; typeAware: boolean }[] = [
		{ re: /\b(?:import|export)\s+(type\s+)?([\w$*{}\s,]+?)\s*\bfrom\s*(["'])/g, typeAware: true },
		{ re: /\bimport\s*(["'])/g, typeAware: false },
		{ re: /\bimport\s*\(\s*(["'])/g, typeAware: false },
		{ re: /\brequire\s*\(\s*(["'])/g, typeAware: false },
	];
	for (const { re, typeAware } of patterns) {
		for (const match of code.matchAll(re)) {
			if (typeAware) {
				if (match[1]) continue;
				// `import { type A, type B } from` is erased as well.
				const clause = (match[2] ?? "").trim();
				const braces = /^\{([\s\S]*)\}$/.exec(clause);
				if (braces) {
					const names = (braces[1] ?? "")
						.split(",")
						.map((n) => n.trim())
						.filter(Boolean);
					if (names.length > 0 && names.every((n) => n.startsWith("type "))) continue;
				}
			}
			const specifier = readAt((match.index ?? 0) + match[0].length - 1);
			if (specifier !== null) specifiers.push(specifier);
		}
	}
	return specifiers;
}

function resolveFile(base: string): string | null {
	if (existsSync(base) && statSync(base).isFile()) return base;
	for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
	const stripped = base.replace(/\.(js|jsx|mjs)$/, "");
	if (stripped !== base)
		for (const ext of EXTENSIONS) if (existsSync(stripped + ext)) return stripped + ext;
	if (existsSync(base) && statSync(base).isDirectory())
		for (const ext of EXTENSIONS)
			if (existsSync(join(base, `index${ext}`))) return join(base, `index${ext}`);
	return null;
}

interface Manifest {
	exports?: Record<string, unknown> | string;
}

const packageDirs = new Map<string, string>();
for (const group of ["packages", "apps"]) {
	const groupDir = join(ROOT, group);
	if (!existsSync(groupDir)) continue;
	for (const entry of readdirSync(groupDir)) {
		const manifestFile = join(groupDir, entry, "package.json");
		if (!existsSync(manifestFile)) continue;
		const name = (JSON.parse(readFileSync(manifestFile, "utf8")) as { name?: string }).name;
		if (name?.startsWith("@shenron/")) packageDirs.set(name, join(groupDir, entry));
	}
}

function exportTarget(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const condition of ["browser", "import", "default", "types"]) {
			const target = exportTarget(record[condition]);
			if (target) return target;
		}
	}
	return null;
}

/** Source file of a `@shenron/*` specifier (source-first exports, wildcards). */
function resolveWorkspace(specifier: string): string | null {
	const name = specifier.split("/").slice(0, 2).join("/");
	const dir = packageDirs.get(name);
	if (!dir) return null;
	const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
	const sub = specifier === name ? "." : `./${specifier.slice(name.length + 1)}`;
	const exportsField =
		typeof manifest.exports === "string" ? { ".": manifest.exports } : (manifest.exports ?? {});
	for (const [key, value] of Object.entries(exportsField)) {
		const target = exportTarget(value);
		if (!target) continue;
		if (key === sub) return resolveFile(join(dir, target));
		const star = key.indexOf("*");
		if (star !== -1 && sub.startsWith(key.slice(0, star)) && sub.endsWith(key.slice(star + 1))) {
			const middle = sub.slice(star, sub.length - (key.length - star - 1));
			return resolveFile(join(dir, target.replace("*", middle)));
		}
	}
	return null;
}

function resolveSpecifier(fromFile: string, specifier: string, srcDir: string): string | null {
	if (specifier.startsWith("./") || specifier.startsWith("../"))
		return resolveFile(resolve(dirname(fromFile), specifier));
	if (specifier.startsWith("@/")) return resolveFile(join(srcDir, specifier.slice(2)));
	if (specifier.startsWith("@shenron/")) return resolveWorkspace(specifier);
	return null;
}

/** Forbidden reaches of one client entry: `chain` from the entry to the offending import. */
export function forbiddenReaches(entry: string, srcDir: string): string[][] {
	const found: string[][] = [];
	const seen = new Set<string>([entry]);
	const queue: { file: string; chain: string[] }[] = [{ file: entry, chain: [entry] }];
	while (queue.length > 0) {
		const { file, chain } = queue.shift() as { file: string; chain: string[] };
		const source = readFileSync(file, "utf8");
		if (file !== entry && directive(source, "use server")) continue;
		for (const specifier of runtimeImports(source)) {
			if (isForbidden(specifier)) {
				found.push([...chain, specifier]);
				continue;
			}
			const next = resolveSpecifier(file, specifier, srcDir);
			if (!next || seen.has(next) || /\.(css|json|svg)$/.test(next)) continue;
			seen.add(next);
			queue.push({ file: next, chain: [...chain, next] });
		}
	}
	return found;
}

function listSources(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules") out.push(...listSources(full));
		} else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
	}
	return out;
}

function clientEntries(srcDir: string): string[] {
	return listSources(srcDir).filter((file) => directive(readFileSync(file, "utf8"), "use client"));
}

const describeChain = (chain: string[]) =>
	chain.map((step) => (step.startsWith("@") ? step : toPosix(relative(ROOT, step)))).join(" -> ");

describe("client bundle purity (docs/STACK.md §4.2)", () => {
	it("finds the site's client modules", () => {
		expect(clientEntries(SRC).length).toBeGreaterThan(50);
	});

	it("no 'use client' module reaches a server-only @shenron entry", () => {
		const offences = clientEntries(SRC).flatMap((entry) =>
			forbiddenReaches(entry, SRC).map(describeChain)
		);
		expect(offences).toEqual([]);
	});

	it("detects a client module importing @shenron/pipeline/ai, directly or transitively", () => {
		const dir = mkdtempSync(join(SITE, ".purity-fixture-"));
		try {
			writeFileSync(join(dir, "helper.ts"), 'export { generateText } from "@shenron/pipeline/ai";\n');
			writeFileSync(
				join(dir, "typed.ts"),
				'import type { X } from "@shenron/pipeline/aphrody";\nexport type Y = X;\n'
			);
			writeFileSync(
				join(dir, "action.ts"),
				'"use server";\nimport { db } from "@shenron/db/sql";\nexport async function run() { return db; }\n'
			);
			writeFileSync(
				join(dir, "widget.tsx"),
				[
					'"use client";',
					'import { run } from "./action";',
					'import type { Y } from "./typed";',
					'import { generateText } from "./helper";',
					"export const w = [run, generateText] as unknown as Y;",
					"",
				].join("\n")
			);
			const entries = clientEntries(dir);
			expect(entries.map((f) => toPosix(relative(dir, f)))).toEqual(["widget.tsx"]);
			const reaches = forbiddenReaches(entries[0] as string, dir);
			expect(reaches).toHaveLength(1);
			expect(reaches[0]?.at(-1)).toBe("@shenron/pipeline/ai");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
