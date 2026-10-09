// SPDX-License-Identifier: Apache-2.0
/**
 * Python / uv ecosystem module: one structured, documented, automated bump of the uv pin, every `uv.lock` of the
 * Python workspace (default `py/`, the first `inventory.pythonRoots` entry of tools/config/deps/watch.json),
 * the managed interpreters and the Python gates. Doc: docs/operations/infra/update/UV.md.
 *
 *   status    uv installed vs pinned vs latest, `required-version` and CI pins, `uv lock --check` per lock,
 *             direct dependencies of every pyproject vs PyPI latest (current, held, open), resolver-limited
 *             packages, OSV advisories that no hold covers, Python version policy
 *   plan      `uv lock --upgrade --dry-run` per lock, the open direct rows and the majors that need a decision
 *   apply     snapshot, `uv python upgrade`, `uv lock --upgrade` (or `--upgrade-package a,b` only), `uv sync`,
 *             then the verify pass; the lock diff is journalled in tools/config/deps/journal.json
 *   verify    uv pins agree, `uv lock --check` per lock, ruff over the whole tree, pytest of every member with tests
 *   rollback  restore the lock files from the newest snapshot under target/update/uv/ (or `git checkout -- uv.lock`)
 *
 * Reuses ../tools.ts (installed uv, latest uv), ../pins.ts (uv pin), ../cargo.ts (lock diff), ../deps/sync.ts
 * (journal types) and ../deps/inventory.ts (OSV, bounded pool, cached HTTP). Report-only unless `apply`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { Ctx } from "../context.ts";
import { check as checkPins } from "../pins.ts";
import { installed, latest as latestTool } from "../tools.ts";
import { lockDiff, lockMap } from "../cargo.ts";
import { Cache, cachedText, osv, pool, type Dep } from "../deps/inventory.ts";
import type { Change } from "../deps/sync.ts";

// ---------------------------------------------------------------- constants

export const HOLDS_FILE = "tools/config/deps/uv-holds.json";
export const ADVISORY_FILE = "tools/config/deps/advisory-holds.json";
export const SNAPSHOT_DIR = "target/update/uv";
/** Extras installed so that every member suite can be collected (networkx for the RAG tests, datasketch for train). */
export const TEST_EXTRAS = ["rag", "dedup"] as const;
const SKIP_DIRS = /(^|\/)(\.venv|venv|node_modules|docs|\.git|target|dist|build|__pycache__)(\/|$)/;

// ---------------------------------------------------------------- PEP 440 (versions and specifiers)

export type PyVersion = {
  epoch: number;
  release: number[];
  pre?: [number, number];
  post?: number;
  dev?: number;
  local?: string;
};

const VERSION_RE =
  /^\s*v?(?:(?<epoch>\d+)!)?(?<release>\d+(?:\.\d+)*)(?:[-_.]?(?<preL>alpha|a|beta|b|preview|pre|c|rc)[-_.]?(?<preN>\d+)?)?(?:-(?<postA>\d+)|[-_.]?(?<postL>post|rev|r)[-_.]?(?<postB>\d+)?)?(?:[-_.]?(?<devL>dev)[-_.]?(?<devN>\d+)?)?(?:\+(?<local>[a-z0-9]+(?:[-_.][a-z0-9]+)*))?\s*$/i;
const PRE_RANK: Record<string, number> = {
  a: 0,
  alpha: 0,
  b: 1,
  beta: 1,
  c: 2,
  rc: 2,
  pre: 2,
  preview: 2,
};

export function parsePy(v: string): PyVersion | undefined {
  const g = VERSION_RE.exec(v)?.groups;
  if (!g) return undefined;
  return {
    epoch: Number(g.epoch ?? 0),
    release: g.release!.split(".").map(Number),
    pre: g.preL ? [PRE_RANK[g.preL.toLowerCase()] ?? 0, Number(g.preN ?? 0)] : undefined,
    post: g.postA !== undefined ? Number(g.postA) : g.postL ? Number(g.postB ?? 0) : undefined,
    dev: g.devL ? Number(g.devN ?? 0) : undefined,
    local: g.local,
  };
}

const cmpNum = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);

// Clé de comparaison de la phase PEP 440 (pre, post, dev) d'une version.
const phase = (v: PyVersion): [number, number, number, number] => {
  // dev of a final release sorts before its pre-releases; a pre-release sorts before the final release.
  const preKey = v.pre ? v.pre : v.post === undefined && v.dev !== undefined ? [-1, 0] : [3, 0];
  return [preKey[0]!, preKey[1]!, v.post ?? -1, v.dev ?? Number.POSITIVE_INFINITY];
};

/** PEP 440 order: epoch, release (zero padded), dev < pre < final < post, then local. */
export function cmpPy(a: string, b: string): -1 | 0 | 1 {
  const x = parsePy(a);
  const y = parsePy(b);
  if (!x || !y) return a < b ? -1 : a > b ? 1 : 0;
  if (x.epoch !== y.epoch) return cmpNum(x.epoch, y.epoch);
  for (let i = 0; i < Math.max(x.release.length, y.release.length); i++) {
    const d = cmpNum(x.release[i] ?? 0, y.release[i] ?? 0);
    if (d) return d;
  }
  const p = phase(x);
  const q = phase(y);
  for (let i = 0; i < 4; i++) {
    const d = cmpNum(p[i]!, q[i]!);
    if (d) return d;
  }
  return x.local === y.local ? 0 : !x.local ? -1 : !y.local ? 1 : x.local < y.local ? -1 : 1;
}

export const isPre = (v: string): boolean => {
  const p = parsePy(v);
  return !!p && (p.pre !== undefined || p.dev !== undefined);
};
export const major = (v: string): number | undefined => parsePy(v)?.release[0];

/** True when `version` satisfies every clause of a PEP 440 specifier set (`>=1.26,<2`, `==2.4.*`, `~=0.6.1`). */
export function satisfies(rawVersion: string, specifier: string): boolean {
  const clauses = specifier
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return clauses.every((c) => {
    const m = /^(===|==|!=|~=|<=|>=|<|>)\s*(\S+)$/.exec(c);
    if (!m) return true; // unknown syntax never blocks
    const [, op, target] = m as unknown as [string, string, string];
    // a local label (`2.8.0+cu129`) is ignored unless the specifier names one (PEP 440)
    const version = target.includes("+") ? rawVersion : rawVersion.split("+")[0]!;
    const wild = target.endsWith(".*");
    const base = wild ? target.slice(0, -2) : target;
    if (op === "==" || op === "!=" || op === "===") {
      const eq = wild ? versionPrefix(version, base) : cmpPy(version, base) === 0;
      return op === "!=" ? !eq : eq;
    }
    if (op === "~=") {
      const parts = base.split(".");
      if (parts.length < 2) return cmpPy(version, base) >= 0;
      return cmpPy(version, base) >= 0 && versionPrefix(version, parts.slice(0, -1).join("."));
    }
    const d = cmpPy(version, base);
    return op === "<=" ? d <= 0 : op === ">=" ? d >= 0 : op === "<" ? d < 0 : d > 0;
  });
}

function versionPrefix(version: string, prefix: string): boolean {
  const v = parsePy(version)?.release;
  const p = prefix.split(".").map(Number);
  return !!v && p.every((n, i) => (v[i] ?? 0) === n);
}

/** Lowest interpreter a `requires-python` accepts, e.g. `>=3.11,<4` -> `3.11`, `==3.12.*` -> `3.12`. */
export function pythonFloor(requires: string | undefined): string | undefined {
  if (!requires) return undefined;
  const m = /(?:>=|==|~=)\s*(\d+(?:\.\d+)*)/.exec(requires);
  return m?.[1];
}

/** Does a release published with `requiresPython` install on the project's lowest supported interpreter? */
export function pythonAccepts(
  requiresPython: string | undefined,
  floor: string | undefined,
): boolean {
  if (!requiresPython || !floor) return true;
  return satisfies(floor, requiresPython);
}

// ---------------------------------------------------------------- requirements and pyproject

export type Requirement = { name: string; extras: string[]; spec: string; marker?: string };

export const normName = (n: string): string => n.toLowerCase().replace(/[-_.]+/g, "-");

/** PEP 508 name, extras, version specifier and marker. Direct URL requirements (`name @ url`) have no specifier. */
export function parseRequirement(text: string): Requirement | undefined {
  const [head = "", marker] = text.split(";", 2).map((s) => s.trim());
  const m =
    /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[([^\]]*)\])?\s*(?:\(([^)]*)\)|([^@]*))?(?:@.*)?$/.exec(
      head,
    );
  if (!m) return undefined;
  return {
    name: normName(m[1]!),
    extras: (m[2] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    spec: (m[3] ?? m[4] ?? "").replace(/\s+/g, ""),
    marker: marker || undefined,
  };
}

export type Direct = { file: string; section: string; req: Requirement };
export type PyProject = {
  name?: string;
  requiresPython?: string;
  requiredVersion?: string;
  members: string[];
  deps: Direct[];
};

type Toml = Record<string, any>;
const parseToml = (text: string): Toml => (Bun.TOML.parse(text) ?? {}) as Toml;

/** Direct requirements of one pyproject.toml: dependencies, extras, dependency groups, build requirements. */
export function parsePyProject(file: string, text: string): PyProject {
  const t = parseToml(text);
  const deps: Direct[] = [];
  const push = (section: string, list: unknown) => {
    for (const s of Array.isArray(list) ? list : []) {
      const req = typeof s === "string" ? parseRequirement(s) : undefined;
      if (req) deps.push({ file, section, req });
    }
  };
  push("dependencies", t.project?.dependencies);
  for (const [extra, list] of Object.entries<unknown>(t.project?.["optional-dependencies"] ?? {}))
    push(`extra:${extra}`, list);
  for (const [group, list] of Object.entries<unknown>(t["dependency-groups"] ?? {}))
    push(`group:${group}`, list);
  push("group:dev", t.tool?.uv?.["dev-dependencies"]);
  push("build", t["build-system"]?.requires);
  return {
    name: t.project?.name ? normName(String(t.project.name)) : undefined,
    requiresPython: t.project?.["requires-python"],
    requiredVersion: t.tool?.uv?.["required-version"],
    members: (t.tool?.uv?.workspace?.members ?? []) as string[],
    deps,
  };
}

/** `required-version = "==0.12.22"` -> `0.12.22` (only an exact pin is comparable to the installed uv). */
export function exactRequired(requiredVersion: string | undefined): string | undefined {
  return /^==\s*(\d+\.\d+\.\d+)$/.exec(requiredVersion ?? "")?.[1];
}

// ---------------------------------------------------------------- uv.lock

export type LockPkg = {
  name: string;
  version: string;
  kind: "registry" | "git" | "workspace" | "url" | "other";
};
export type LockInfo = { revision?: number; requiresPython?: string; packages: LockPkg[] };

export function parseLock(text: string): LockInfo {
  const t = parseToml(text);
  const packages: LockPkg[] = [];
  for (const p of (t.package ?? []) as Toml[]) {
    if (!p.name || !p.version) continue;
    const s = (p.source ?? {}) as Toml;
    const kind: LockPkg["kind"] = s.registry
      ? "registry"
      : s.git
        ? "git"
        : s.editable || s.virtual || s.directory
          ? "workspace"
          : s.url
            ? "url"
            : "other";
    packages.push({ name: normName(String(p.name)), version: String(p.version), kind });
  }
  return { revision: t.revision, requiresPython: t["requires-python"], packages };
}

/** Versions of each registry package in a lock, by normalized name. */
export function lockVersions(info: LockInfo): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const p of info.packages)
    if (p.kind === "registry") (m.get(p.name) ?? m.set(p.name, []).get(p.name)!).push(p.version);
  return m;
}

// Liste de versions séparées par des virgules, sans espaces ni préfixe v.
const strip = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim().replace(/^v/, ""))
    .join(",");

/** Parse the `Update|Add|Remove name vA -> vB` lines of `uv lock` (real and `--dry-run`). */
export function parseLockOutput(output: string): Change[] {
  const out: Change[] = [];
  for (const line of output.split("\n")) {
    const m = /^\s*(Updated?|Add(?:ed)?|Removed?)\s+(\S+)\s+v?(.*)$/.exec(line);
    if (!m) continue;
    const [, verb, name, rest] = m as unknown as [string, string, string, string];
    if (verb.startsWith("Add"))
      out.push({ ecosystem: "uv-lock", name, from: "(new)", to: strip(rest) });
    else if (verb.startsWith("Remove"))
      out.push({ ecosystem: "uv-lock", name, from: strip(rest), to: "(removed)" });
    else {
      const [from, to] = rest.split("->").map((s) => strip(s));
      out.push({ ecosystem: "uv-lock", name, from: from ?? "", to: to ?? "" });
    }
  }
  return out;
}

export type BumpKind = "major" | "minor" | "patch" | "pre" | "none";
export function bumpKind(from: string, to: string): BumpKind {
  const a = parsePy(from.split(",").at(-1) ?? from);
  const b = parsePy(to.split(",").at(-1) ?? to);
  if (!a || !b || cmpPy(from, to) >= 0) return "none";
  if (isPre(to)) return "pre";
  if ((b.release[0] ?? 0) !== (a.release[0] ?? 0)) return "major";
  if ((b.release[1] ?? 0) !== (a.release[1] ?? 0)) return "minor";
  return "patch";
}

// ---------------------------------------------------------------- holds

/** A bump that policy refuses: stay at `maxMajor` (or `maxVersion`) until the blocker moves. `name` may end in `*`. */
export type Hold = {
  name: string;
  maxMajor?: number;
  maxVersion?: string;
  reason: string;
  since?: string;
};
export type AdvisoryHold = { ecosystem: string; name: string; reason: string };

export function parseHolds(text: string): Hold[] {
  return (JSON.parse(text) as { holds?: Hold[] }).holds ?? [];
}

const nameMatches = (pattern: string, name: string) =>
  pattern.endsWith("*")
    ? name.startsWith(normName(pattern.slice(0, -1)))
    : normName(pattern) === name;

/** Hold that refuses `latest` for `name`: a release in a major above `maxMajor`, or above `maxVersion`. */
export function holdFor(holds: Hold[], name: string, latest: string | undefined): Hold | undefined {
  if (!latest) return undefined;
  const mj = major(latest);
  return holds.find(
    (h) =>
      nameMatches(h.name, name) &&
      ((h.maxMajor !== undefined && mj !== undefined && mj > h.maxMajor) ||
        (h.maxVersion !== undefined && cmpPy(latest, h.maxVersion) > 0) ||
        (h.maxMajor === undefined && h.maxVersion === undefined)),
  );
}

export const advisoryHeld = (holds: AdvisoryHold[], name: string): AdvisoryHold | undefined =>
  holds.find((h) => h.ecosystem === "PyPI" && normName(h.name) === normName(name));

// ---------------------------------------------------------------- rows

export type Release = { latest?: string; requiresPython?: string };
export type DirectState = "current" | "held" | "open" | "unlocked" | "unknown";
export type DirectRow = {
  name: string;
  files: string[];
  sections: string[];
  spec: string;
  locked: string[];
  latest?: string;
  state: DirectState;
  cause?: "manifest-cap" | "python-floor" | "hold";
  kind: BumpKind;
  reason?: string;
  /** A manifest cap (`==`, `<`, `~=`) with no entry in tools/config/deps/uv-holds.json or advisory-holds.json. */
  undocumented?: boolean;
};

/**
 * Decide one direct dependency. Locked versions that satisfy the specifier are compared with the latest release: a
 * release the specifier excludes is a manifest cap, one that needs a newer interpreter than the project's floor is
 * a python-floor hold, and the rest is open (bumpable by `apply`).
 */
export function classifyDirect(i: {
  name: string;
  spec: string;
  files: string[];
  sections: string[];
  locked: string[];
  release?: Release;
  floor?: string;
  holds: Hold[];
  advisoryHolds?: AdvisoryHold[];
}): DirectRow {
  // build requirements are installed in an isolated build environment, never in uv.lock: an exact pin is the "locked" version
  const buildOnly = i.sections.every((x) => x === "build");
  const locked =
    i.locked.length || !buildOnly
      ? i.locked
      : /^==(\d[^,*]*)$/.exec(i.spec)?.[1]
        ? [/^==(\d[^,*]*)$/.exec(i.spec)![1]!]
        : [];
  const base: DirectRow = {
    name: i.name,
    files: i.files,
    sections: i.sections,
    spec: i.spec,
    locked,
    latest: i.release?.latest,
    state: "current",
    kind: "none",
  };
  if (!locked.length) return buildOnly ? base : { ...base, state: "unlocked" };
  const latest = i.release?.latest;
  if (!latest) return { ...base, state: "unknown" };
  const fits = locked.filter((v) => satisfies(v, i.spec));
  const best = [...(fits.length ? fits : locked)].toSorted(cmpPy).at(-1)!;
  if (cmpPy(best, latest) >= 0) return base;
  const row: DirectRow = { ...base, kind: bumpKind(best, latest) };
  const hold = holdFor(i.holds, i.name, latest);
  const advisory = advisoryHeld(i.advisoryHolds ?? [], i.name);
  if (i.spec && !satisfies(latest, i.spec)) {
    const reason = hold?.reason ?? advisory?.reason;
    return {
      ...row,
      state: "held",
      cause: "manifest-cap",
      reason: reason ?? `specifier ${i.spec} excludes ${latest}`,
      undocumented: !reason,
    };
  }
  if (!pythonAccepts(i.release?.requiresPython, i.floor))
    return {
      ...row,
      state: "held",
      cause: "python-floor",
      reason: `${latest} needs Python ${i.release?.requiresPython}; the project supports ${i.floor}`,
    };
  if (hold) return { ...row, state: "held", cause: "hold", reason: hold.reason };
  return { ...row, state: "open" };
}

export type TransitiveRow = {
  lock: string;
  name: string;
  locked: string;
  latest: string;
  held?: string;
};

/** Registry packages behind PyPI latest that no pyproject names: the resolver keeps them back, holds explain why. */
export function transitiveBehind(i: {
  lock: string;
  versions: Map<string, string[]>;
  directNames: Set<string>;
  latest: Map<string, Release>;
  holds: Hold[];
}): TransitiveRow[] {
  const out: TransitiveRow[] = [];
  for (const [name, versions] of i.versions) {
    if (i.directNames.has(name)) continue;
    const latest = i.latest.get(name)?.latest;
    const best = [...versions].toSorted(cmpPy).at(-1)!;
    if (latest && cmpPy(best, latest) < 0)
      out.push({
        lock: i.lock,
        name,
        locked: best,
        latest,
        held: holdFor(i.holds, name, latest)?.reason,
      });
  }
  return out.toSorted((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- python policy

export type PyInterpreter = { version: string; managed: boolean; installed: boolean };

/**
 * Python version policy: the interpreter named by `.python-version` is installed and satisfies every workspace
 * `requires-python`; each uv-managed minor runs the newest patch uv offers.
 */
export function pythonPolicy(i: {
  pinned?: string;
  requires: { file: string; spec: string }[];
  interpreters: PyInterpreter[];
}): string[] {
  const out: string[] = [];
  const have = i.interpreters.filter((x) => x.installed);
  if (i.pinned && !have.some((x) => x.version.startsWith(`${i.pinned}.`) || x.version === i.pinned))
    out.push(
      `.python-version ${i.pinned} has no installed interpreter (uv python install ${i.pinned})`,
    );
  for (const r of i.requires) {
    if (i.pinned && r.spec && !satisfies(`${i.pinned}.0`, r.spec))
      out.push(`${r.file}: requires-python ${r.spec} excludes the pinned interpreter ${i.pinned}`);
  }
  const newest = new Map<string, string>();
  for (const x of i.interpreters.filter((y) => y.managed)) {
    const minor = x.version.split(".").slice(0, 2).join(".");
    if (!newest.has(minor) || cmpPy(newest.get(minor)!, x.version) < 0)
      newest.set(minor, x.version);
  }
  for (const x of have.filter((y) => y.managed)) {
    const minor = x.version.split(".").slice(0, 2).join(".");
    const top = newest.get(minor)!;
    if (cmpPy(x.version, top) < 0 && !have.some((y) => y.managed && y.version === top))
      out.push(`managed ${x.version} is behind ${top} (uv python upgrade)`);
  }
  return out;
}

// ---------------------------------------------------------------- arguments

export type UvArgs = {
  sub: string;
  packages: string[];
  offline: boolean;
  json: boolean;
  apply: boolean;
  skipTests: boolean;
  root?: string;
  pyRoot?: string;
};

export function parseArgs(argv: string[]): UvArgs {
  const a: UvArgs = {
    sub: "status",
    packages: [],
    offline: false,
    json: false,
    apply: false,
    skipTests: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (x === "--offline") a.offline = true;
    else if (x === "--json") a.json = true;
    else if (x === "--apply") a.apply = true;
    else if (x === "--skip-tests") a.skipTests = true;
    else if (x === "--root") a.root = argv[++i];
    else if (x === "--py-root") a.pyRoot = argv[++i];
    else if (x === "--upgrade-package")
      a.packages.push(
        ...(argv[++i] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    else if (x.startsWith("--upgrade-package="))
      a.packages.push(
        ...x
          .slice(18)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    else rest.push(x);
  }
  a.packages = [...new Set(a.packages.map(normName))];
  a.sub = rest[0] ?? "status";
  return a;
}

/** `uv lock` arguments for a full upgrade or for named packages only. */
export function lockArgs(packages: string[], extra: string[] = []): string[] {
  return [
    "lock",
    ...(packages.length ? packages.flatMap((p) => ["--upgrade-package", p]) : ["--upgrade"]),
    ...extra,
  ];
}

/** `uv sync` arguments that install the whole workspace plus the test extras from the lock only. */
export function syncArgs(extras: readonly string[] = TEST_EXTRAS): string[] {
  return ["sync", "--all-packages", "--locked", ...extras.flatMap((e) => ["--extra", e])];
}

// ---------------------------------------------------------------- repository access

export type Layout = { pyRoot: string; locks: string[]; projects: string[] };

export function expandHome(p: string): string {
  return p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

export function pythonRoot(c: Ctx, override?: string): string | undefined {
  const configured =
    c.jsonFile<{ inventory?: { pythonRoots?: string[] } }>("tools/config/deps/watch.json", {})
      .inventory?.pythonRoots ?? [];
  const candidates = [override, process.env.APHRODY_PY_ROOT, ...configured, "py"]
    .filter((x): x is string => !!x)
    .map((x) => resolve(c.root, expandHome(x)));
  return candidates.find(
    (d) => existsSync(join(d, "pyproject.toml")) && existsSync(join(d, "uv.lock")),
  );
}

/** Directories with a `uv.lock` and every pyproject.toml, relative to the Python root (vendored docs excluded). */
export function discover(pyRoot: string): Layout {
  const scan = (pattern: string) =>
    [...new Bun.Glob(pattern).scanSync({ cwd: pyRoot })]
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => !SKIP_DIRS.test(f))
      .toSorted();
  return {
    pyRoot,
    locks: scan("**/uv.lock").map((f) => dirname(f)),
    projects: scan("**/pyproject.toml"),
  };
}

/** Lock owning a pyproject: the nearest ancestor directory (itself included) that has its own `uv.lock`. */
export function lockFor(project: string, locks: string[]): string | undefined {
  const dir = dirname(project);
  return locks
    .filter((l) => l === "." || dir === l || dir.startsWith(`${l}/`))
    .toSorted((a, b) => b.length - a.length)[0];
}

type Run = { status: number | null; stdout: string; stderr: string };
type Runner = (cmd: string, args: string[], cwd: string, inherit?: boolean) => Run;
const defaultRunner: Runner = (cmd, args, cwd, inherit) => {
  const r = Bun.spawnSync([cmd, ...args], {
    windowsHide: true,
    cwd,
    stdout: inherit ? "inherit" : "pipe",
    stderr: inherit ? "inherit" : "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    status: r.exitCode,
    stdout: r.stdout?.toString() ?? "",
    stderr: r.stderr?.toString() ?? "",
  };
};

// ---------------------------------------------------------------- registries

export function parsePypi(text: string): Release {
  const d = JSON.parse(text) as {
    info?: { version?: string; requires_python?: string };
    releases?: Record<string, { requires_python?: string | null; yanked?: boolean }[]>;
  };
  const latest = d.info?.version;
  const files = (latest && d.releases?.[latest]) || [];
  return {
    latest,
    requiresPython:
      files.find((f) => f.requires_python)?.requires_python ?? d.info?.requires_python ?? undefined,
  };
}

async function fetchReleases(
  c: Ctx,
  names: string[],
  offline: boolean,
): Promise<Map<string, Release>> {
  const out = new Map<string, Release>();
  if (offline) return out;
  const cache = new Cache(join(c.root, "target", "deps-inventory", "cache"));
  await pool(names, 12, async (n) => {
    const text = await cachedText(cache, `https://pypi.org/pypi/${n}/json`);
    if (text)
      try {
        out.set(n, parsePypi(text));
      } catch {
        /* malformed registry answer: row stays unknown */
      }
  });
  return out;
}

// ---------------------------------------------------------------- status

export type UvTool = {
  installed?: string;
  pinned?: string;
  latest?: string;
  required: { file: string; version?: string }[];
};
export type LockState = {
  dir: string;
  fresh: boolean;
  revision?: number;
  packages: number;
  detail?: string;
};
export type Advisory = { name: string; version: string; ids: string[]; reason?: string };
export type UvStatus = {
  pyRoot: string;
  tool: UvTool;
  locks: LockState[];
  direct: DirectRow[];
  transitive: TransitiveRow[];
  advisories: { open: Advisory[]; held: Advisory[] };
  python: string[];
  interpreters: PyInterpreter[];
};

export function loadHolds(c: Ctx): Hold[] {
  return c.exists(HOLDS_FILE) ? parseHolds(c.read(HOLDS_FILE)) : [];
}
export function loadAdvisoryHolds(c: Ctx): AdvisoryHold[] {
  return c.jsonFile<{ holds?: AdvisoryHold[] }>(ADVISORY_FILE, {}).holds ?? [];
}

function readInterpreters(pyRoot: string, run: Runner): PyInterpreter[] {
  const r = run("uv", ["python", "list", "--output-format", "json"], pyRoot);
  if (r.status !== 0) return [];
  try {
    return (JSON.parse(r.stdout) as { version: string; path: string | null }[]).map((x) => ({
      version: x.version,
      installed: !!x.path,
      managed: x.path ? x.path.includes("/uv/python/") || x.path.includes("\\uv\\python\\") : true,
    }));
  } catch {
    return [];
  }
}

export const lockLabel = (dir: string): string => (dir === "." ? "uv.lock" : `${dir}/uv.lock`);

export function lockStates(layout: Layout, run: Runner = defaultRunner): LockState[] {
  return layout.locks.map((dir) => {
    const cwd = join(layout.pyRoot, dir);
    const info = parseLock(readFileSync(join(cwd, "uv.lock"), "utf8"));
    const r = run("uv", ["lock", "--check"], cwd);
    return {
      dir,
      fresh: r.status === 0,
      revision: info.revision,
      packages: info.packages.length,
      detail: r.status === 0 ? undefined : (r.stderr || r.stdout).trim().split("\n").at(-1),
    };
  });
}

export async function collectStatus(
  c: Ctx,
  o: { pyRoot?: string; offline?: boolean; advisories?: boolean; run?: Runner } = {},
): Promise<UvStatus | undefined> {
  const run = o.run ?? defaultRunner;
  const pyRoot = pythonRoot(c, o.pyRoot);
  if (!pyRoot) return undefined;
  const layout = discover(pyRoot);
  const holds = loadHolds(c);
  const advisoryHolds = loadAdvisoryHolds(c);

  const projects = layout.projects.map((f) => ({
    file: f,
    p: parsePyProject(f, readFileSync(join(pyRoot, f), "utf8")),
  }));
  const members = new Set(projects.map((x) => x.p.name).filter((n): n is string => !!n));
  const lockInfos = new Map(
    layout.locks.map((d) => [d, parseLock(readFileSync(join(pyRoot, d, "uv.lock"), "utf8"))]),
  );
  const lockVers = new Map([...lockInfos].map(([d, i]) => [d, lockVersions(i)]));

  const names = new Set<string>();
  for (const v of lockVers.values()) for (const n of v.keys()) names.add(n);
  for (const { p } of projects) for (const d of p.deps) names.add(d.req.name); // build requirements are not in any lock
  const releases = await fetchReleases(c, [...names], !!o.offline);

  // direct dependencies, merged by (name, specifier) across every pyproject
  const merged = new Map<
    string,
    {
      name: string;
      spec: string;
      files: Set<string>;
      sections: Set<string>;
      locked: Set<string>;
      floor?: string;
    }
  >();
  for (const { file, p } of projects) {
    const lock = lockFor(file, layout.locks);
    // the lock's requires-python is the intersection the resolver works with; the member's own value is the fallback
    const floor =
      pythonFloor(lock ? lockInfos.get(lock)?.requiresPython : undefined) ??
      pythonFloor(p.requiresPython);
    for (const d of p.deps) {
      if (members.has(d.req.name)) continue; // a workspace member, resolved locally
      const key = `${d.req.name}\u0000${d.req.spec}`;
      const row =
        merged.get(key) ??
        merged
          .set(key, {
            name: d.req.name,
            spec: d.req.spec,
            files: new Set(),
            sections: new Set(),
            locked: new Set(),
            floor,
          })
          .get(key)!;
      row.files.add(file);
      row.sections.add(d.section);
      if (floor && (!row.floor || cmpPy(floor, row.floor) < 0)) row.floor = floor; // the lowest floor of the locks that carry it
      for (const v of (lock ? lockVers.get(lock)?.get(d.req.name) : undefined) ?? [])
        row.locked.add(v);
    }
  }
  const direct = [...merged.values()]
    .map((m) =>
      classifyDirect({
        name: m.name,
        spec: m.spec,
        files: [...m.files],
        sections: [...m.sections],
        locked: [...m.locked],
        release: releases.get(m.name),
        floor: m.floor,
        holds,
        advisoryHolds,
      }),
    )
    .toSorted((a, b) => a.name.localeCompare(b.name));

  const directNames = new Set(direct.map((d) => d.name));
  const transitive = [...lockVers].flatMap(([lock, versions]) =>
    transitiveBehind({ lock, versions, directNames, latest: releases, holds }),
  );
  const allVersions = new Map<string, string[]>();
  for (const v of lockVers.values())
    for (const [n, list] of v)
      allVersions.set(n, [...new Set([...(allVersions.get(n) ?? []), ...list])]);

  const advisories: UvStatus["advisories"] = { open: [], held: [] };
  if (o.advisories !== false && !o.offline) {
    const deps: Dep[] = [...allVersions].flatMap(([name, vs]) =>
      vs.map((version) => ({ ecosystem: "PyPI" as const, name, version })),
    );
    const hits = await osv(deps);
    for (const d of deps) {
      const ids = hits.get(`PyPI:${d.name}@${d.version}`);
      if (!ids?.length) continue;
      const held = advisoryHeld(advisoryHolds, d.name);
      (held ? advisories.held : advisories.open).push({
        name: d.name,
        version: d.version,
        ids,
        reason: held?.reason,
      });
    }
  }

  const pinned = checkPins(c).find((r) => r.tool === "uv")?.pin;
  const required = projects
    .filter((x) => x.p.requiredVersion)
    .map((x) => ({
      file: x.file,
      version: exactRequired(x.p.requiredVersion) ?? x.p.requiredVersion,
    }));
  const tool: UvTool = {
    installed: installed(c, "uv"),
    pinned,
    latest: o.offline ? undefined : await latestTool("uv", { pypi: "uv", github: "astral-sh/uv" }),
    required,
  };
  const interpreters = readInterpreters(pyRoot, run);
  const pyFile = join(pyRoot, ".python-version");
  const python = pythonPolicy({
    pinned: existsSync(pyFile) ? readFileSync(pyFile, "utf8").trim() : undefined,
    requires: projects
      .filter((x) => x.p.requiresPython && x.p.name)
      .map((x) => ({ file: x.file, spec: x.p.requiresPython! })),
    interpreters,
  });
  return {
    pyRoot,
    tool,
    locks: lockStates(layout, run),
    direct,
    transitive,
    advisories,
    python,
    interpreters,
  };
}

/** Problems that make `status` and `verify` exit 1. */
export function problems(s: UvStatus): string[] {
  const out: string[] = [];
  const t = s.tool;
  if (t.installed && t.pinned && t.installed !== t.pinned)
    out.push(
      `uv installed ${t.installed} differs from the pin ${t.pinned} (yolo update tools uv --apply)`,
    );
  for (const r of t.required)
    if (t.pinned && r.version !== t.pinned)
      out.push(
        `${r.file}: required-version ${r.version} differs from the pin ${t.pinned} (yolo update pins apply uv ${t.pinned})`,
      );
  for (const l of s.locks)
    if (!l.fresh) out.push(`${lockLabel(l.dir)} is stale: ${l.detail ?? "uv lock --check failed"}`);
  for (const d of s.direct)
    if (d.undocumented)
      out.push(`${d.name} ${d.spec}: manifest cap without a reason in ${HOLDS_FILE}`);
  for (const a of s.advisories.open)
    out.push(`advisory ${a.name} ${a.version}: ${a.ids.slice(0, 3).join(", ")}`);
  for (const p of s.python) out.push(`python: ${p}`);
  return out;
}

export function renderStatus(s: UvStatus): string[] {
  const t = s.tool;
  const behind = t.latest && t.pinned && cmpPy(t.pinned, t.latest) < 0;
  const lines = [
    `uv     installed ${t.installed ?? "-"}  pinned ${t.pinned ?? "?"}  latest ${t.latest ?? "?"}${behind ? "  <- behind" : ""}`,
  ];
  for (const r of t.required) lines.push(`uv     required-version ${r.version} in ${r.file}`);
  lines.push(`root   ${s.pyRoot}`);
  for (const l of s.locks)
    lines.push(
      `lock   ${lockLabel(l.dir).padEnd(34)} revision ${l.revision ?? "?"}  ${l.packages} packages  ${l.fresh ? "fresh" : `STALE (${l.detail ?? "uv lock --check"})`}`,
    );
  const group = (state: DirectState) => s.direct.filter((d) => d.state === state);
  lines.push(
    `direct ${s.direct.length} requirement(s): ${group("current").length} current, ${group("held").length} held, ${group("open").length} open, ${group("unlocked").length + group("unknown").length} unlocked or unknown`,
  );
  for (const d of [...group("unlocked"), ...group("unknown")])
    lines.push(
      `${d.state.padEnd(6)} ${d.name} ${d.spec || "(any)"}  ${d.sections.join(",")} in ${d.files.join(",")}${d.state === "unlocked" ? "  (not in the owning uv.lock: optional or marker-gated)" : "  (no PyPI answer)"}`,
    );
  for (const d of group("open"))
    lines.push(
      `open   ${d.name} ${d.spec || "(any)"}  ${d.locked.join(",")} -> ${d.latest}  [${d.kind}]  ${d.sections.join(",")}`,
    );
  for (const d of group("held"))
    lines.push(
      `held   ${d.name} ${d.spec || "(any)"}  ${d.locked.join(",")} -> ${d.latest}  [${d.cause}${d.undocumented ? ", NO REASON" : ""}] ${d.reason}`,
    );
  const free = s.transitive.filter((r) => !r.held);
  lines.push(
    `trans  ${s.transitive.length} resolver-limited package(s) behind latest: ${s.transitive.length - free.length} explained by a hold, ${free.length} limited by a parent`,
  );
  for (const r of free.slice(0, 40))
    lines.push(`       ${r.lock}: ${r.name} ${r.locked} -> ${r.latest}`);
  lines.push(
    `osv    ${s.advisories.open.length} open, ${s.advisories.held.length} held (${ADVISORY_FILE})`,
  );
  for (const a of s.advisories.open)
    lines.push(`       ${a.name} ${a.version}: ${a.ids.slice(0, 3).join(", ")}`);
  lines.push(
    `python ${[...new Set(s.interpreters.filter((i) => i.installed).map((i) => i.version))].join(", ") || "none installed"}${s.python.length ? "" : "  policy ok"}`,
  );
  for (const p of s.python) lines.push(`       ${p}`);
  return lines;
}

// ---------------------------------------------------------------- plan

export type LockPlan = { dir: string; changes: Change[]; error?: string };

export function planLocks(
  layout: Layout,
  packages: string[],
  run: Runner = defaultRunner,
): LockPlan[] {
  return layout.locks.map((dir) => {
    const r = run("uv", lockArgs(packages, ["--dry-run"]), join(layout.pyRoot, dir));
    const out = `${r.stderr}\n${r.stdout}`;
    return {
      dir,
      changes: parseLockOutput(out),
      error: r.status === 0 ? undefined : out.trim().split("\n").at(-1),
    };
  });
}

export function renderPlan(s: UvStatus, locks: LockPlan[]): string[] {
  const lines: string[] = [];
  const t = s.tool;
  if (t.latest && t.pinned && cmpPy(t.pinned, t.latest) < 0)
    lines.push(
      `step 1  uv ${t.pinned} -> ${t.latest}: yolo update tools uv --apply (installs, re-pins every target)`,
    );
  else lines.push(`step 1  uv ${t.pinned ?? "?"} is the latest`);
  lines.push("step 2  uv python upgrade (managed interpreters, newest patch of each minor)");
  for (const l of locks) {
    lines.push(
      `step 3  ${lockLabel(l.dir)}: ${l.error ? `dry run failed: ${l.error}` : `${l.changes.length} change(s) within the specifiers`}`,
    );
    for (const ch of l.changes.slice(0, 60))
      lines.push(`        ${ch.name} ${ch.from} -> ${ch.to}  [${bumpKind(ch.from, ch.to)}]`);
  }
  const open = s.direct.filter((d) => d.state === "open");
  const majors = open.filter((d) => d.kind === "major");
  lines.push(`step 4  verify: uv lock --check, ruff, pytest of every member with tests`);
  if (open.length)
    lines.push(
      `decide  ${open.length} direct requirement(s) behind latest and not held (${majors.length} major): read the release notes, edit the specifier, then apply --upgrade-package <name>`,
    );
  for (const d of open)
    lines.push(
      `        ${d.name} ${d.spec || "(any)"} ${d.locked.join(",")} -> ${d.latest}  [${d.kind}]`,
    );
  return lines;
}

// ---------------------------------------------------------------- snapshot / rollback

export function snapshot(
  c: Ctx,
  layout: Layout,
  stamp = new Date().toISOString().replace(/[:.]/g, "-"),
): string {
  const dir = join(SNAPSHOT_DIR, stamp);
  for (const l of layout.locks) {
    const dst = join(c.root, dir, l, "uv.lock");
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(layout.pyRoot, l, "uv.lock"), dst);
  }
  c.write(
    join(dir, "root.json"),
    `${JSON.stringify({ pyRoot: layout.pyRoot, locks: layout.locks })}\n`,
  );
  return dir;
}

export function latestSnapshot(c: Ctx): string | undefined {
  const base = join(c.root, SNAPSHOT_DIR);
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(base, e.name, "root.json")))
    .map((e) => e.name)
    .toSorted()
    .at(-1);
  return d ? join(SNAPSHOT_DIR, d) : undefined;
}

export function restoreSnapshot(c: Ctx, dir: string): string[] {
  const meta = JSON.parse(c.read(join(dir, "root.json"))) as { pyRoot: string; locks: string[] };
  return meta.locks.map((l) => {
    copyFileSync(join(c.root, dir, l, "uv.lock"), join(meta.pyRoot, l, "uv.lock"));
    return join(meta.pyRoot, l, "uv.lock");
  });
}

// ---------------------------------------------------------------- gates

export type Step = { name: string; ok: boolean; detail?: string };

/** Workspace members that ship tests: the directory of each `members` entry with a `tests/` folder holding test files. */
export function testDirs(layout: Layout): string[] {
  const root = layout.projects.includes("pyproject.toml")
    ? parsePyProject("pyproject.toml", readFileSync(join(layout.pyRoot, "pyproject.toml"), "utf8"))
    : undefined;
  const dirs = (root?.members ?? []).map((m) => `${m.replace(/\/$/, "")}/tests`);
  return dirs.filter(
    (d) =>
      existsSync(join(layout.pyRoot, d)) &&
      readdirSync(join(layout.pyRoot, d)).some((f) => /^test_.*\.py$/.test(f)),
  );
}

// Dernière ligne non vide de la sortie d'une commande.
const tail = (r: Run) => (r.stdout + r.stderr).trim().split("\n").findLast(Boolean);

export function verify(
  c: Ctx,
  layout: Layout,
  o: { skipTests?: boolean; run?: Runner } = {},
): Step[] {
  const run = o.run ?? defaultRunner;
  const steps: Step[] = [];
  const step = (name: string, ok: boolean, detail?: string) => {
    steps.push({ name, ok, detail });
    console.log(`${ok ? "ok  " : "FAIL"}   ${name}${detail ? `  ${detail}` : ""}`);
  };
  const pin = checkPins(c).find((r) => r.tool === "uv");
  step(
    "uv pins agree",
    !!pin && pin.drift.length === 0,
    pin
      ? `${pin.pin}${pin.drift.length ? `, ${pin.drift.length} drift` : ""}`
      : "no uv entry in pins.json",
  );
  const have = installed(c, "uv");
  step(
    "uv installed matches the pin",
    !!have && have === pin?.pin,
    `${have ?? "-"} vs ${pin?.pin ?? "?"}`,
  );
  for (const l of layout.locks) {
    const r = run("uv", ["lock", "--check"], join(layout.pyRoot, l));
    step(`uv lock --check ${lockLabel(l)}`, r.status === 0, r.status === 0 ? undefined : tail(r));
  }

  const sync = run("uv", syncArgs(), layout.pyRoot);
  step(
    "uv sync --all-packages --locked",
    sync.status === 0,
    sync.status === 0 ? undefined : tail(sync),
  );
  if (sync.status !== 0) return steps;
  const ruff = run("uv", ["run", "--no-sync", "ruff", "check", "."], layout.pyRoot);
  step("ruff check .", ruff.status === 0, tail(ruff));
  if (o.skipTests) return steps;
  for (const d of testDirs(layout)) {
    const r = run("uv", ["run", "--no-sync", "pytest", d, "-p", "no:cacheprovider"], layout.pyRoot);
    step(`pytest ${d}`, r.status === 0, tail(r));
  }
  return steps;
}

// ---------------------------------------------------------------- apply

export async function applyBumps(
  c: Ctx,
  args: UvArgs,
  run: Runner = defaultRunner,
): Promise<number> {
  const pyRoot = pythonRoot(c, args.pyRoot);
  if (!pyRoot) {
    console.error(
      "no Python root (tools/config/deps/watch.json inventory.pythonRoots, --py-root or APHRODY_PY_ROOT)",
    );
    return 1;
  }
  const layout = discover(pyRoot);
  const snap = snapshot(c, layout);
  console.log(
    `snapshot ${snap} (restore with: yolo update uv rollback, or git checkout -- uv.lock in ${pyRoot})`,
  );

  const tool = installed(c, "uv");
  const pin = checkPins(c).find((r) => r.tool === "uv")?.pin;
  if (tool && pin && tool !== pin) {
    console.error(
      `uv installed ${tool} differs from the pin ${pin}; run yolo update tools uv --apply first (required-version would refuse the run)`,
    );
    return 1;
  }

  if (!args.packages.length) {
    const py = run("uv", ["python", "upgrade"], pyRoot, true);
    console.log(`python uv python upgrade ${py.status === 0 ? "ok" : "failed (continuing)"}`);
  }

  const changes: Change[] = [];
  for (const l of layout.locks) {
    const cwd = join(pyRoot, l);
    const before = lockMap(readFileSync(join(cwd, "uv.lock"), "utf8"));
    const r = run("uv", lockArgs(args.packages), cwd);
    if (r.status !== 0) {
      console.error(
        `uv lock failed in ${l}: ${(r.stderr || r.stdout).trim().split("\n").slice(-6).join("\n")}\nrestore with: yolo update uv rollback`,
      );
      return 1;
    }
    const diff = lockDiff(before, lockMap(readFileSync(join(cwd, "uv.lock"), "utf8"))).map((ch) =>
      Object.assign(ch, { ecosystem: "uv-lock" }),
    );
    console.log(`lock   ${lockLabel(l)}: ${diff.length} package change(s)`);
    for (const ch of diff.slice(0, 80))
      console.log(`       ${ch.name} ${ch.from} -> ${ch.to}  [${bumpKind(ch.from, ch.to)}]`);
    changes.push(...diff);
  }

  if (changes.length) {
    const j = c.journal();
    j.runs.push({ date: new Date().toISOString().slice(0, 10), changes: changes.slice(0, 400) });
    c.saveJournal(j);
  }
  const steps = verify(c, layout, { skipTests: args.skipTests, run });
  if (steps.some((s) => !s.ok)) {
    console.error(
      "verify failed after the bump: fix the breakage, narrow it with --upgrade-package, or run yolo update uv rollback",
    );
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------- entry point

export async function runUvWith(c: Ctx, args: UvArgs): Promise<number> {
  switch (args.sub) {
    case "status": {
      const s = await collectStatus(c, { pyRoot: args.pyRoot, offline: args.offline });
      if (!s) {
        console.error(
          "no Python root found (tools/config/deps/watch.json inventory.pythonRoots, --py-root or APHRODY_PY_ROOT)",
        );
        return 1;
      }
      const bad = problems(s);
      console.log(
        args.json ? JSON.stringify({ ...s, problems: bad }, null, 2) : renderStatus(s).join("\n"),
      );
      for (const p of bad) console.error(`problem ${p}`);
      return bad.length ? 1 : 0;
    }
    case "plan": {
      const s = await collectStatus(c, {
        pyRoot: args.pyRoot,
        offline: args.offline,
        advisories: false,
      });
      if (!s) {
        console.error("no Python root found");
        return 1;
      }
      const locks = planLocks(discover(s.pyRoot), args.packages);
      console.log(
        args.json
          ? JSON.stringify({ locks, open: s.direct.filter((d) => d.state === "open") }, null, 2)
          : renderPlan(s, locks).join("\n"),
      );
      return 0;
    }
    case "apply":
      return applyBumps(c, args);
    case "verify": {
      const pyRoot = pythonRoot(c, args.pyRoot);
      if (!pyRoot) {
        console.error("no Python root found");
        return 1;
      }
      return verify(c, discover(pyRoot), { skipTests: args.skipTests }).every((x) => x.ok) ? 0 : 1;
    }
    case "rollback": {
      const dir = latestSnapshot(c);
      if (!dir) {
        console.error(`no snapshot under ${SNAPSHOT_DIR}`);
        return 1;
      }
      const files = restoreSnapshot(c, dir);
      console.log(
        `rollback ${dir}: ${files.length} lock(s) restored\n${files.map((f) => `  ${relative(process.cwd(), f)}`).join("\n")}\nrun uv sync --all-packages --locked to realign the environment`,
      );
      return 0;
    }
    default:
      console.error(`unknown subcommand ${args.sub} (status|plan|apply|verify|rollback)`);
      return 2;
  }
}

/** `yolo update uv <status|plan|apply|verify|rollback> [--upgrade-package a,b] [--offline] [--json] [--root <repo>]`. */
export async function runUv(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const c = new Ctx(resolve(args.root ?? process.cwd()), args.apply, args.json);
  return runUvWith(c, args);
}

if (import.meta.main) process.exit(await runUv(process.argv.slice(2)));
