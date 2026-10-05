#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
//
// test-all.ts — custom Bun test runner that covers EVERY workspace scope.
//
// Why this exists: `turbo run test` only runs scopes that declare a `test`
// script, so any package without one is SILENTLY skipped — coverage looks green
// while whole scopes are never exercised. This runner instead enumerates every
// member from the `workspaces` globs, runs `bun test` per scope in its OWN cwd
// (so each scope's `bunfig.toml [test].preload` applies — reflect-metadata, the
// canvas shim, the test DB setup), classifies special scopes EXPLICITLY (no
// silent skips), prints a full scope matrix, and fails on any unexplained gap.
//
// Usage:
//   bun scripts/test-all.ts                 # default offline tier (unit scopes)
//   bun scripts/test-all.ts --live          # also run live-network tiers (site no-404 crawler)
//   bun scripts/test-all.ts --strict        # zero-test scopes FAIL the run (gap = error)
//   bun scripts/test-all.ts --coverage      # per-scope lcov into coverage/<scope>/
//   bun scripts/test-all.ts --junit         # per-scope JUnit xml into test-results/<scope>.xml
//   bun scripts/test-all.ts --filter bot    # only scopes whose name/path contains "bot"
//   bun scripts/test-all.ts --bail          # stop a scope's suite after first failure
//   bun scripts/test-all.ts --jobs 4        # run up to 4 independent scopes in parallel
//   bun scripts/test-all.ts --json          # machine-readable summary on stdout
//   bun scripts/test-all.ts --check-baseline  # also run baseline-excluded site suites; warn when one passes
//
// Exit code: 0 iff every selected runnable scope passed and (in --strict) no gap.

import { Glob } from "bun";
import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

// ── CLI ───────────────────────────────────────────────────────────────────────
const argv = new Set(Bun.argv.slice(2));
const flag = (n: string) => argv.has(n);
if (flag("--help") || flag("-h")) {
	console.log(`Usage: bun scripts/test-all.ts [options]

Options: --strict --live --vendored --coverage --junit --bail
         --filter <name> --jobs <n|auto> --json --check-baseline
         --randomize --seed <n> --rerun-each <n> --retry <n>
         --max-concurrency <n> --test-name-pattern <regex>`);
	process.exit(0);
}
const opt = (n: string): string | undefined => {
	const args = Bun.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith(`${n}=`)) return args[i].slice(n.length + 1);
		if (args[i] === n && i + 1 < args.length && !args[i + 1].startsWith("--")) return args[i + 1];
	}
	return undefined;
};
const RUN_LIVE = flag("--live") || flag("--all");
const RUN_VENDORED = flag("--vendored") || flag("--all");
const STRICT = flag("--strict");
const COVERAGE = flag("--coverage");
const JUNIT = flag("--junit");
const BAIL = flag("--bail");
const JSON_OUT = flag("--json");
const CHECK_BASELINE = flag("--check-baseline");
const FILTER = opt("--filter");
const jobsOpt = opt("--jobs") ?? "1";
const autoJobs = Math.min(8, Math.max(1, (cpus().length || 1) - 1));
const JOBS =
	jobsOpt.toLowerCase() === "auto" ? autoJobs : Math.max(1, Math.floor(Number(jobsOpt)) || 1);

// Flags forwarded verbatim to every per-scope `bun test` invocation. These make
// the runner a real flake/order-dependence harness, not just a launcher:
//   --randomize / --seed=N   surface tests that rely on shared state or order
//                            (critical here: @singleton DI + a shared test DB)
//   --rerun-each=N           run each test N times to catch non-determinism
//   --retry=N                retry failed tests N times (report pass-on-retry)
//   --concurrent / --max-concurrency=N   parallelism within a file
//   -t / --test-name-pattern REGEX       narrow to matching test names
const PASSTHROUGH: string[] = (() => {
	const out: string[] = [];
	const bools = ["--randomize", "--concurrent"];
	const vals = [
		"--seed",
		"--rerun-each",
		"--retry",
		"--max-concurrency",
		"--test-name-pattern",
		"-t",
	];
	for (const b of bools) if (flag(b)) out.push(b);
	for (const v of vals) {
		const val = opt(v);
		if (val !== undefined) out.push(v, val);
	}
	return out;
})();

// Artifact / non-source trees that must never be scanned for tests.
const PRUNE = ["node_modules", ".next", "dist", "build", "coverage", ".turbo", ".git"];

// ── Scope policy ──────────────────────────────────────────────────────────────
// mode:
//   unit     run `bun test` here; 0 test files => GAP (fails in --strict)
//   live     network/prod-hitting suite; skipped unless --live
//   vendored third-party fork; skipped unless --vendored
//   skip     never run (broken/irrelevant); always reported with a reason
type Mode = "unit" | "live" | "vendored" | "skip";
interface Policy {
	mode?: Mode;
	reason?: string;
	testDir?: string; // subdir to pass to `bun test` (default: auto)
	perFile?: boolean; // run each *.test.ts in its own process (fixture isolation)
	preload?: string[]; // extra --preload modules
	isolate?: boolean; // fresh Bun module graph per test file (prevents mock leakage)
	prep?: string[][]; // commands to run in cwd before testing (must succeed)
	env?: Record<string, string>;
	timeoutMs?: number; // per-test timeout
	cwd?: "root"; // run from the repository root instead of the member dir
	include?: string[]; // root-relative globs of test files (cwd "root" scopes)
	exclude?: string[]; // root-relative test files never collected (baseline, live-only suites)
	noEnvFile?: boolean; // `bun --no-env-file`: never load a local .env (no accidental DB/network)
}

// Site suites that need a database, the network or an external binary, each
// with a reason. The list may only shrink; new suites are included by default.
interface SiteBaselineEntry {
	path: string;
	reason: string;
}
const SITE_BASELINE_FILE = join(ROOT, "scripts", "test-all.site-baseline.json");
const SITE_LIVE_ONLY = "apps/site/tests/no-404.test.ts";
const SITE_BASELINE: SiteBaselineEntry[] = existsSync(SITE_BASELINE_FILE)
	? (((await Bun.file(SITE_BASELINE_FILE).json()) as { exclude?: SiteBaselineEntry[] }).exclude ??
		[])
	: [];
for (const entry of SITE_BASELINE) {
	if (!entry.reason?.trim())
		throw new Error(`test-all.site-baseline.json: ${entry.path} has no reason`);
}

// Keyed by package name. Unknown scopes default to { mode: "unit" }.
const POLICY: Record<string, Policy> = {
	// Shared @shenron/* libraries and the consolidated compute/pipeline workspace.
	"@shenron/config": { mode: "unit" },
	"@shenron/db": { mode: "unit" },
	"@shenron/auth": { mode: "unit" },
	"@shenron/pipeline": {
		mode: "unit",
		cwd: "root",
		include: ["packages/pipeline/**/*.test.ts"],
		exclude: ["packages/pipeline/test/bxc/index.live.test.ts"],
	},
	"@shenron/api": { mode: "unit" },
	"@shenron/ui": { mode: "unit" },
	// First-party Bun bot: needs the generated command-entry barrel + its own
	// bunfig preload (reflect-metadata + canvas shim + fresh ./data/test.db).
	"@shenron/bot": {
		mode: "unit",
		testDir: "tests",
		prep: [
			["bun", "run", "discordx:build"],
			["bun", "run", "gen:entries"],
		],
		preload: ["./tests/setup.ts"],
		timeoutMs: 30_000,
	},
	// Next.js site: every offline suite of tests/ and src/, run from the repo
	// root (like its own `test` script) with --isolate, minus the baseline
	// (DB/network/external binary, each with a reason). no-404 is a LIVE
	// crawler against prod and runs in the "@shenron/site#live" pseudo-scope.
	"@shenron/site": {
		mode: "unit",
		cwd: "root",
		include: ["apps/site/tests/**/*.test.{ts,tsx}", "apps/site/src/**/*.test.{ts,tsx}"],
		exclude: [...SITE_BASELINE.map((entry) => entry.path), SITE_LIVE_ONLY],
		isolate: true,
		noEnvFile: true,
		timeoutMs: 120_000,
	},
	// DiscordX packages come from the adjacent aphrody-discord workspace checkout;
	// exercise its upstream suites directly. Decorator fixtures need isolation.
	discordx: {
		mode: "unit",
		testDir: "tests",
		perFile: true,
		preload: ["reflect-metadata"],
	},
	"@discordx/di": { mode: "unit", testDir: "tests", preload: ["reflect-metadata"] },
	"@discordx/importer": { mode: "unit", testDir: "tests" },
	"@discordx/internal": { mode: "unit", testDir: "tests" },
	"@discordx/pagination": { mode: "unit", testDir: "tests" },
};

// ── Workspace discovery ───────────────────────────────────────────────────────
interface Member {
	name: string;
	dir: string; // absolute
	rel: string; // relative to ROOT
	policy: Policy;
}

// Test sets that are not workspace members of their own.
const PSEUDO_MEMBERS: Member[] = [
	{
		name: "@shenron/pipeline#live",
		dir: join(ROOT, "packages", "pipeline"),
		rel: "packages/pipeline#live",
		policy: {
			mode: "live",
			reason: "le test BXC contacte le binaire et des APIs externes",
			cwd: "root",
			include: ["packages/pipeline/test/bxc/index.live.test.ts"],
			timeoutMs: 120_000,
		},
	},
	{
		name: "@shenron/site#live",
		dir: join(ROOT, "apps", "site"),
		rel: "apps/site#live",
		policy: {
			mode: "live",
			reason: "no-404 suite fetches live prod (dragonballfr.com); opt-in via --live",
			cwd: "root",
			include: [SITE_LIVE_ONLY],
			isolate: true,
			timeoutMs: 120_000,
		},
	},
	{
		name: "(root) scripts/ops",
		dir: join(ROOT, "scripts", "ops"),
		rel: "scripts/ops",
		policy: { mode: "unit", cwd: "root", include: ["scripts/ops/*.test.ts"], noEnvFile: true },
	},
];

async function discoverMembers(): Promise<Member[]> {
	const rootPkg = (await Bun.file(join(ROOT, "package.json")).json()) as {
		workspaces?: string[] | { packages?: string[] };
	};
	const ws = rootPkg.workspaces;
	const globs = Array.isArray(ws) ? ws : (ws?.packages ?? []);
	const excludedDirs = new Set<string>();
	for (const pattern of globs.filter((glob) => glob.startsWith("!"))) {
		const memberPattern = pattern.slice(1);
		if (!memberPattern) continue;
		const glob = new Glob(`${memberPattern}/package.json`);
		for await (const rel of glob.scan({ cwd: ROOT, onlyFiles: true, followSymlinks: false })) {
			excludedDirs.add(resolve(ROOT, rel, ".."));
		}
	}
	const seen = new Set<string>();
	const members: Member[] = [];
	for (const g of globs.filter((glob) => !glob.startsWith("!"))) {
		// workspace globs point at member dirs; the package.json sits inside each.
		const glob = new Glob(`${g}/package.json`);
		for await (const rel of glob.scan({ cwd: ROOT, onlyFiles: true, followSymlinks: false })) {
			if (PRUNE.some((p) => rel.split("/").includes(p))) continue;
			const dir = resolve(ROOT, rel, "..");
			if (excludedDirs.has(dir)) continue;
			if (seen.has(dir)) continue;
			seen.add(dir);
			let name = rel;
			try {
				name = ((await Bun.file(resolve(ROOT, rel)).json()) as { name?: string }).name ?? rel;
			} catch {
				/* keep rel as name */
			}
			members.push({
				name,
				dir,
				rel: resolve(ROOT, rel, "..").slice(ROOT.length + 1),
				policy: POLICY[name] ?? { mode: "unit" },
			});
		}
	}
	members.push(...PSEUDO_MEMBERS);
	members.sort((a, b) => a.rel.localeCompare(b.rel));
	return members;
}

// Count test files in a member dir, pruning artifact trees.
async function countTests(dir: string, testDir?: string, policy?: Policy): Promise<string[]> {
	if (policy?.include) {
		const excluded = new Set((policy.exclude ?? []).map((path) => resolve(ROOT, path)));
		const out = new Set<string>();
		for (const pattern of policy.include) {
			for await (const rel of new Glob(pattern).scan({
				cwd: ROOT,
				onlyFiles: true,
				followSymlinks: false,
			})) {
				if (PRUNE.some((p) => rel.split(/[\\/]/).includes(p))) continue;
				const abs = resolve(ROOT, rel);
				if (!excluded.has(abs)) out.add(abs);
			}
		}
		return [...out].toSorted();
	}
	const base = testDir ? join(dir, testDir) : dir;
	if (!existsSync(base)) return [];
	const glob = new Glob("**/*.{test,spec}.{ts,tsx,js,jsx}");
	const out: string[] = [];
	for await (const rel of glob.scan({ cwd: base, onlyFiles: true, followSymlinks: false })) {
		if (PRUNE.some((p) => rel.split("/").includes(p))) continue;
		out.push(join(base, rel));
	}
	return out;
}

// ── Execution ─────────────────────────────────────────────────────────────────
type Status = "PASS" | "FAIL" | "NO-TESTS" | "SKIP" | "PREP-FAIL";
interface Result {
	member: Member;
	status: Status;
	tests: number;
	durationMs: number;
	note?: string;
}

function safeName(name: string): string {
	return name.replace(/[@/]/g, "_").replace(/^_+/, "");
}

// `bun scripts/test-all.ts` itself auto-loads the root .env, so a scope that
// must stay offline (noEnvFile) also drops every connection string, endpoint
// and credential inherited from this process. SHENRON_TEST_* (L2 tier) is kept.
const OFFLINE_ENV_DROP =
	/(?:URL|URI|DSN|TOKEN|SECRET|PASSWORD|_KEY)$|^(?:DATABASE|PG|POSTGRES|REDIS|NEXT_PUBLIC_)/i;
function offlineEnv(): Record<string, string | undefined> {
	const out: Record<string, string | undefined> = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (!name.startsWith("SHENRON_TEST_") && OFFLINE_ENV_DROP.test(name)) continue;
		out[name] = value;
	}
	return out;
}

async function runCmd(
	cmd: string[],
	cwd: string,
	env: Record<string, string>,
	offline = false
): Promise<number> {
	const proc = Bun.spawn(cmd, {
		cwd,
		env: { ...(offline ? offlineEnv() : process.env), ...env },
		stdout: "inherit",
		stderr: "inherit",
	});
	return await proc.exited;
}

async function runScope(m: Member, files: string[]): Promise<Result> {
	const t0 = Bun.nanoseconds();
	const env: Record<string, string> = {
		NODE_ENV: "test",
		FORCE_COLOR: "1",
		...m.policy.env,
	};

	// Prep steps (e.g. gen:entries) — must succeed or the scope is PREP-FAIL.
	const cwd = m.policy.cwd === "root" ? ROOT : m.dir;
	const bunPrefix = m.policy.noEnvFile ? ["bun", "--no-env-file"] : ["bun"];
	for (const cmd of m.policy.prep ?? []) {
		const code = await runCmd(cmd, cwd, env);
		if (code !== 0) {
			return {
				member: m,
				status: "PREP-FAIL",
				tests: files.length,
				durationMs: (Bun.nanoseconds() - t0) / 1e6,
				note: `prep failed: ${cmd.join(" ")}`,
			};
		}
	}

	// Pass the explicitly-discovered, artifact-pruned files (absolute paths, so
	// Bun treats them as paths not name-filters). Bun's own recursive discovery
	// does NOT prune .next/dist/build, so it would double-run build-output copies
	// of test files — passing exact paths avoids that entirely.
	const baseArgs = ["test", ...files];
	if (m.policy.isolate) baseArgs.push("--isolate");
	for (const p of m.policy.preload ?? []) baseArgs.push("--preload", p);
	if (m.policy.timeoutMs) baseArgs.push("--timeout", String(m.policy.timeoutMs));
	if (BAIL) baseArgs.push("--bail");
	if (COVERAGE)
		baseArgs.push(
			"--coverage",
			"--coverage-reporter=lcov",
			`--coverage-dir=${join(ROOT, "coverage", safeName(m.name))}`
		);
	if (JUNIT) {
		baseArgs.push(
			"--reporter=junit",
			"--reporter-outfile",
			join(ROOT, "test-results", `${safeName(m.name)}.xml`)
		);
	}
	baseArgs.push(...PASSTHROUGH);

	let failed = false;
	if (m.policy.perFile) {
		// Isolate each file in its own `bun test` process (fixture isolation).
		for (const f of files) {
			const args = ["test", f];
			for (const p of m.policy.preload ?? []) args.push("--preload", p);
			if (m.policy.timeoutMs) args.push("--timeout", String(m.policy.timeoutMs));
			args.push(...PASSTHROUGH);
			const code = await runCmd([...bunPrefix, ...args], cwd, env, m.policy.noEnvFile);
			if (code !== 0) failed = true;
		}
	} else {
		const code = await runCmd([...bunPrefix, ...baseArgs], cwd, env, m.policy.noEnvFile);
		if (code !== 0) failed = true;
	}

	return {
		member: m,
		status: failed ? "FAIL" : "PASS",
		tests: files.length,
		durationMs: (Bun.nanoseconds() - t0) / 1e6,
	};
}

// ── Main ──────────────────────────────────────────────────────────────────────
const members = await discoverMembers();
const selected = members.filter(
	(m) => !FILTER || m.name.includes(FILTER) || m.rel.includes(FILTER)
);

console.log(
	`\x1b[1mtest-all\x1b[0m — ${selected.length}/${members.length} scopes selected` +
		(FILTER ? ` (filter: ${FILTER})` : "")
);
console.log(
	`tiers: unit=on  live=${RUN_LIVE ? "on" : "off"}  vendored=${RUN_VENDORED ? "on" : "off"}  strict=${STRICT ? "on" : "off"}  coverage=${COVERAGE ? "on" : "off"}\n`
);

// Stale site baseline entries only warn: a missing suite always, a suite that
// now passes when --check-baseline runs the excluded suites. Never a failure.
if (selected.some((m) => m.name === "@shenron/site")) {
	for (const entry of SITE_BASELINE) {
		const abs = resolve(ROOT, entry.path);
		if (!existsSync(abs)) {
			console.log(
				`\x1b[33m⚠ site baseline: ${entry.path} no longer exists — remove the entry\x1b[0m`
			);
			continue;
		}
		if (!CHECK_BASELINE) continue;
		const proc = Bun.spawn(["bun", "--no-env-file", "test", "--isolate", abs], {
			cwd: ROOT,
			env: { ...offlineEnv(), NODE_ENV: "test" },
			stdout: "ignore",
			stderr: "ignore",
		});
		if ((await proc.exited) === 0) {
			console.log(`\x1b[33m⚠ site baseline: ${entry.path} now passes — remove the entry\x1b[0m`);
		}
	}
}

const runnable: Array<{ member: Member; files: string[]; resultIndex: number }> = [];
const results: Result[] = [];
for (const m of selected) {
	const mode = m.policy.mode ?? "unit";
	const files = await countTests(m.dir, m.policy.testDir, m.policy);

	if (mode === "skip") {
		results.push({
			member: m,
			status: "SKIP",
			tests: files.length,
			durationMs: 0,
			note: m.policy.reason ?? "policy: skip",
		});
		continue;
	}
	if (mode === "live" && !RUN_LIVE) {
		results.push({
			member: m,
			status: "SKIP",
			tests: files.length,
			durationMs: 0,
			note: m.policy.reason ?? "live tier (use --live)",
		});
		continue;
	}
	if (mode === "vendored" && !RUN_VENDORED) {
		results.push({
			member: m,
			status: "SKIP",
			tests: files.length,
			durationMs: 0,
			note: m.policy.reason ?? "vendored (use --vendored)",
		});
		continue;
	}
	if (files.length === 0) {
		results.push({
			member: m,
			status: "NO-TESTS",
			tests: 0,
			durationMs: 0,
			note: "scope has zero test files",
		});
		continue;
	}
	const resultIndex = results.length;
	// Reserve the slot now; workers complete out of order.
	results.push(undefined as unknown as Result);
	runnable.push({ member: m, files, resultIndex });
}

// Scope processes are isolated by cwd and Bun process, so independent scopes
// can use the machine's spare CPU/RAM. Keep the default at one job because
// some external/integration fixtures intentionally assume serial execution.
if (JOBS > 1) console.log(`parallel scopes: up to ${JOBS} jobs`);
let next = 0;
const worker = async () => {
	while (next < runnable.length) {
		const index = next++;
		const { member, files, resultIndex } = runnable[index];
		console.log(`\x1b[36m▶ ${member.name}\x1b[0m (${member.rel}) — ${files.length} file(s)`);
		results[resultIndex] = await runScope(member, files);
		console.log("");
	}
};
await Promise.all(Array.from({ length: Math.min(JOBS, runnable.length) }, worker));

// ── Report ────────────────────────────────────────────────────────────────────
const colour: Record<Status, string> = {
	PASS: "\x1b[32mPASS\x1b[0m",
	FAIL: "\x1b[31mFAIL\x1b[0m",
	"NO-TESTS": "\x1b[33mNO-TESTS\x1b[0m",
	SKIP: "\x1b[90mSKIP\x1b[0m",
	"PREP-FAIL": "\x1b[31mPREP-FAIL\x1b[0m",
};
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
const nameW = Math.max(...results.map((r) => r.member.name.length), 12);

console.log("\x1b[1m── scope matrix ───────────────────────────────────────────────\x1b[0m");
for (const r of results) {
	const dur = r.durationMs ? `${(r.durationMs / 1000).toFixed(2)}s` : "";
	console.log(
		`  ${colour[r.status]}  ${pad(r.member.name, nameW)}  ${pad(String(r.tests) + "f", 5)} ${pad(dur, 8)} ${r.note ?? ""}`
	);
}

const pass = results.filter((r) => r.status === "PASS");
const fail = results.filter((r) => r.status === "FAIL" || r.status === "PREP-FAIL");
const gaps = results.filter((r) => r.status === "NO-TESTS");
const skipped = results.filter((r) => r.status === "SKIP");
const totalTests = results.reduce(
	(n, r) => n + (r.status === "PASS" || r.status === "FAIL" ? r.tests : 0),
	0
);

console.log("\x1b[1m───────────────────────────────────────────────────────────────\x1b[0m");
console.log(
	`scopes: ${selected.length}  |  \x1b[32m${pass.length} pass\x1b[0m  \x1b[31m${fail.length} fail\x1b[0m  ` +
		`\x1b[33m${gaps.length} no-tests\x1b[0m  \x1b[90m${skipped.length} skip\x1b[0m  |  ${totalTests} test files run`
);
if (gaps.length) console.log(`gaps (no tests): ${gaps.map((g) => g.member.name).join(", ")}`);

if (JSON_OUT) {
	console.log(
		JSON.stringify(
			{
				scopes: results.map((r) => ({
					name: r.member.name,
					rel: r.member.rel,
					status: r.status,
					tests: r.tests,
					ms: Math.round(r.durationMs),
					note: r.note,
				})),
			},
			null,
			2
		)
	);
}

const failed = fail.length > 0 || (STRICT && gaps.length > 0);
if (STRICT && gaps.length)
	console.log("\x1b[31m✗ strict mode: zero-test scopes are failures\x1b[0m");
process.exit(failed ? 1 : 0);
