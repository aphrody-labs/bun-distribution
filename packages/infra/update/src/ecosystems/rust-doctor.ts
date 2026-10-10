// SPDX-License-Identifier: Apache-2.0
/**
 * Rust workspace doctor: one action that proves the state of the whole Cargo workspace and repairs what is mechanical.
 *
 *   rust doctor [--fix] [--only a,b] [--skip a,b] [--strict] [--allow-dirty] [--verbose] [--json]
 *   rust fix [...]                   same as `doctor --fix`
 *
 * Stages, always in this order, one Cargo command at a time through scripts/build/rust/cargo-serial.sh:
 *   lock      Cargo.lock matches the manifests (`cargo metadata --locked`) and the lock pins of rust-holds.json
 *   format    `cargo fmt --all -- --check -l` against rustfmt.toml, one row per crate
 *   compile   `cargo clippy --workspace --all-targets`: compiler errors, warnings and lints with file:line
 *   features  one `cargo check` of the workspace with every member feature switched on (minus the documented skips)
 *   targets   `cargo check --target` for the configured triples (wasm32, Windows MSVC through cargo-xwin)
 *   test      `cargo nextest run --workspace` (JUnit report of the `doctor` profile) and the doc tests
 *   deny      `cargo deny check advisories`, minus tools/config/deps/advisory-holds.json
 *   bumps     toolchain channel, yanked or in-range releases left behind, lock pins and held crates (`rust status`)
 *
 * `--fix` repairs before it reports: lock pins and their relock, a lock that drifted from the manifests, every
 * machine-applicable compiler or clippy suggestion (`cargo clippy --fix`) and rustfmt drift. It never rewrites a
 * vendored crate, and never a crate that already has uncommitted changes unless `--allow-dirty` (another agent may own
 * them). What it cannot repair is listed with crate, file, line and lint, or with the reason it was not proven.
 *
 * Exit code: 1 when an error-level problem remains; `--strict` also fails on warnings. The report is written to
 * target/update/rust-doctor/report.json with the raw output of every stage next to it. Skips, vendored crates, target
 * triples and test exclusions are data in tools/config/update/rust-doctor.json, each with its reason.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative } from "node:path";
import { Ctx } from "../context.ts";
import { parseCargoLock } from "../deps/inventory.ts";
import {
  denyAdvisories,
  loadAdvisoryHolds,
  loadHolds,
  lockPinDrift,
  restoreLockPins,
  rustStatus,
} from "./rust.ts";

const WRAPPER = "scripts/build/rust/cargo-serial.sh";
const CONFIG_FILE = "tools/config/update/rust-doctor.json";
const OUT_DIR = "target/update/rust-doctor";
const JUNIT = "target/nextest/doctor/junit.xml";

export const STAGES = [
  "lock",
  "format",
  "compile",
  "features",
  "targets",
  "test",
  "deny",
  "bumps",
] as const;
export type Stage = (typeof STAGES)[number];

export type Severity = "error" | "warning" | "info";
export type Problem = {
  stage: Stage;
  severity: Severity;
  crate?: string;
  code?: string;
  file?: string;
  line?: number;
  message: string;
  /** `rust fix` can repair it. */
  fixable?: boolean;
  /** Why it is only a note: vendored crate, documented skip, hold. */
  note?: string;
};
export type StageResult = {
  stage: Stage;
  status: "ok" | "problems" | "failed" | "skipped";
  seconds: number;
  summary: string;
  problems: Problem[];
  fixed: number;
  commands: string[];
};
export type DoctorReport = {
  date: string;
  root: string;
  fix: boolean;
  stages: StageResult[];
  totals: { errors: number; warnings: number; notes: number; fixed: number };
};

export type TargetSpec = {
  triple: string;
  /** `xwin` checks Windows MSVC from Linux through cargo-xwin (downloads and caches the CRT and SDK). */
  runner?: "cargo" | "xwin";
  /** `auto`: members with a dependency gated on `match`; `workspace`: every member; or explicit package names. */
  packages: "auto" | "workspace" | string[];
  /** Regular expression tested against dependency `cfg(...)` strings for `auto` (default derived from the triple). */
  match?: string;
  /** Members added to an `auto` selection: artifacts of the target that carry no target-gated dependency. */
  include?: string[];
  exclude?: { crates: string; reason: string }[];
  /**
   * One `cargo check -p` per package instead of one for the set. A set unifies features (one member asking for
   * tokio's `net` breaks every other one on wasm32), so crates that ship as separate artifacts are proven alone.
   */
  isolate?: boolean;
  env?: Record<string, string>;
};
export type DoctorConfig = {
  vendored: { crates: string; reason: string }[];
  features: { skip: { feature: string; reason: string }[] };
  targets: TargetSpec[];
  tests: { exclude: { filter: string; reason: string }[]; doc: boolean };
};

export type MetaPackage = {
  name: string;
  manifest_path: string;
  features: Record<string, string[]>;
  dependencies: { name: string; target: string | null }[];
};

// ---------------------------------------------------------------- pure helpers (unit-tested)

/** `*` wildcard pattern, anchored. */
export function glob(pattern: string): RegExp {
  return new RegExp(
    `^${pattern
      .split("*")
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );
}

export function vendoredReason(
  crate: string,
  vendored: DoctorConfig["vendored"],
): string | undefined {
  return vendored.find((v) => glob(v.crates).test(crate))?.reason;
}

export type Diagnostic = {
  level: "error" | "warning";
  code?: string;
  crate: string;
  manifest?: string;
  file?: string;
  line?: number;
  message: string;
  fixable: boolean;
};

const SUMMARY_MESSAGE =
  /^(\d+ warnings? emitted|aborting due to|.* generated \d+ warnings?|could not compile)/;

const hasMachineFix = (m: {
  spans?: { suggestion_applicability?: string | null }[];
  children?: unknown[];
}): boolean =>
  (m.spans ?? []).some((s) => s.suggestion_applicability === "MachineApplicable") ||
  (m.children ?? []).some((ch) => hasMachineFix(ch as Parameters<typeof hasMachineFix>[0]));

/**
 * Compiler and clippy diagnostics of a `--message-format=json` Cargo run, one row per distinct finding (the lib and its
 * test build report the same warning twice). `crateOf` maps a manifest path to the package name.
 */
export function parseDiagnostics(
  text: string,
  crateOf: (manifest: string, packageId: string) => string,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    let j: {
      reason?: string;
      package_id?: string;
      manifest_path?: string;
      message?: {
        level?: string;
        message?: string;
        code?: { code?: string } | null;
        spans?: {
          file_name: string;
          line_start: number;
          column_start: number;
          is_primary: boolean;
          suggestion_applicability?: string | null;
        }[];
        children?: unknown[];
      };
    };
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    const m = j.message;
    if (j.reason !== "compiler-message" || !m?.level || !m.message) continue;
    const level = m.level.startsWith("error")
      ? "error"
      : m.level === "warning"
        ? "warning"
        : undefined;
    if (!level || SUMMARY_MESSAGE.test(m.message)) continue;
    const span = (m.spans ?? []).find((s) => s.is_primary) ?? m.spans?.[0];
    const d: Diagnostic = {
      level,
      code: m.code?.code,
      crate: crateOf(j.manifest_path ?? "", j.package_id ?? ""),
      manifest: j.manifest_path,
      file: span?.file_name,
      line: span?.line_start,
      message: m.message,
      fixable: hasMachineFix(m),
    };
    const key = diagnosticKey(d, span?.column_start);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

export const diagnosticKey = (
  d: { code?: string; file?: string; line?: number; message: string },
  column?: number,
) => `${d.code ?? ""}|${d.file ?? ""}|${d.line ?? ""}|${column ?? ""}|${d.message}`;

/** Package name from a Cargo package id (`path+file:///x/dir#name@1.0.0`, `path+file:///x/name#1.0.0`, `registry+...#name@1.0.0`). */
export function crateFromPackageId(id: string): string {
  const hash = id.lastIndexOf("#");
  if (hash < 0) return id.split(" ")[0] ?? id;
  const frag = id.slice(hash + 1);
  const at = frag.lastIndexOf("@");
  if (at > 0) return frag.slice(0, at);
  return id.slice(0, hash).replace(/\/+$/, "").split("/").pop() ?? id;
}

export type FeaturePlan = { enabled: string[]; skipped: { feature: string; reason: string }[] };

/** Every `package/feature` of the workspace members, minus `default` and the configured skips (`*` wildcards allowed). */
export function featurePlan(
  packages: Pick<MetaPackage, "name" | "features">[],
  skip: DoctorConfig["features"]["skip"],
): FeaturePlan {
  const rules = skip.map((s) => ({ re: glob(s.feature), reason: s.reason }));
  const plan: FeaturePlan = { enabled: [], skipped: [] };
  for (const p of [...packages].toSorted((a, b) => a.name.localeCompare(b.name))) {
    for (const f of Object.keys(p.features).toSorted()) {
      if (f === "default") continue;
      const id = `${p.name}/${f}`;
      const rule = rules.find((r) => r.re.test(id));
      if (rule) plan.skipped.push({ feature: id, reason: rule.reason });
      else plan.enabled.push(id);
    }
  }
  return plan;
}

const defaultMatch = (triple: string) =>
  triple.startsWith("wasm32")
    ? "wasm32"
    : triple.includes("windows")
      ? "windows"
      : triple.includes("apple")
        ? "macos|ios|apple"
        : triple.split("-")[0]!;

/** Packages to check for one target triple, and the configured exclusions that applied. */
export function targetPackages(
  packages: MetaPackage[],
  spec: TargetSpec,
): { packages: string[]; excluded: { crate: string; reason: string }[] } {
  let names: string[];
  if (spec.packages === "workspace") names = packages.map((p) => p.name);
  else if (spec.packages === "auto") {
    const re = new RegExp(spec.match ?? defaultMatch(spec.triple));
    names = [
      ...packages
        .filter((p) => p.dependencies.some((d) => d.target && re.test(d.target)))
        .map((p) => p.name),
      ...(spec.include ?? []),
    ];
  } else names = spec.packages;
  const excluded: { crate: string; reason: string }[] = [];
  const kept = names.filter((n) => {
    const rule = (spec.exclude ?? []).find((e) => glob(e.crates).test(n));
    if (rule) excluded.push({ crate: n, reason: rule.reason });
    return !rule;
  });
  return { packages: [...new Set(kept)].toSorted(), excluded };
}

export type TestFailure = { suite: string; name: string; kind: "fail" | "flaky"; message: string };

const xmlAttr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const xmlText = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** The `/usr/lib/llvm-<N>/bin` directory with the highest N among `dirs` (the entries of `/usr/lib`). */
export function newestLlvm(dirs: string[]): string | undefined {
  const versions = dirs
    .map((d) => /^llvm-(\d+)$/.exec(d)?.[1])
    .filter((v): v is string => !!v)
    .map(Number)
    .toSorted((a, b) => b - a);
  return versions.length ? `llvm-${versions[0]}` : undefined;
}

/** Failing and flaky test cases of a nextest JUnit report. */
export function parseJunit(xml: string): {
  tests: number;
  failures: TestFailure[];
  flaky: TestFailure[];
} {
  const failures: TestFailure[] = [];
  const flaky: TestFailure[] = [];
  let tests = 0;
  for (const suite of xml.split(/<testsuite\s/).slice(1)) {
    const suiteName = xmlText(xmlAttr(suite.slice(0, suite.indexOf(">")), "name") ?? "?");
    for (const block of suite.split(/<testcase\s/).slice(1)) {
      tests++;
      const head = block.slice(0, block.indexOf(">") + 1);
      const name = xmlText(xmlAttr(head, "name") ?? "?");
      if (head.endsWith("/>")) continue;
      const body = block.slice(
        head.length,
        block.includes("</testcase>") ? block.indexOf("</testcase>") : undefined,
      );
      const fail = /<(failure|error)\b([^>]*)>/.exec(body);
      const fl = /<(flakyFailure|flakyError)\b([^>]*)>/.exec(body);
      const describe = (tag: RegExpExecArray) =>
        xmlText(xmlAttr(tag[2]!, "message") ?? xmlAttr(tag[2]!, "type") ?? tag[1]!)
          .split("\n")[0]!
          .slice(0, 300);
      if (fail) failures.push({ suite: suiteName, name, kind: "fail", message: describe(fail) });
      else if (fl) flaky.push({ suite: suiteName, name, kind: "flaky", message: describe(fl) });
    }
  }
  return { tests, failures, flaky };
}

/** Failing tests of libtest text output (`cargo test`), with the `Doc-tests <crate>` or `Running ...` section they belong to. */
export function parseLibtest(text: string): { suite: string; name: string }[] {
  const out: { suite: string; name: string }[] = [];
  let suite = "?";
  for (const l of text.split("\n")) {
    const s = /^\s*(?:Doc-tests\s+(\S+)|Running\s+(.+?)(?:\s+\(.*\))?)\s*$/.exec(l);
    if (s) {
      suite = s[1] ?? s[2] ?? suite;
      continue;
    }
    const t = /^test (.+) \.\.\. FAILED$/.exec(l.trim());
    if (t) out.push({ suite, name: t[1]! });
  }
  return out;
}

/** Files named by `cargo fmt -- --check -l` (changed files and `Incorrect newline style in <file>` lines), repo-relative. */
export function parseFmtList(text: string, root: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split("\n")) {
    const l = raw.trim().replace(/^Incorrect newline style in /, "");
    if (!l.endsWith(".rs")) continue;
    out.add(isAbsolute(l) || l.startsWith("/") ? relative(root, l).replaceAll("\\", "/") : l);
  }
  return [...out].toSorted();
}

/** Owner crate of a repo-relative file: the member whose directory is the longest prefix. */
export function crateOfFile(file: string, dirs: [dir: string, name: string][]): string | undefined {
  let best: [string, string] | undefined;
  for (const d of dirs)
    if ((file === d[0] || file.startsWith(`${d[0]}/`)) && (!best || d[0].length > best[0].length))
      best = d;
  return best?.[1];
}

/** Paths of `git status --porcelain` (both sides of a rename). */
export function parsePorcelain(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.length > 3)
    .flatMap((l) => l.slice(3).split(" -> "))
    .map((p) => p.replace(/^"|"$/g, ""));
}

/** First lines of a Cargo log that explain a failure when no compiler diagnostic did. */
export function errorLines(log: string, max = 12): string[] {
  const lines = log.split("\n");
  const at = lines.findIndex((l) => /^error(\[E\d+\])?:/.test(l.trim()));
  return (at < 0 ? lines.filter((l) => l.trim()).slice(-max) : lines.slice(at, at + max))
    .map((l) => l.trimEnd())
    .filter(Boolean);
}

export function stageStatus(problems: Problem[]): StageResult["status"] {
  return problems.some((p) => p.severity === "error")
    ? "failed"
    : problems.some((p) => p.severity === "warning")
      ? "problems"
      : "ok";
}

export function totals(stages: StageResult[]): DoctorReport["totals"] {
  const all = stages.flatMap((s) => s.problems);
  return {
    errors: all.filter((p) => p.severity === "error").length,
    warnings: all.filter((p) => p.severity === "warning").length,
    notes: all.filter((p) => p.severity === "info").length,
    fixed: stages.reduce((n, s) => n + s.fixed, 0),
  };
}

export function exitCode(t: DoctorReport["totals"], strict: boolean): number {
  return t.errors || (strict && t.warnings) ? 1 : 0;
}

// ---------------------------------------------------------------- IO

type Run = { status: number; out: string; log: string; seconds: number; command: string };

class Doctor {
  readonly cfg: DoctorConfig;
  readonly packages: MetaPackage[];
  readonly dirs: [string, string][];
  readonly byManifest: Map<string, string>;
  /** Members with uncommitted changes when the doctor started: never rewritten without --allow-dirty. */
  readonly dirty: Set<string>;
  /** Diagnostics already reported by an earlier stage (the same warning shows up again with more features or targets). */
  readonly reported = new Set<string>();

  constructor(
    readonly c: Ctx,
    readonly fix: boolean,
    readonly allowDirty: boolean,
    readonly verbose: boolean,
  ) {
    const raw = c.jsonFile<Partial<DoctorConfig>>(CONFIG_FILE, {});
    this.cfg = {
      vendored: raw.vendored ?? [],
      features: { skip: raw.features?.skip ?? [] },
      targets: raw.targets ?? [],
      tests: { exclude: raw.tests?.exclude ?? [], doc: raw.tests?.doc ?? true },
    };
    mkdirSync(join(c.root, OUT_DIR), { recursive: true });
    const meta = this.cargo("metadata", ["metadata", "--no-deps", "--format-version", "1"]);
    if (meta.status !== 0)
      throw new Error(`cargo metadata failed:\n${errorLines(meta.log).join("\n")}`);
    this.packages = (JSON.parse(meta.out) as { packages: MetaPackage[] }).packages;
    this.byManifest = new Map(this.packages.map((p) => [p.manifest_path, p.name]));
    this.dirs = this.packages.map((p) => [relative(c.root, dirname(p.manifest_path)), p.name]);
    const changed = parsePorcelain(c.run("git", ["status", "--porcelain"]).stdout);
    this.dirty = new Set(
      changed.map((f) => crateOfFile(f, this.dirs)).filter((n): n is string => !!n),
    );
  }

  /** One serialized Cargo command; stdout and stderr are kept under target/update/rust-doctor/<name>.{out,log}. */
  cargo(name: string, args: string[], env: Record<string, string> = {}, merge = false): Run {
    const outFile = join(this.c.root, OUT_DIR, `${name}.out`);
    const logFile = join(this.c.root, OUT_DIR, `${name}.log`);
    const o = openSync(outFile, "w");
    const e = merge ? o : this.verbose ? ("inherit" as const) : openSync(logFile, "w");
    const t = Date.now();
    const r = spawnSync("bash", [WRAPPER, ...args], {
      windowsHide: true,
      cwd: this.c.root,
      stdio: ["ignore", o, e],
      env: { ...process.env, ...env },
    });
    closeSync(o);
    if (typeof e === "number" && e !== o) closeSync(e);
    return {
      status: r.status ?? 1,
      out: readFileSync(outFile, "utf8"),
      log: merge || this.verbose ? "" : readFileSync(logFile, "utf8"),
      seconds: Math.round((Date.now() - t) / 1000),
      command: `cargo ${args.join(" ")}`,
    };
  }

  crateOf = (manifest: string, id: string) =>
    this.byManifest.get(manifest) ?? crateFromPackageId(id);
  isMember = (d: Diagnostic) => !!d.manifest && this.byManifest.has(d.manifest);

  /** Diagnostics of a JSON Cargo run as problems; vendored and out-of-repo crates are notes, never rewritten. */
  problemsOf(stage: Stage, run: Run, label: string): { problems: Problem[]; diags: Diagnostic[] } {
    const diags = parseDiagnostics(run.out, this.crateOf);
    const problems: Problem[] = [];
    for (const d of diags) {
      const key = diagnosticKey(d);
      if (this.reported.has(key)) continue;
      this.reported.add(key);
      const vendored =
        vendoredReason(d.crate, this.cfg.vendored) ??
        (this.isMember(d) ? undefined : "source checkout outside the workspace");
      problems.push({
        stage,
        severity: d.level === "error" ? "error" : vendored ? "info" : "warning",
        crate: d.crate,
        code: d.code,
        file: d.file,
        line: d.line,
        message: d.message,
        fixable: d.fixable && !vendored && d.level !== "error" ? true : undefined,
        note: vendored && d.level !== "error" ? vendored : undefined,
      });
    }
    if (run.status !== 0 && !problems.some((p) => p.severity === "error")) {
      problems.push({
        stage,
        severity: "error",
        message: `${label} failed without a compiler diagnostic: ${errorLines(run.log).join(" | ").slice(0, 900)}`,
      });
    }
    return { problems, diags };
  }

  /** Members the repair may rewrite: not vendored, and clean unless --allow-dirty. */
  writable(crate: string): boolean {
    return (
      this.byManifest.size > 0 &&
      [...this.byManifest.values()].includes(crate) &&
      !vendoredReason(crate, this.cfg.vendored) &&
      (this.allowDirty || !this.dirty.has(crate))
    );
  }

  // -------------------------------------------------------------- lock

  lock(): StageResult {
    const t = Date.now();
    const commands: string[] = [];
    const problems: Problem[] = [];
    let fixed = 0;
    const drift = () => lockPinDrift(parseCargoLock(this.c.read("Cargo.lock")), loadHolds(this.c));
    if (drift().length && this.fix) {
      const r = restoreLockPins(this.c);
      fixed += r.restored - r.failed;
      commands.push("cargo update -p <pin> --precise <version>");
    }
    for (const d of drift())
      problems.push({
        stage: "lock",
        severity: "error",
        crate: d.crate,
        message: `lock pin drifted: ${d.crate} ${d.from} must stay ${d.to} (tools/config/deps/rust-holds.json)`,
        fixable: true,
      });
    let sync = this.cargo("lock", ["metadata", "--locked", "--format-version", "1"]);
    commands.push(sync.command);
    if (sync.status !== 0 && this.fix) {
      // Cargo itself brings the lock back in line with the manifests (minimal change, never a bulk update).
      const repair = this.cargo("lock-repair", ["metadata", "--format-version", "1"]);
      commands.push(repair.command);
      sync = this.cargo("lock", ["metadata", "--locked", "--format-version", "1"]);
      if (sync.status === 0) fixed++;
    }
    if (sync.status !== 0)
      problems.push({
        stage: "lock",
        severity: "error",
        message: `Cargo.lock does not match the manifests: ${errorLines(sync.log, 4).join(" | ")}`,
        fixable: true,
      });
    const pins = loadHolds(this.c).filter((h) => h.lockVersion).length;
    return {
      stage: "lock",
      status: stageStatus(problems),
      seconds: secs(t),
      summary: problems.length
        ? `${problems.length} lock problem(s)`
        : `Cargo.lock matches the manifests; ${pins} lock pin(s) in place`,
      problems,
      fixed,
      commands,
    };
  }

  // -------------------------------------------------------------- format

  private fmtList(): { run: Run; files: string[] } {
    const run = this.cargo("format", ["fmt", "--all", "--", "--check", "-l"], {}, true);
    return { run, files: parseFmtList(run.out, this.c.root) };
  }

  /** Files that differ from rustfmt.toml, grouped by owner crate (`undefined`: outside every member). */
  private fmtByCrate(files: string[]): Map<string | undefined, string[]> {
    const m = new Map<string | undefined, string[]>();
    for (const f of files) {
      const k = f.startsWith("..") ? undefined : crateOfFile(f, this.dirs);
      (m.get(k) ?? m.set(k, []).get(k)!).push(f);
    }
    return m;
  }

  /** `cargo fmt -p <crate>...`: whole packages from their crate roots, so nested modules resolve. */
  private fmtCrates(crates: string[]): Run | undefined {
    return crates.length
      ? this.cargo("format-fix", ["fmt", ...crates.flatMap((n) => ["-p", n])], {}, true)
      : undefined;
  }

  format(): StageResult {
    const t = Date.now();
    let { run, files } = this.fmtList();
    const commands = [run.command];
    let fixed = 0;
    if (this.fix) {
      const crates = [...this.fmtByCrate(files).keys()]
        .filter((n): n is string => !!n && this.writable(n))
        .toSorted();
      const repair = this.fmtCrates(crates);
      if (repair) {
        commands.push(`cargo fmt -p <${crates.length} crate(s)>`);
        const before = files.length;
        ({ run, files } = this.fmtList());
        fixed = before - files.length;
      }
    }
    const problems: Problem[] = [];
    const notes = new Map<string, number>();
    for (const [crate, list] of this.fmtByCrate(files)) {
      const reason = crate
        ? vendoredReason(crate, this.cfg.vendored)
        : "source checkout outside the workspace";
      if (reason) {
        notes.set(reason, (notes.get(reason) ?? 0) + list.length);
        continue;
      }
      problems.push({
        stage: "format",
        severity: "warning",
        crate,
        file: list[0],
        fixable: true,
        message: `${list.length} file(s) differ from rustfmt.toml${!this.allowDirty && this.dirty.has(crate!) ? " (crate has uncommitted changes: repaired only with --allow-dirty)" : ""}`,
      });
    }
    for (const [reason, n] of notes)
      problems.push({
        stage: "format",
        severity: "info",
        message: `${n} file(s) keep their upstream formatting`,
        note: reason,
      });
    const first = problems.filter((p) => p.severity === "warning");
    return {
      stage: "format",
      status: stageStatus(problems),
      seconds: secs(t),
      summary: first.length
        ? `${first.length} crate(s) differ from rustfmt.toml`
        : "first-party sources match rustfmt.toml",
      problems,
      fixed,
      commands,
    };
  }

  // -------------------------------------------------------------- compile

  compile(): StageResult {
    const t = Date.now();
    const clippy = this.c.run("cargo", ["clippy", "--version"]).status === 0;
    const args = [
      clippy ? "clippy" : "check",
      "--workspace",
      "--all-targets",
      "--keep-going",
      "--message-format=json",
    ];
    let run = this.cargo("compile", args);
    const commands = [run.command];
    let fixed = 0;
    if (this.fix && clippy) {
      const diags = parseDiagnostics(run.out, this.crateOf);
      const fixable = diags.filter((d) => d.fixable && d.level === "warning");
      const crates = [...new Set(fixable.map((d) => d.crate))]
        .filter((n) => this.writable(n))
        .toSorted();
      if (crates.length) {
        // Suggestions are applied as source edits: crates that were on the formatting policy are put back on it.
        const unformatted = new Set(this.fmtByCrate(this.fmtList().files).keys());
        const repair = this.cargo("compile-fix", [
          "clippy",
          "--fix",
          "--allow-dirty",
          "--allow-staged",
          "--all-targets",
          ...crates.flatMap((n) => ["-p", n]),
        ]);
        commands.push(repair.command);
        this.fmtCrates(crates.filter((n) => !unformatted.has(n)));
        run = this.cargo("compile", args);
        const left = parseDiagnostics(run.out, this.crateOf).filter(
          (d) => d.fixable && d.level === "warning",
        ).length;
        fixed = Math.max(0, fixable.length - left);
        if (repair.status !== 0)
          console.error(
            `doctor  compile   cargo clippy --fix exited ${repair.status}: ${errorLines(repair.log, 3).join(" | ")}`,
          );
      }
    }
    const { problems } = this.problemsOf("compile", run, args.slice(0, 3).join(" "));
    const e = problems.filter((p) => p.severity === "error").length;
    const w = problems.filter((p) => p.severity === "warning").length;
    const f = problems.filter((p) => p.fixable).length;
    return {
      stage: "compile",
      status: stageStatus(problems),
      seconds: secs(t),
      summary: `${this.packages.length} member(s), all targets: ${e} error(s), ${w} warning(s)${f ? `, ${f} machine-applicable` : ""}`,
      problems,
      fixed,
      commands,
    };
  }

  // -------------------------------------------------------------- features

  features(): StageResult {
    const t = Date.now();
    const plan = featurePlan(this.packages, this.cfg.features.skip);
    const problems: Problem[] = plan.skipped.map((s) => ({
      stage: "features" as const,
      severity: "info" as const,
      crate: s.feature.split("/")[0],
      message: `feature ${s.feature} is not compiled here`,
      note: s.reason,
    }));
    if (!plan.enabled.length)
      return {
        stage: "features",
        status: stageStatus(problems),
        seconds: secs(t),
        summary: "no member feature to check",
        problems,
        fixed: 0,
        commands: [],
      };
    const args = [
      "check",
      "--workspace",
      "--all-targets",
      "--keep-going",
      "--message-format=json",
      "--features",
      plan.enabled.join(","),
    ];
    const run = this.cargo("features", args);
    problems.push(...this.problemsOf("features", run, "cargo check with every feature").problems);
    const e = problems.filter((p) => p.severity === "error").length;
    const w = problems.filter((p) => p.severity === "warning").length;
    return {
      stage: "features",
      status: stageStatus(problems),
      seconds: secs(t),
      summary: `${plan.enabled.length} feature(s) on at once, ${plan.skipped.length} skipped: ${e} error(s), ${w} new warning(s)`,
      problems,
      fixed: 0,
      commands: [
        `cargo check --workspace --all-targets --keep-going --features <${plan.enabled.length} member features>`,
      ],
    };
  }

  // -------------------------------------------------------------- targets

  /**
   * Environment of a target check. cargo-xwin drives `clang-cl` through the first `clang` on PATH, and the MSVC STL it
   * downloads refuses a Clang older than its own floor (STL1000), so the newest installed LLVM goes first.
   */
  private targetEnv(spec: TargetSpec): Record<string, string> {
    const env: Record<string, string> = { ...spec.env };
    if (spec.runner === "xwin" && !env.PATH && existsSync("/usr/lib")) {
      const llvm = newestLlvm(
        readdirSync("/usr/lib").filter((d) => existsSync(`/usr/lib/${d}/bin/clang`)),
      );
      if (llvm) env.PATH = `/usr/lib/${llvm}/bin:${process.env.PATH ?? ""}`;
    }
    return env;
  }

  targets(): StageResult {
    const t = Date.now();
    const problems: Problem[] = [];
    const commands: string[] = [];
    const installed = new Set(
      this.c
        .run("rustup", ["target", "list", "--installed"])
        .stdout.split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const parts: string[] = [];
    for (const spec of this.cfg.targets) {
      const unproven = (why: string) =>
        problems.push({
          stage: "targets",
          severity: "warning",
          message: `${spec.triple} was not checked: ${why}`,
        });
      if (!installed.has(spec.triple)) {
        unproven(`target not installed (rustup target add ${spec.triple})`);
        continue;
      }
      if (spec.runner === "xwin" && this.c.run("cargo", ["xwin", "--version"]).status !== 0) {
        unproven("cargo-xwin is not installed (cargo install --locked cargo-xwin)");
        continue;
      }
      const { packages, excluded } = targetPackages(this.packages, spec);
      for (const x of excluded)
        problems.push({
          stage: "targets",
          severity: "info",
          crate: x.crate,
          message: `${x.crate} is not checked for ${spec.triple}`,
          note: x.reason,
        });
      if (!packages.length) continue;
      const base = [
        ...(spec.runner === "xwin" ? ["xwin"] : []),
        "check",
        "--target",
        spec.triple,
        "--keep-going",
        "--message-format=json",
      ];
      const env = this.targetEnv(spec);
      const tag = (p: Problem): Problem => ({ ...p, message: `[${spec.triple}] ${p.message}` });
      let failed = 0;
      if (spec.isolate) {
        for (const name of packages) {
          const run = this.cargo(`target-${spec.triple}-${name}`, [...base, "-p", name], env);
          if (run.status === 0) {
            problems.push(...this.problemsOf("targets", run, name).problems.map(tag));
            continue;
          }
          failed++;
          // The member's own errors are listed; an error inside a dependency is the reason, reported once per member.
          const diags = parseDiagnostics(run.out, this.crateOf).filter((d) => d.level === "error");
          const own = diags.filter((d) => this.isMember(d));
          for (const d of own) {
            const key = diagnosticKey(d);
            if (this.reported.has(key)) continue;
            this.reported.add(key);
            problems.push(
              tag({
                stage: "targets",
                severity: "error",
                crate: d.crate,
                code: d.code,
                file: d.file,
                line: d.line,
                message: d.message,
              }),
            );
          }
          const dep = diags.find((d) => !this.isMember(d));
          const why = dep
            ? `dependency ${dep.crate} does not build: ${dep.message.split("\n")[0]!.slice(0, 200)}`
            : own.length
              ? `${own.length} error(s) in workspace code`
              : errorLines(run.log, 3).join(" | ").slice(0, 300);
          problems.push(
            tag({
              stage: "targets",
              severity: "error",
              crate: name,
              message: `${name} does not build: ${why}`,
            }),
          );
        }
        commands.push(
          `cargo ${base.slice(0, spec.runner === "xwin" ? 4 : 3).join(" ")} -p <each of ${packages.length} package(s)>`,
        );
      } else {
        const scope =
          spec.packages === "workspace" && !excluded.length
            ? ["--workspace"]
            : packages.flatMap((n) => ["-p", n]);
        const run = this.cargo(`target-${spec.triple}`, [...base, ...scope], env);
        commands.push(
          `cargo ${base.slice(0, spec.runner === "xwin" ? 4 : 3).join(" ")} <${packages.length} package(s)>`,
        );
        const found = this.problemsOf(
          "targets",
          run,
          `cargo check --target ${spec.triple}`,
        ).problems.map(tag);
        problems.push(...found);
        failed = found.filter((p) => p.severity === "error").length;
      }
      parts.push(
        `${spec.triple} ${packages.length} package(s)${spec.isolate ? " one by one" : ""}, ${failed} ${spec.isolate ? "failing" : "error(s)"}`,
      );
    }
    return {
      stage: "targets",
      status: stageStatus(problems),
      seconds: secs(t),
      summary: parts.join("; ") || "no target configured",
      problems,
      fixed: 0,
      commands,
    };
  }

  // -------------------------------------------------------------- test

  test(): StageResult {
    const t = Date.now();
    const problems: Problem[] = this.cfg.tests.exclude.map((x) => ({
      stage: "test" as const,
      severity: "info" as const,
      message: `tests matching \`${x.filter}\` are not run`,
      note: x.reason,
    }));
    const commands: string[] = [];
    const parts: string[] = [];
    const filter = this.cfg.tests.exclude.map((x) => `not (${x.filter})`).join(" & ");
    if (this.c.run("cargo", ["nextest", "--version"]).status === 0) {
      rmSync(join(this.c.root, JUNIT), { force: true });
      const args = [
        "nextest",
        "run",
        "--workspace",
        "--no-fail-fast",
        "--profile",
        "doctor",
        ...(filter ? ["-E", filter] : []),
      ];
      const run = this.cargo("test", args, {}, true);
      commands.push(run.command);
      if (existsSync(join(this.c.root, JUNIT))) {
        const j = parseJunit(this.c.read(JUNIT));
        for (const f of j.failures)
          problems.push({
            stage: "test",
            severity: "error",
            crate: f.suite.split("::")[0],
            message: `${f.suite} ${f.name}: ${f.message}`,
          });
        for (const f of j.flaky)
          problems.push({
            stage: "test",
            severity: "warning",
            crate: f.suite.split("::")[0],
            message: `flaky (passed on retry): ${f.suite} ${f.name}`,
          });
        parts.push(`${j.tests} test(s), ${j.failures.length} failed, ${j.flaky.length} flaky`);
        if (run.status !== 0 && !j.failures.length)
          problems.push({
            stage: "test",
            severity: "error",
            message: `cargo nextest exited ${run.status} without a failing test case: ${errorLines(run.out).join(" | ").slice(0, 900)}`,
          });
      } else
        problems.push({
          stage: "test",
          severity: "error",
          message: `the test binaries did not build or nextest did not run: ${errorLines(run.out).join(" | ").slice(0, 900)}`,
        });
    } else {
      const run = this.cargo("test", ["test", "--workspace", "--no-fail-fast"], {}, true);
      commands.push(run.command);
      const failed = parseLibtest(run.out);
      for (const f of failed)
        problems.push({ stage: "test", severity: "error", message: `${f.suite} ${f.name}` });
      if (run.status !== 0 && !failed.length)
        problems.push({
          stage: "test",
          severity: "error",
          message: `cargo test failed: ${errorLines(run.out).join(" | ").slice(0, 900)}`,
        });
      parts.push(`cargo test (nextest not installed), ${failed.length} failed`);
    }
    if (this.cfg.tests.doc) {
      const run = this.cargo(
        "doctest",
        ["test", "--workspace", "--doc", "--no-fail-fast"],
        {},
        true,
      );
      commands.push(run.command);
      const failed = parseLibtest(run.out);
      for (const f of failed)
        problems.push({
          stage: "test",
          severity: "error",
          crate: f.suite,
          message: `doc test ${f.suite} ${f.name}`,
        });
      if (run.status !== 0 && !failed.length)
        problems.push({
          stage: "test",
          severity: "error",
          message: `doc tests failed to build: ${errorLines(run.out).join(" | ").slice(0, 900)}`,
        });
      parts.push(`doc tests ${failed.length} failed`);
    }
    return {
      stage: "test",
      status: stageStatus(problems),
      seconds: secs(t),
      summary: parts.join("; "),
      problems,
      fixed: 0,
      commands,
    };
  }

  // -------------------------------------------------------------- deny

  deny(): StageResult {
    const t = Date.now();
    if (this.c.run("cargo-deny", ["--version"]).status !== 0) {
      return {
        stage: "deny",
        status: "problems",
        seconds: secs(t),
        summary: "cargo-deny is not installed",
        problems: [
          {
            stage: "deny",
            severity: "warning",
            message:
              "advisories were not checked: cargo-deny is not installed (cargo install --locked cargo-deny)",
          },
        ],
        fixed: 0,
        commands: [],
      };
    }
    const run = this.cargo("deny", ["deny", "--format", "json", "check", "advisories"], {}, true);
    const found = denyAdvisories(run.out);
    const holds = new Map(
      loadAdvisoryHolds(this.c)
        .filter((h) => h.ecosystem === "crates.io")
        .map((h) => [h.name, h.reason]),
    );
    const problems: Problem[] = [...found].map(([crate, ids]) =>
      holds.has(crate)
        ? {
            stage: "deny" as const,
            severity: "info" as const,
            crate,
            code: ids.join(","),
            message: `advisory held: ${crate} ${ids.join(", ")}`,
            note: holds.get(crate),
          }
        : {
            stage: "deny" as const,
            severity: "error" as const,
            crate,
            code: ids.join(","),
            message: `open advisory: ${crate} ${ids.join(", ")} (bump it, or record a hold in tools/config/deps/advisory-holds.json with the reason)`,
          },
    );
    const open = problems.filter((p) => p.severity === "error").length;
    return {
      stage: "deny",
      status: stageStatus(problems),
      seconds: secs(t),
      summary: `${found.size} crate(s) flagged, ${found.size - open} held, ${open} open`,
      problems,
      fixed: 0,
      commands: [run.command],
    };
  }

  // -------------------------------------------------------------- bumps

  async bumps(): Promise<StageResult> {
    const t = Date.now();
    const r = await rustStatus(this.c);
    const problems: Problem[] = [];
    if (r.toolchain.behind)
      problems.push({
        stage: "bumps",
        severity: "warning",
        message: `toolchain pin ${r.toolchain.pinned} is behind stable ${r.toolchain.stable}: yolo update tools rust --apply`,
      });
    for (const x of r.outdated.filter((o) => o.yanked))
      problems.push({
        stage: "bumps",
        severity: "error",
        crate: x.crate,
        message: `${x.crate} ${x.locked} is yanked: yolo update rust apply`,
      });
    for (const x of r.outdated.filter((o) => o.inRange)) {
      const why = x.held ?? x.owner;
      problems.push({
        stage: "bumps",
        severity: why ? "info" : "warning",
        crate: x.crate,
        message: `${x.crate} ${x.locked} is behind ${x.inRange} inside its requirement ${x.req}${why ? "" : ": yolo update rust apply"}`,
        note: why,
      });
    }
    for (const a of r.advisories.open)
      problems.push({
        stage: "bumps",
        severity: "error",
        crate: a.crate,
        code: a.ids.slice(0, 4).join(","),
        message: `open OSV advisory: ${a.crate} ${a.version} ${a.ids.slice(0, 4).join(", ")}`,
      });
    const held = r.outdated.filter((o) => o.held && o.beyond && !o.inRange);
    for (const x of held)
      problems.push({
        stage: "bumps",
        severity: "info",
        crate: x.crate,
        message: `${x.crate} stays ${x.locked} (latest ${x.beyond})`,
        note: x.held,
      });
    const majors = r.outdated.filter(
      (o) => o.beyond && !o.held && !o.owner && !o.exactPin && !o.inRange,
    );
    for (const x of majors)
      problems.push({
        stage: "bumps",
        severity: "info",
        crate: x.crate,
        message: `${x.crate} ${x.locked}: breaking release ${x.beyond} available`,
        note: `yolo update rust apply --skip-refresh --majors ${x.crate}`,
      });
    const free = majors.length;
    return {
      stage: "bumps",
      status: stageStatus(problems),
      seconds: secs(t),
      problems,
      fixed: 0,
      commands: ["yolo update rust status"],
      summary: `toolchain ${r.toolchain.pinned}${r.toolchain.behind ? ` (stable ${r.toolchain.stable})` : ""}; ${r.outdated.filter((o) => o.inRange).length} in-range, ${free} major(s) available, ${held.length} held; ${r.advisories.open.length} open advisory(ies), ${r.advisories.held.length} held`,
    };
  }
}

const secs = (t: number) => Math.round((Date.now() - t) / 1000);

const fmtProblem = (p: Problem) =>
  `  ${p.severity.padEnd(7)} ${(p.crate ?? "").padEnd(26)} ${p.file ? `${p.file}${p.line ? `:${p.line}` : ""}  ` : ""}${p.code ? `${p.code}  ` : ""}${p.message.split("\n")[0]!.slice(0, 220)}${p.fixable ? "  [rust fix]" : ""}${p.note ? `  (${p.note})` : ""}`;

function printStage(s: StageResult, verbose: boolean) {
  console.log(
    `doctor  ${s.stage.padEnd(9)} ${s.status.padEnd(8)} ${s.summary}${s.fixed ? `; repaired ${s.fixed}` : ""}  [${s.seconds}s]`,
  );
  const shown = s.problems.filter((p) => verbose || p.severity !== "info");
  for (const p of shown.slice(0, verbose ? shown.length : 60)) console.log(fmtProblem(p));
  if (!verbose && shown.length > 60)
    console.log(`  ... ${shown.length - 60} more in ${OUT_DIR}/report.json`);
  const notes = s.problems.length - shown.length;
  if (notes) console.log(`  ${notes} note(s) (vendored, skipped or held; --verbose lists them)`);
}

/** Entry point for `yolo update rust doctor|fix`. */
export async function runDoctor(c: Ctx, args: string[]): Promise<number> {
  const list = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? (args[i + 1] ?? "").split(",").filter(Boolean) : undefined;
  };
  const only = list("--only");
  const skip = list("--skip") ?? [];
  const unknown = [...(only ?? []), ...skip].filter(
    (s) => !(STAGES as readonly string[]).includes(s),
  );
  if (unknown.length) {
    console.error(`doctor: unknown stage ${unknown.join(", ")}; stages: ${STAGES.join(", ")}`);
    return 2;
  }
  const fix = args.includes("--fix");
  const verbose = args.includes("--verbose");
  let d: Doctor;
  try {
    d = new Doctor(c, fix, args.includes("--allow-dirty"), verbose && !c.json);
  } catch (e) {
    console.error(`doctor: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  const stages: StageResult[] = [];
  for (const stage of STAGES) {
    if ((only && !only.includes(stage)) || skip.includes(stage)) continue;
    if (!c.json) console.log(`doctor  ${stage.padEnd(9)} running...`);
    let result: StageResult;
    try {
      // oxlint-disable-next-line no-await-in-loop -- étapes du doctor séquentielles : ordre fixe d'affichage et de dépendance entre étapes
      result = stage === "bumps" ? await d.bumps() : d[stage]();
    } catch (e) {
      result = {
        stage,
        status: "failed",
        seconds: 0,
        summary: "stage crashed",
        problems: [
          {
            stage,
            severity: "error",
            message: `stage crashed: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        fixed: 0,
        commands: [],
      };
    }
    stages.push(result);
    if (!c.json) printStage(result, verbose);
  }
  const report: DoctorReport = {
    date: new Date().toISOString(),
    root: c.root,
    fix,
    stages,
    totals: totals(stages),
  };
  c.write(`${OUT_DIR}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  const t = report.totals;
  if (c.json) console.log(JSON.stringify(report, null, 2));
  else
    console.log(
      `doctor  result    ${t.errors} error(s), ${t.warnings} warning(s), ${t.notes} note(s)${t.fixed ? `, ${t.fixed} repaired` : ""}; report ${OUT_DIR}/report.json${!fix && stages.some((s) => s.problems.some((p) => p.fixable)) ? "; repair with: yolo update rust fix" : ""}`,
    );
  return exitCode(t, args.includes("--strict"));
}
