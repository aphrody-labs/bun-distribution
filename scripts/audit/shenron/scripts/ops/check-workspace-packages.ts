#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
//
// check-workspace-packages.ts — conformance of the unified @shenron/* packages
// (docs/STACK.md §4.3). Thin CLI over @shenron/config/guards.
//
// Usage:
//   bun run check:packages                       # all checks, fail on violations missing from the baseline
//   bun run check:packages --package @shenron/db       # one package (app checks skipped)
//   bun run check:packages --strict              # also fail while the `transitional` baseline is not empty
//   bun run check:packages --write-baseline      # record current violations (new ones go to `transitional`)
//   bun run check:packages --json                # machine-readable report on stdout
//
// Baseline: scripts/ops/check-workspace-packages.baseline.json, two sections:
//   transitional  must be empty at the end of Phase 1 (--strict enforces it)
//   phase2        each entry cites a ticket of docs/STACK.md §7.3
// A baseline entry that no longer matches a violation is stale: warning only.
// Checks reported as `warn` never fail (none since wave 5: the "use client" reach is an error).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
	ASSET_CLASSES,
	checkBrowserBundles,
	checkEmptyEnvImports,
	checkNoEscapingImports,
	checkPackageRuntimes,
	RUNTIME_CLASSES,
	stripNonCode,
	type Offence,
} from "../../../../../packages/shenron/config/src/guards";

const ROOT = resolve(import.meta.dir, "../..");
const BASELINE_FILE = join(ROOT, "scripts", "ops", "check-workspace-packages.baseline.json");

/** Modular framework packages checked against docs/STACK.md. */
const PACKAGES: Readonly<Record<string, string>> = {
	"@shenron/config": "packages/config",
	"@shenron/db": "packages/db",
	"@shenron/auth": "packages/auth",

	"@shenron/api": "packages/api",
	"@shenron/ui": "packages/ui",
};

/**
 * Allowed @shenron/* edges (docs/STACK.md §4.1). `dev` edges are allowed only
 * in devDependencies. Anything not listed is forbidden.
 */
const ALLOWED_EDGES: Readonly<
	Record<string, { runtime: readonly string[]; dev: readonly string[] }>
> = {
	"@shenron/config": { runtime: [], dev: [] },
	"@shenron/db": { runtime: ["@shenron/config"], dev: [] },
	"@shenron/auth": { runtime: ["@shenron/config"], dev: ["@shenron/db"] },

	"@shenron/api": { runtime: ["@shenron/config", "@shenron/db", "@shenron/auth"], dev: [] },
	"@shenron/ui": { runtime: [], dev: [] },
};

/** Subpath restrictions on allowed package edges. */
const EDGE_SUBPATHS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {};

/** Imports forbidden in a `"use client"` module (docs/STACK.md §4.2). */
const CLIENT_FORBIDDEN = [
	"@shenron/db/postgres-js",
	"@shenron/db/sql",
	"@shenron/db/bun-sql",
	"@shenron/api/server",
	"@shenron/pipeline",
];

type Severity = "error" | "warn";

interface Violation {
	/** Stable identity used by the baseline. */
	id: string;
	scope: string;
	check: string;
	detail: string;
	severity: Severity;
}

interface BaselineEntry {
	id: string;
	reason?: string;
	ticket?: string;
}

interface Baseline {
	$comment?: string;
	transitional: BaselineEntry[];
	phase2: BaselineEntry[];
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);
const has = (name: string) => args.includes(name);
const option = (name: string): string | undefined => {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
		if (arg === name) return args[i + 1];
	}
	return undefined;
};
if (has("--help") || has("-h")) {
	console.log(
		"Usage: bun scripts/ops/check-workspace-packages.ts [--package <name>] [--strict] [--write-baseline] [--json]"
	);
	process.exit(0);
}
const ONLY = option("--package");
const STRICT = has("--strict");
const WRITE_BASELINE = has("--write-baseline");
const JSON_OUT = has("--json");
if (ONLY && !PACKAGES[ONLY]) {
	console.error(`unknown package ${ONLY}; expected one of ${Object.keys(PACKAGES).join(", ")}`);
	process.exit(2);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface Manifest {
	name?: string;
	private?: boolean;
	main?: unknown;
	module?: unknown;
	files?: unknown;
	exports?: unknown;
	scripts?: Record<string, string>;
	shenron?: { runtime?: Record<string, unknown> };
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

function readJson<T>(file: string): T | null {
	if (!existsSync(file)) return null;
	try {
		return JSON.parse(readFileSync(file, "utf8")) as T;
	} catch {
		return null;
	}
}

/** JSONC → JSON: drops comments and trailing commas outside strings. */
function parseJsonc<T>(text: string): T | null {
	let out = "";
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i] as string;
		const next = text[i + 1];
		if (inString) {
			out += c;
			if (c === "\\") {
				out += next ?? "";
				i++;
			} else if (c === '"') inString = false;
			continue;
		}
		if (c === '"') {
			inString = true;
			out += c;
			continue;
		}
		if (c === "/" && next === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			out += "\n";
			continue;
		}
		if (c === "/" && next === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end === -1 ? text.length : end + 1;
			continue;
		}
		out += c;
	}
	try {
		return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as T;
	} catch {
		return null;
	}
}

function toPosix(p: string): string {
	return p.split(sep).join("/");
}

const WALK_PRUNE = new Set([
	"node_modules",
	".next",
	".next-build",
	".next-dev",
	".turbo",
	"dist",
	"build",
	"coverage",
	"fixtures",
	".git",
	"data",
	"assets",
	"public",
	"storage",
]);

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	if (!existsSync(dir)) return out;
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (WALK_PRUNE.has(entry.name)) continue;
			const full = join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (/\.(?:m|c)?tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
		}
	};
	walk(dir);
	return out;
}

/** Non-type import specifiers of a file, from blanked code (offsets preserved). */
function importSpecifiers(source: string): { specifier: string; index: number }[] {
	const code = stripNonCode(source);
	const out: { specifier: string; index: number }[] = [];
	const patterns = [
		/\b(?:import|export)\s+(?!type\s)(?:[\w$*{}\s,]+?)\s*\bfrom\s*(["'])/g,
		/\bimport\s*(["'])/g,
		/\bimport\s*\(\s*(["'])/g,
		/\brequire\s*\(\s*(["'])/g,
	];
	for (const re of patterns) {
		for (const match of code.matchAll(re)) {
			const quoteIndex = (match.index ?? 0) + match[0].length - 1;
			const quote = source[quoteIndex];
			if (quote !== '"' && quote !== "'") continue;
			const end = source.indexOf(quote, quoteIndex + 1);
			if (end === -1) continue;
			out.push({ specifier: source.slice(quoteIndex + 1, end), index: match.index ?? 0 });
		}
	}
	return out;
}

function shenronPackageOf(specifier: string): string | null {
	if (!specifier.startsWith("@shenron/")) return null;
	const [scope, name] = specifier.split("/");
	return `${scope}/${name}`;
}

const violations: Violation[] = [];
function report(scope: string, check: string, detail: string, severity: Severity = "error"): void {
	violations.push({ id: `${scope} | ${check} | ${detail}`, scope, check, detail, severity });
}
function reportOffences(scope: string, check: string, offences: Offence[]): void {
	for (const offence of offences)
		report(scope, check, `${offence.file}: ${offence.rule}: ${offence.excerpt}`);
}

// ── Package checks ───────────────────────────────────────────────────────────

function exportMap(manifest: Manifest): Record<string, unknown> {
	const field = manifest.exports;
	if (typeof field === "string") return { ".": field };
	if (field && typeof field === "object") return field as Record<string, unknown>;
	return {};
}

function exportTargets(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (value && typeof value === "object")
		return Object.values(value as Record<string, unknown>).flatMap(exportTargets);
	return [];
}

function wildcardMatches(packageDir: string, target: string): number {
	const [prefix = "", suffix = ""] = target.replace(/^\.\//, "").split("*");
	const base = join(packageDir, prefix);
	const dir = prefix.endsWith("/") ? base : dirname(base);
	if (!existsSync(dir)) return 0;
	return readdirSync(dir).filter((name) => {
		const rel = toPosix(relative(packageDir, join(dir, name)));
		return rel.startsWith(prefix) && rel.endsWith(suffix) && statSync(join(dir, name)).isFile();
	}).length;
}

async function checkPackage(name: string, relDir: string): Promise<void> {
	const dir = join(ROOT, relDir);
	const manifest = readJson<Manifest>(join(dir, "package.json"));
	if (!manifest) {
		report(name, "manifest", "package.json missing or unreadable");
		return;
	}

	// 1. exports targets exist, each entry has a class.
	const runtime = manifest.shenron?.runtime ?? {};
	for (const [key, value] of Object.entries(exportMap(manifest))) {
		for (const target of exportTargets(value)) {
			if (target.includes("*")) {
				if (wildcardMatches(dir, target) === 0)
					report(name, "exports", `${key} → ${target} matches no file`);
			} else if (!existsSync(join(dir, target))) {
				report(name, "exports", `${key} → ${target} does not exist`);
			}
		}
		const declared = runtime[key];
		const known = [...RUNTIME_CLASSES, ...ASSET_CLASSES] as readonly string[];
		if (typeof declared !== "string" || !known.includes(declared)) {
			report(name, "runtime-class", `${key} has no shenron.runtime class`);
		}
	}

	// 2. scripts, private, no build output.
	for (const script of ["type-check", "lint", "test"]) {
		if (!manifest.scripts?.[script]) report(name, "scripts", `missing script "${script}"`);
	}
	if (manifest.private !== true) report(name, "manifest", "private is not true");
	for (const field of ["main", "module", "files"] as const) {
		if (manifest[field] !== undefined) report(name, "manifest", `field "${field}" is set`);
	}
	if (
		Object.values(exportMap(manifest))
			.flatMap(exportTargets)
			.some((t) => /(^|\/)dist\//.test(t))
	) {
		report(name, "manifest", "exports point to dist/");
	}
	if (existsSync(join(dir, "dist"))) report(name, "manifest", "dist/ directory exists");
	const usesTsup =
		Object.values(manifest.scripts ?? {}).some((script) => /\btsup\b/.test(script)) ||
		Boolean(manifest.devDependencies?.tsup || manifest.dependencies?.tsup) ||
		existsSync(join(dir, "tsup.config.ts"));
	if (usesTsup) report(name, "manifest", "tsup is used");

	// 3. tsconfig.
	const tsconfigFile = join(dir, "tsconfig.json");
	const tsconfig = existsSync(tsconfigFile)
		? parseJsonc<{ extends?: string; compilerOptions?: Record<string, unknown> }>(
				readFileSync(tsconfigFile, "utf8")
			)
		: null;
	if (!tsconfig) {
		report(name, "tsconfig", "tsconfig.json missing or unreadable");
	} else {
		const expected =
			name === "@shenron/config"
				? /^\.\/tsconfig\/[\w-]+\.json$/
				: /^\.\.\/config\/tsconfig\/[\w-]+\.json$/;
		if (typeof tsconfig.extends !== "string" || !expected.test(tsconfig.extends)) {
			report(name, "tsconfig", "does not extend ../config/tsconfig/*.json");
		}
		const options = tsconfig.compilerOptions ?? {};
		for (const option of ["baseUrl", "paths", "ignoreDeprecations"]) {
			if (option in options) report(name, "tsconfig", `sets ${option}`);
		}
		const resolution = options.moduleResolution;
		if (typeof resolution === "string" && /^(node|node10|classic)$/i.test(resolution)) {
			report(name, "tsconfig", `moduleResolution ${resolution}`);
		}
	}

	// 4. dependency edges (manifest) and import edges (code).
	const allowed = ALLOWED_EDGES[name] ?? { runtime: [], dev: [] };
	for (const [group, deps] of [
		["dependencies", manifest.dependencies],
		["peerDependencies", manifest.peerDependencies],
		["devDependencies", manifest.devDependencies],
	] as const) {
		for (const dep of Object.keys(deps ?? {})) {
			if (!dep.startsWith("@shenron/")) continue;
			const ok =
				allowed.runtime.includes(dep) || (group === "devDependencies" && allowed.dev.includes(dep));
			if (!ok) report(name, "edges", `${group} → ${dep} is not allowed (§4.1)`);
		}
	}
	for (const file of sourceFiles(dir)) {
		const rel = toPosix(relative(ROOT, file));
		const isTest = /(^|\/)test\/|\.test\.tsx?$/.test(rel);
		for (const { specifier } of importSpecifiers(readFileSync(file, "utf8"))) {
			const target = shenronPackageOf(specifier);
			if (!target || target === name) continue;
			const ok = allowed.runtime.includes(target) || (isTest && allowed.dev.includes(target));
			if (!ok) {
				report(name, "edges", `${rel} imports ${specifier} (§4.1)`);
				continue;
			}
			const subpaths = EDGE_SUBPATHS[name]?.[target];
			if (subpaths && !subpaths.includes(specifier))
				report(
					name,
					"edges",
					`${rel} imports ${specifier}; only ${subpaths.join(", ")} is allowed`
				);
		}
	}

	// 5. runtime classes, escapes, empty-env imports, browser purity.
	// Manifest-level offences of the walker duplicate check 1 above.
	const manifestRules = new Set(["missing-runtime-class", "missing-export-target"]);
	reportOffences(
		name,
		"runtime",
		(await checkPackageRuntimes(dir)).filter((offence) => !manifestRules.has(offence.rule))
	);
	reportOffences(name, "escape", await checkNoEscapingImports(dir));
	reportOffences(name, "empty-env", await checkEmptyEnvImports(dir));
	reportOffences(name, "browser", await checkBrowserBundles(dir));
}

/** Cycles over every @shenron/* manifest edge (dependencies + dev + peer). */
function checkCycles(): void {
	const graph = new Map<string, string[]>();
	for (const [name, relDir] of Object.entries(PACKAGES)) {
		const manifest = readJson<Manifest>(join(ROOT, relDir, "package.json"));
		const deps = new Set<string>();
		for (const group of [
			manifest?.dependencies,
			manifest?.devDependencies,
			manifest?.peerDependencies,
		]) {
			for (const dep of Object.keys(group ?? {})) if (PACKAGES[dep] && dep !== name) deps.add(dep);
		}
		graph.set(name, [...deps].toSorted());
	}
	const state = new Map<string, "visiting" | "done">();
	const seen = new Set<string>();
	const visit = (node: string, path: string[]) => {
		if (state.get(node) === "done") return;
		if (state.get(node) === "visiting") {
			const cycle = [...path.slice(path.indexOf(node)), node].join(" → ");
			if (!seen.has(cycle)) {
				seen.add(cycle);
				report("graph", "cycle", cycle);
			}
			return;
		}
		state.set(node, "visiting");
		for (const next of graph.get(node) ?? []) visit(next, [...path, node]);
		state.set(node, "done");
	};
	for (const node of [...graph.keys()].toSorted()) visit(node, []);
}

/** Shenron packages are upstream of Aphrody repositories, never consumers. */
function checkDependencyDirection(): void {
	const root = readJson<{ workspaces?: { packages?: string[] } }>(join(ROOT, "package.json"));
	for (const workspace of root?.workspaces?.packages ?? []) {
		if (workspace.startsWith("../aphrody-"))
			report("workspace", "direction", `external Aphrody workspace ${workspace}`);
	}
	for (const dir of [
		ROOT,
		...["apps", "packages"].flatMap((kind) =>
			readdirSync(join(ROOT, kind), { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => join(ROOT, kind, entry.name))
		),
	]) {
		const manifest = readJson<Manifest>(join(dir, "package.json"));
		for (const group of [
			manifest?.dependencies,
			manifest?.devDependencies,
			manifest?.peerDependencies,
		]) {
			for (const [name, version] of Object.entries(group ?? {})) {
				if (name.startsWith("@aphrody/") || version.includes("../aphrody-"))
					report("workspace", "direction", `${relative(ROOT, dir) || "."} depends on ${name}`);
			}
		}
	}
	for (const dir of ["apps/bot/src", "apps/site/src", "packages", "scripts"])
		for (const file of sourceFiles(join(ROOT, dir))) {
			if (dir === "packages" && !toPosix(relative(ROOT, file)).includes("/src/")) continue;
			for (const { specifier } of importSpecifiers(readFileSync(file, "utf8"))) {
				if (specifier.startsWith("@aphrody/"))
					report("workspace", "direction", `${toPosix(relative(ROOT, file))} imports ${specifier}`);
			}
		}
}

// ── Application boundaries (§4.2) ────────────────────────────────────────────

function checkApps(): void {
	// apps/bot: no bun:ffi, @aphrody/bun, drawM3Scene*.
	for (const file of sourceFiles(join(ROOT, "apps", "bot"))) {
		const source = readFileSync(file, "utf8");
		const rel = toPosix(relative(ROOT, file));
		for (const { specifier } of importSpecifiers(source)) {
			if (specifier === "bun:ffi") report("apps/bot", "boundary", `${rel} imports bun:ffi`);
			if (specifier === "@aphrody/bun" || specifier.startsWith("@aphrody/bun/")) {
				report("apps/bot", "boundary", `${rel} imports ${specifier}`);
			}
		}
		if (/\bdrawM3Scene\w*/.test(stripNonCode(source)))
			report("apps/bot", "boundary", `${rel} uses drawM3Scene`);
	}

	// No package imports apps/ (covered per package by the escape check); site
	// "use client" reach and bun-class subpaths.
	const runtimeOf = (specifier: string): string | null => {
		const pkg = shenronPackageOf(specifier);
		if (!pkg || !PACKAGES[pkg]) return null;
		const manifest = readJson<Manifest>(join(ROOT, PACKAGES[pkg] as string, "package.json"));
		const sub = specifier === pkg ? "." : `./${specifier.slice(pkg.length + 1)}`;
		const declared = manifest?.shenron?.runtime?.[sub];
		return typeof declared === "string" ? declared : null;
	};
	for (const file of sourceFiles(join(ROOT, "apps", "site", "src"))) {
		const source = readFileSync(file, "utf8");
		const rel = toPosix(relative(ROOT, file));
		const isClient = /^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*["']use client["']/.test(source);
		for (const { specifier } of importSpecifiers(source)) {
			if (!specifier.startsWith("@shenron/")) continue;
			if (runtimeOf(specifier) === "bun")
				report("apps/site", "boundary", `${rel} imports bun-class ${specifier}`);
			if (
				isClient &&
				CLIENT_FORBIDDEN.some(
					(forbidden) => specifier === forbidden || specifier.startsWith(`${forbidden}/`)
				)
			) {
				report("apps/site", "client-reach", `${rel} ("use client") imports ${specifier}`);
			}
		}
	}

	// transpilePackages covers every first-rank @shenron/* dependency of the site.
	const site = readJson<Manifest>(join(ROOT, "apps", "site", "package.json"));
	const nextConfigFile = join(ROOT, "apps", "site", "next.config.ts");
	const nextConfig = existsSync(nextConfigFile) ? readFileSync(nextConfigFile, "utf8") : "";
	const listMatch = /transpilePackages\s*:\s*\[([^\]]*)\]/.exec(nextConfig);
	const transpiled = new Set(
		[...(listMatch?.[1] ?? "").matchAll(/["']([^"']+)["']/g)].map((m) => m[1])
	);
	for (const dep of Object.keys(site?.dependencies ?? {})) {
		if (PACKAGES[dep] && !transpiled.has(dep)) {
			report("apps/site", "transpile", `${dep} missing from transpilePackages`);
		}
	}
}

// ── Run ──────────────────────────────────────────────────────────────────────

const selected = ONLY ? { [ONLY]: PACKAGES[ONLY] as string } : PACKAGES;
for (const [name, relDir] of Object.entries(selected)) await checkPackage(name, relDir);
if (!ONLY) {
	checkCycles();
	checkApps();
	checkDependencyDirection();
}

const baseline: Baseline = readJson<Baseline>(BASELINE_FILE) ?? { transitional: [], phase2: [] };
baseline.transitional ??= [];
baseline.phase2 ??= [];
const inScope = (id: string) => !ONLY || id.startsWith(`${ONLY} | `);

const errors = violations.filter((v) => v.severity === "error");
const warnings = violations.filter((v) => v.severity === "warn");

if (WRITE_BASELINE) {
	const current = new Set(errors.map((v) => v.id));
	const phase2 = baseline.phase2.filter((entry) => current.has(entry.id) || !inScope(entry.id));
	const phase2Ids = new Set(phase2.map((entry) => entry.id));
	const previous = new Map(baseline.transitional.map((entry) => [entry.id, entry]));
	const transitional = [
		...baseline.transitional.filter((entry) => !inScope(entry.id)),
		...errors
			.filter((v) => !phase2Ids.has(v.id))
			.map(
				(v) =>
					previous.get(v.id) ?? {
						id: v.id,
						reason: "pre-existing at wave 1; fixed by the owning workstream before wave 5",
					}
			),
	].toSorted((a, b) => a.id.localeCompare(b.id));
	const next: Baseline = {
		$comment:
			baseline.$comment ??
			"Pre-existing check:packages violations. `transitional` must be empty at the end of Phase 1 (--strict); `phase2` entries cite a docs/STACK.md §7.3 ticket. The baseline may only shrink after wave 1.",
		transitional,
		phase2: phase2.toSorted((a, b) => a.id.localeCompare(b.id)),
	};
	await Bun.write(BASELINE_FILE, `${JSON.stringify(next, null, "\t")}\n`);
	console.log(
		`baseline written: ${transitional.length} transitional, ${next.phase2.length} phase2`
	);
	process.exit(0);
}

const known = new Set([...baseline.transitional, ...baseline.phase2].map((entry) => entry.id));
const fresh = errors.filter((v) => !known.has(v.id));
const currentIds = new Set(errors.map((v) => v.id));
const stale = [...baseline.transitional, ...baseline.phase2].filter(
	(entry) => inScope(entry.id) && !currentIds.has(entry.id)
);
const transitionalInScope = baseline.transitional.filter(
	(entry) => inScope(entry.id) && currentIds.has(entry.id)
);
const phase2InScope = baseline.phase2.filter(
	(entry) => inScope(entry.id) && currentIds.has(entry.id)
);

if (JSON_OUT) {
	console.log(
		JSON.stringify(
			{ fresh, warnings, stale, transitional: transitionalInScope, phase2: phase2InScope },
			null,
			2
		)
	);
} else {
	const scopeLabel = ONLY ?? "all packages and apps";
	console.log(`check:packages — ${scopeLabel}`);
	for (const v of fresh) console.log(`  \x1b[31merror\x1b[0m  ${v.id}`);
	for (const v of warnings) console.log(`  \x1b[33mwarn\x1b[0m   ${v.id}`);
	for (const entry of stale) console.log(`  \x1b[33mstale baseline entry\x1b[0m  ${entry.id}`);
	if (STRICT)
		for (const entry of transitionalInScope)
			console.log(`  \x1b[31mtransitional\x1b[0m  ${entry.id}`);
	console.log(
		`errors: ${fresh.length} new, ${transitionalInScope.length} transitional, ${phase2InScope.length} phase2 | warnings: ${warnings.length} | stale: ${stale.length}`
	);
}

const failed = fresh.length > 0 || (STRICT && transitionalInScope.length > 0);
process.exit(failed ? 1 : 0);
