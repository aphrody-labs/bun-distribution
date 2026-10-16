/**
 * Proves that the bot dashboard stylesheet keeps its effective values once it
 * imports the shared `@shenron/ui/styles.css` layer (blue palette, radius 0).
 *
 *   bun packages/shenron-ui/scripts/check-dashboard-css.ts [--ref <rev>] [--keep <dir>] [--limit <n>]
 *
 * Both sides are compiled like the site check: postcss + `@tailwindcss/postcss`
 * (no minification), `base` = apps/shenron/bot/src/dashboard, candidates scanned from
 * the working tree, one `bun` process per compilation.
 *
 * - Baseline: `git show <rev>:apps/shenron/bot/src/dashboard/styles.css` (default
 *   `HEAD`); an `@import "@shenron/ui/styles.css"` in that revision is inlined
 *   from the package stylesheet of the same revision.
 * - Candidate: the working-tree stylesheet, resolving the package import through
 *   the workspace link.
 *
 * Same effective-value criterion as check-css-equivalence.ts (`analyze` and
 * `compare` are shared). Importing the shared layer necessarily ADDS rules
 * (site tokens, utilities of the package sources), so additions are judged:
 * 1. Every changed or removed (layer, conditions, selector, property) winner
 *    (a removed conditional pair already overridden by an unchanged later
 *    unconditional winner is inert),
 *    every cascade-order conflict and every structure difference fails.
 * 2. An added pair fails when it touches a dashboard primitive (`.card`,
 *    `.btn*`, `.input`, `.badge*`, any state of them), unless its value is the
 *    property's initial value (after Preflight), the value `base` gives every
 *    element, or the value the same selector has without the state; a
 *    conditional (`@supports`) addition is inert when a later unconditional
 *    winner of the same selector restores such a value.
 * 3. An added custom property fails when its name was already declared in the
 *    baseline (it would shadow a dashboard theme variable), unless it sits in
 *    the per-element `utilities` / `properties` layers or restates the
 *    baseline theme value on `:root` / `:host` / `.dark`; new names are inert.
 * 4. Added at-rules fail when they are `@font-face` or touch a primitive.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { analyze, type Analysis, compare, type Findings } from "./check-css-equivalence";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
export const DASHBOARD_DIR = join(REPO_ROOT, "apps", "bot", "src", "dashboard");
const STYLES_PATH = join(DASHBOARD_DIR, "styles.css");
const STYLES_GIT_PATH = "apps/shenron/bot/src/dashboard/styles.css";
const PACKAGE_STYLES_GIT_PATH = "packages/shenron-ui/src/styles.css";
const PACKAGE_IMPORT = /@import\s+["']@shenron\/ui\/styles\.css["']\s*;/;

/** Selectors whose effective values the dashboard must keep. */
export const PRIMITIVE = /\.(card|btn(-[\w-]+)?|input|badge(-[\w-]+)?)(?![\w-])/;

/** Initial values that make an added declaration inert. */
const INITIAL: Record<string, string[]> = {
	position: ["static"],
	overflow: ["visible"],
	"overflow-x": ["visible"],
	"overflow-y": ["visible"],
	transform: ["none"],
	translate: ["none"],
	filter: ["none"],
	"box-shadow": ["none"],
	"text-shadow": ["none"],
	"transition-property": ["all", "none"],
	"transition-duration": ["0s"],
	"transition-delay": ["0s"],
	"transition-timing-function": ["ease"],
	"user-select": ["auto"],
	"-webkit-user-select": ["auto"],
	cursor: ["auto"],
	appearance: ["auto"],
	"-webkit-appearance": ["auto"],
	"-moz-appearance": ["auto"],
	opacity: ["1"],
	// Inherited property: `inherit` equals the absence of a declaration.
	color: ["inherit"],
	"background-color": ["transparent", "#0000"],
	// Preflight resets every element to `border: 0 solid`.
	"border-width": ["0", "0px"],
	"border-style": ["solid"],
};

// ─── Compilation ────────────────────────────────────────────────────────────

async function compileChild(input: string, from: string, output: string): Promise<void> {
	const { default: postcss } = await import("postcss");
	const { default: tailwindcss } = await import("@tailwindcss/postcss");
	const css = await Bun.file(input).text();
	const result = await postcss([
		tailwindcss({ base: DASHBOARD_DIR, optimize: { minify: false } }),
	]).process(css, { from });
	await Bun.write(output, result.css);
}

async function compile(css: string, label: string, workDir: string): Promise<string> {
	const input = join(workDir, `${label}.input.css`);
	const output = join(workDir, `${label}.compiled.css`);
	await Bun.write(input, css);
	const child = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			import.meta.path,
			"--compile-child",
			input,
			STYLES_PATH,
			output,
		],
		{ cwd: join(REPO_ROOT, "packages", "ui"), stdout: "inherit", stderr: "inherit" }
	);
	const code = await child.exited;
	if (code !== 0) throw new Error(`compilation of the ${label} stylesheet failed (exit ${code})`);
	return Bun.file(output).text();
}

function gitShow(rev: string, path: string): string | null {
	const res = Bun.spawnSync(["git", "show", `${rev}:${path}`], {
		cwd: REPO_ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	return res.exitCode === 0 ? res.stdout.toString() : null;
}

/** Baseline source: `<rev>` dashboard stylesheet, package stylesheet of `<rev>` inlined if imported. */
export function baselineSource(rev: string): { css: string; inlinedPackage: boolean } {
	const css = gitShow(rev, STYLES_GIT_PATH);
	if (css === null) throw new Error(`git show ${rev}:${STYLES_GIT_PATH} failed`);
	if (!PACKAGE_IMPORT.test(css)) return { css, inlinedPackage: false };
	const pkg = gitShow(rev, PACKAGE_STYLES_GIT_PATH);
	if (pkg === null) throw new Error(`git show ${rev}:${PACKAGE_STYLES_GIT_PATH} failed`);
	return { css: css.replace(PACKAGE_IMPORT, () => pkg), inlinedPackage: true };
}

// ─── Verdict ────────────────────────────────────────────────────────────────

/** Splits a winner key `layer | conditions | selector | property`. */
function parseKey(key: string): { layer: string; conds: string; selector: string; prop: string } {
	const parts = key.split(" | ");
	const prop = parts.pop() ?? "";
	const [layer = "", conds = ""] = parts;
	return { layer, conds, selector: parts.slice(2).join(" | "), prop };
}

/** Removes pseudo-classes of state so `.card:hover` maps back to `.card`. */
function stateless(selector: string): string {
	return selector.replace(
		/:(hover|active|focus|focus-visible|focus-within|disabled|placeholder-shown)(?![\w-])/g,
		""
	);
}

export interface DashboardVerdict {
	failures: Findings;
	tolerated: { added: number };
}

/** Applies the dashboard criterion to the raw comparison of two analyses. */
export function judge(base: Analysis, next: Analysis): DashboardVerdict {
	const raw = compare(base, next);
	const baseCustom = new Set<string>();
	for (const w of base.winners.values()) if (w.prop.startsWith("--")) baseCustom.add(w.prop);

	/**
	 * A removed conditional (`@supports`, `@media`) pair is inert when, in the
	 * baseline, a later unconditional winner of the same selector and property
	 * already overrode it, and the candidate keeps that same unconditional winner.
	 */
	const removedInert = (entry: string): boolean => {
		const key = entry.slice(0, entry.lastIndexOf(" = "));
		const { layer, conds, selector, prop } = parseKey(key);
		if (conds === "") return false;
		const self = base.winners.get(key);
		const plainKey = `${layer} |  | ${selector} | ${prop}`;
		const basePlain = base.winners.get(plainKey);
		const nextPlain = next.winners.get(plainKey);
		if (!self || !basePlain || !nextPlain) return false;
		if (basePlain.important !== self.important || basePlain.order < self.order) return false;
		return nextPlain.value === basePlain.value && nextPlain.important === basePlain.important;
	};

	const failures: Findings = {
		changed: raw.changed,
		removed: raw.removed.filter((entry) => !removedInert(entry)),
		orderConflicts: raw.orderConflicts,
		structure: raw.structure,
		added: [],
	};
	let tolerated = 0;

	/** Initial value, or the value the same selector already carries without the state. */
	const valueInert = (
		layer: string,
		conds: string,
		selector: string,
		prop: string,
		value: string
	) => {
		if (INITIAL[prop]?.includes(value)) return true;
		// The value every element already receives from the `base` layer (`* { … }`).
		if (next.winners.get(`base |  | * | ${prop}`)?.value === value) return true;
		const plain = stateless(selector);
		if (plain === selector) return false;
		return next.winners.get(`${layer} | ${conds} | ${plain} | ${prop}`)?.value === value;
	};

	/**
	 * An added declaration is inert when its value is, or when it sits under
	 * conditions (`@supports`, `@media`) and a later unconditional winner of the
	 * same selector and property overrides it with an inert value.
	 */
	const declarationInert = (
		layer: string,
		conds: string,
		selector: string,
		prop: string,
		value: string
	): boolean => {
		if (valueInert(layer, conds, selector, prop, value)) return true;
		if (conds === "") return false;
		const self = next.winners.get(`${layer} | ${conds} | ${selector} | ${prop}`);
		const plain = next.winners.get(`${layer} |  | ${selector} | ${prop}`);
		if (!self || !plain || plain.important !== self.important || plain.order < self.order)
			return false;
		return (
			valueInert(layer, "", selector, prop, plain.value) ||
			baseValue(layer, selector, prop) === plain.value
		);
	};

	/** Unconditional baseline winner of a selector and property. */
	const baseValue = (layer: string, selector: string, prop: string) =>
		base.winners.get(`${layer} |  | ${selector} | ${prop}`)?.value;

	/**
	 * A new custom property name is inert. A name the baseline already declared
	 * is inert only in the per-element `utilities` / `properties` layers or when
	 * it restates the baseline theme value (dashboard palette pinned on :root).
	 */
	const customInert = (layer: string, selector: string, prop: string, value: string): boolean => {
		if (!baseCustom.has(prop)) return true;
		if (layer === "utilities" || layer === "properties") return true;
		const themed = base.winners.get(`theme |  | :root | ${prop}`)?.value;
		return (
			themed === value && (selector === ":root" || selector === ".dark" || selector === ":host")
		);
	};
	for (const entry of raw.added) {
		if (entry.startsWith("at-rule ")) {
			if (/@font-face/.test(entry) || PRIMITIVE.test(entry)) failures.added.push(entry);
			else tolerated++;
			continue;
		}
		const eq = entry.lastIndexOf(" = ");
		const key = entry.slice(0, eq);
		const value = entry.slice(eq + 3);
		const { layer, conds, selector, prop } = parseKey(key);
		if (prop.startsWith("--")) {
			if (customInert(layer, selector, prop, value)) tolerated++;
			else failures.added.push(entry);
			continue;
		}
		if (!PRIMITIVE.test(selector)) {
			tolerated++;
			continue;
		}
		if (declarationInert(layer, conds, selector, prop, value)) tolerated++;
		else failures.added.push(entry);
	}
	return { failures, tolerated: { added: tolerated } };
}

export function total(f: Findings): number {
	return (
		f.changed.length +
		f.added.length +
		f.removed.length +
		f.orderConflicts.length +
		f.structure.length
	);
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function argValue(argv: string[], name: string): string | undefined {
	const i = argv.indexOf(name);
	return i === -1 ? undefined : argv[i + 1];
}

async function main(argv: string[]): Promise<number> {
	if (argv[0] === "--compile-child") {
		const [, input, from, output] = argv;
		if (!input || !from || !output)
			throw new Error("usage: --compile-child <input> <from> <output>");
		await compileChild(input, from, output);
		return 0;
	}

	const rev = argValue(argv, "--ref") ?? "HEAD";
	const keep = argValue(argv, "--keep");
	const limit = Number(argValue(argv, "--limit") ?? 25);
	const workDir = mkdtempSync(join(tmpdir(), "shenron-dashboard-css-"));
	try {
		const baseline = baselineSource(rev);
		const candidate = await Bun.file(STYLES_PATH).text();
		const [baseCss, nextCss] = await Promise.all([
			compile(baseline.css, "baseline", workDir),
			compile(candidate, "candidate", workDir),
		]);
		if (keep) {
			mkdirSync(keep, { recursive: true });
			await Bun.write(join(keep, "baseline.css"), baseCss);
			await Bun.write(join(keep, "candidate.css"), nextCss);
		}
		const base = analyze(baseCss);
		const next = analyze(nextCss);
		const { failures, tolerated } = judge(base, next);
		const count = total(failures);

		console.log(
			`dashboard-css: baseline ${rev}:${STYLES_GIT_PATH}${baseline.inlinedPackage ? " (+ package stylesheet inlined)" : ""} vs working tree ${relative(REPO_ROOT, STYLES_PATH).replaceAll("\\", "/")}`
		);
		console.log(
			`dashboard-css: declarations ${base.declarations} → ${next.declarations}; selector+property pairs ${base.winners.size} → ${next.winners.size}; inert additions tolerated ${tolerated.added}`
		);
		const report = (title: string, items: string[]) => {
			console.log(`dashboard-css: ${title}: ${items.length}`);
			for (const item of items.slice(0, limit)) console.log(`  ${item}`);
			if (items.length > limit) console.log(`  … ${items.length - limit} more`);
		};
		report("changed effective values", failures.changed);
		report("removed pairs", failures.removed);
		report("effective additions", failures.added);
		report("cascade-order conflicts", failures.orderConflicts);
		report("structure differences", failures.structure);
		console.log(count === 0 ? "dashboard-css: OK" : `dashboard-css: FAILED (${count} findings)`);
		return count === 0 ? 0 : 1;
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	process.exit(await main(Bun.argv.slice(2)));
}
