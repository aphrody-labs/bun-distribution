// SPDX-License-Identifier: Apache-2.0
/**
 * Rust ecosystem module: one structured, automated bump of everything Cargo.
 *
 *   rust status                      toolchain channel vs latest stable/nightly, direct crates behind the crates.io
 *                                    sparse index (in manifest range and beyond), OSV advisories not covered by
 *                                    tools/config/deps/advisory-holds.json, Cargo git remotes and source pins that moved
 *   rust plan                        what `apply` would do; majors are listed separately with the consumers to change
 *   rust apply [--majors a,b+c]      (--keep leaves a failing major in place to fix forward) in-range lock refresh, `cargo update -p name@ver --precise X` for stragglers, then
 *                                    `cargo check` of the touched consumers; every --majors crate is a transaction
 *                                    (manifest edit, lock update, consumer check) rolled back when the check fails
 *   rust verify [--crates a,b]       workspace `cargo check`, clippy on touched crates, `cargo deny check advisories`
 *   rust doctor | rust fix           every gate of the workspace in one action, with repair (rust-doctor.ts)
 *
 * Global flags (same as cli.ts): --root <repo>, --json. Every cargo command goes through
 * scripts/build/rust/cargo-serial.sh, one at a time, never in the background. Cargo.lock is only ever changed by cargo.
 * Reuses cargo.ts (lock refresh and diff), deps/inventory.ts (sparse index, OSV, Cargo.lock parser), sources/drift.ts
 * (git remotes and source pins) and context.ts. The CLI wiring lives in cli.ts (owned by the lead).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Ctx } from "../context.ts";
import { lockDiff, lockMap, runCargo } from "../cargo.ts";
import { Cache, cachedText, osv, parseCargoLock, sparsePath, type Dep } from "../deps/inventory.ts";
import { cmpVersion } from "../deps/sync.ts";
import { cargoGitRemotes, driftRows } from "../sources/drift.ts";

const WRAPPER = "scripts/build/rust/cargo-serial.sh";
const HOLDS_FILE = "tools/config/deps/rust-holds.json";
const ADVISORY_HOLDS_FILE = "tools/config/deps/advisory-holds.json";

// ---------------------------------------------------------------- versions and requirements (pure, unit-tested)

export type Triple = [number, number, number];
export type Parsed = { v: Triple; pre: string };

export function parseVersion(input: string): Parsed | undefined {
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(input);
  if (!m) return undefined;
  return {
    v: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)],
    pre: m[4] ?? "",
  };
}

const cmpTriple = (a: Triple, b: Triple) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

type Comparator = {
  test: (v: Triple) => boolean;
  pre?: Triple;
  /** extra pre-release ordering check */ post?: (p: Parsed) => boolean;
};

/** Cargo comparator set: `^`, `~`, `=`, `>`, `>=`, `<`, `<=`, bare (caret), `*` and `1.*` wildcards, comma separated. */
export function comparators(req: string): Comparator[] | undefined {
  const out: Comparator[] = [];
  for (const raw of req.split(",")) {
    const part = raw.trim();
    if (part === "" || part === "*") continue;
    const m = /^(\^|~|=|>=|>|<=|<)?\s*(\d+)(?:\.(\d+|\*))?(?:\.(\d+|\*))?(?:-([0-9A-Za-z.-]+))?$/.exec(part);
    if (!m) return undefined;
    const op = m[1] ?? "^";
    const maj = Number(m[2]);
    const minRaw = m[3];
    const patRaw = m[4];
    const minorGiven = minRaw !== undefined && minRaw !== "*";
    const patchGiven = minorGiven && patRaw !== undefined && patRaw !== "*";
    const min = minorGiven ? Number(minRaw) : 0;
    const pat = patchGiven ? Number(patRaw) : 0;
    const lo: Triple = [maj, min, pat];
    const pre: Triple | undefined = m[5] ? lo : undefined;
    const preStr = m[5] ?? "";
    // A lower bound with a pre-release (`^2.0.0-rc.12`) admits later pre-releases of the same x.y.z, never earlier ones.
    const lower = (p: Parsed) =>
      !preStr || cmpTriple(p.v, lo) !== 0 || p.pre === "" || cmpVersion(`0.0.0-${p.pre}`, `0.0.0-${preStr}`) >= 0;
    const between = (hi: Triple): Comparator => ({
      test: v => cmpTriple(v, lo) >= 0 && cmpTriple(v, hi) < 0,
      pre,
      post: lower,
    });
    if (op === "^") {
      if (maj > 0 || !minorGiven) out.push(between([maj + 1, 0, 0]));
      else if (min > 0 || !patchGiven) out.push(between([0, min + 1, 0]));
      else out.push(between([0, 0, pat + 1]));
    } else if (op === "~") {
      out.push(minorGiven ? between([maj, min + 1, 0]) : between([maj + 1, 0, 0]));
    } else if (op === "=") {
      if (patchGiven)
        out.push({
          test: v => cmpTriple(v, lo) === 0,
          pre,
          post: p => p.pre === preStr,
        });
      else out.push(minorGiven ? between([maj, min + 1, 0]) : between([maj + 1, 0, 0]));
    } else {
      // Comparison operators: a partial version rounds up for > and down for <=.
      const next: Triple = patchGiven ? [maj, min, pat + 1] : minorGiven ? [maj, min + 1, 0] : [maj + 1, 0, 0];
      if (op === ">=") out.push({ test: v => cmpTriple(v, lo) >= 0, pre, post: lower });
      else if (op === ">")
        out.push({
          test: v => cmpTriple(v, next) >= 0 || (patchGiven && cmpTriple(v, lo) > 0),
          pre,
        });
      else if (op === "<") out.push({ test: v => cmpTriple(v, lo) < 0, pre });
      else out.push({ test: v => cmpTriple(v, next) < 0, pre });
    }
  }
  return out;
}

/** Does `version` satisfy the Cargo requirement `req`? Pre-releases only match a comparator naming the same x.y.z. */
export function satisfies(version: string, req: string): boolean {
  const p = parseVersion(version);
  const cs = comparators(req);
  if (!p || !cs) return false;
  if (p.pre && !cs.some(c => c.pre && cmpTriple(c.pre, p.v) === 0)) return false;
  return cs.every(c => c.test(p.v) && (c.post?.(p) ?? true));
}

/**
 * Rewrite a single-comparator requirement to admit `target`, keeping the operator and the number of components
 * (`0.7` -> `0.8`, `1` -> `2`, `=1.7.0` -> `=1.19.0`). Compound requirements return undefined: edit them by hand.
 */
export function bumpReq(req: string, target: string): string | undefined {
  const m = /^(\^|~|=)?\s*(\d+(?:\.\d+){0,2})(?:-[0-9A-Za-z.-]+)?$/.exec(req.trim());
  const t = parseVersion(target);
  if (!m || !t) return undefined;
  const parts = m[2]!.split(".").length;
  const full = t.v.join(".");
  const body =
    t.pre || parts === 3 || m[1] === "=" ? `${full}${t.pre ? `-${t.pre}` : ""}` : t.v.slice(0, parts).join(".");
  return `${m[1] ?? ""}${body}`;
}

export type IndexVersion = {
  vers: string;
  yanked: boolean;
  rustVersion?: string;
};

export function parseIndex(text: string): IndexVersion[] {
  const out: IndexVersion[] = [];
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    try {
      const j = JSON.parse(line) as {
        vers: string;
        yanked?: boolean;
        rust_version?: string;
      };
      out.push({
        vers: j.vers,
        yanked: !!j.yanked,
        rustVersion: j.rust_version,
      });
    } catch {
      /* skip a corrupt line */
    }
  }
  return out;
}

// ---------------------------------------------------------------- manifests (pure, unit-tested)

export type DepDecl = {
  manifest: string;
  pkg: string;
  section: string;
  name: string;
  crate: string;
  req?: string;
  workspace: boolean;
  /** Features of the declaring package that switch this optional dependency on (empty when not optional). */
  enabledBy?: string[];
};

/** Features of a manifest that enable the optional dependency `name` (`dep:name`, `name`, `name/feat`, `name?/feat`). */
export function featuresEnabling(features: Record<string, unknown> | undefined, name: string): string[] {
  return Object.entries(features ?? {})
    .filter(
      ([, v]) =>
        Array.isArray(v) &&
        v.some(x => typeof x === "string" && (x === `dep:${name}` || x === name || x.startsWith(`${name}/`))),
    )
    .map(([k]) => k);
}

const DEP_SECTIONS = ["dependencies", "dev-dependencies", "build-dependencies"];

/** Registry dependency declarations of one Cargo.toml (path and git dependencies are not registry-bumpable and are skipped). */
export function readDecls(manifest: string, text: string): DepDecl[] {
  let doc: any;
  try {
    doc = Bun.TOML.parse(text);
  } catch {
    return [];
  }
  const pkg: string = doc.package?.name ?? "(workspace)";
  const out: DepDecl[] = [];
  const take = (section: string, table: Record<string, unknown> | undefined) => {
    for (const [name, spec] of Object.entries(table ?? {})) {
      if (typeof spec === "string")
        out.push({
          manifest,
          pkg,
          section,
          name,
          crate: name,
          req: spec,
          workspace: false,
        });
      else if (spec && typeof spec === "object") {
        const s = spec as {
          version?: string;
          workspace?: boolean;
          package?: string;
          path?: string;
          git?: string;
          optional?: boolean;
        };
        const enabledBy = s.optional ? featuresEnabling(doc.features, name) : undefined;
        if (s.workspace)
          out.push({
            manifest,
            pkg,
            section,
            name,
            crate: s.package ?? name,
            workspace: true,
            enabledBy,
          });
        else if (!s.path && !s.git && s.version)
          out.push({
            manifest,
            pkg,
            section,
            name,
            crate: s.package ?? name,
            req: s.version,
            workspace: false,
            enabledBy,
          });
      }
    }
  };
  take("workspace.dependencies", doc.workspace?.dependencies);
  for (const s of DEP_SECTIONS) take(s, doc[s]);
  for (const t of Object.values<any>(doc.target ?? {})) for (const s of DEP_SECTIONS) take(`target.${s}`, t?.[s]);
  return out;
}

export type DirectDep = {
  crate: string;
  req: string;
  declaredIn: string[];
  consumers: string[];
  /** Consumers that only build the crate behind a feature: package -> features to enable for a meaningful check. */
  optional: Record<string, string[]>;
};

/**
 * Direct (crate, requirement) pairs. A `workspace = true` member counts as a consumer of the workspace requirement;
 * a member with its own version requirement is a consumer of that requirement.
 */
export function directDeps(decls: DepDecl[]): DirectDep[] {
  const ws = new Map<string, DepDecl>();
  for (const d of decls) if (d.section === "workspace.dependencies" && d.req) ws.set(d.name, d);
  const map = new Map<string, DirectDep>();
  const add = (crate: string, req: string, manifest: string, consumer?: string, enabledBy?: string[]) => {
    const k = `${crate}\u0000${req}`;
    const row = map.get(k) ?? map.set(k, { crate, req, declaredIn: [], consumers: [], optional: {} }).get(k)!;
    if (!row.declaredIn.includes(manifest)) row.declaredIn.push(manifest);
    if (consumer && !row.consumers.includes(consumer)) row.consumers.push(consumer);
    if (consumer && enabledBy) row.optional[consumer] = [...new Set([...(row.optional[consumer] ?? []), ...enabledBy])];
  };
  for (const d of decls) {
    if (d.section === "workspace.dependencies" && d.req) add(d.crate, d.req, d.manifest);
    else if (d.workspace) {
      const w = ws.get(d.name);
      if (w?.req) add(w.crate, w.req, w.manifest, d.pkg, d.enabledBy);
    } else if (d.req) add(d.crate, d.req, d.manifest, d.pkg, d.enabledBy);
  }
  return [...map.values()].toSorted((a, b) => a.crate.localeCompare(b.crate) || a.req.localeCompare(b.req));
}

/** Replace the `req` of dependency `name` in one manifest, leaving every other line byte for byte. */
export function rewriteReq(
  text: string,
  name: string,
  oldReq: string,
  newReq: string,
): { text: string; count: number } {
  let count = 0;
  let inDeps = false;
  let tableDep = false;
  const key = name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const inline = new RegExp(`^(\\s*${key}\\s*=\\s*)"${oldReq.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
  const inlineVer = new RegExp(
    `^(\\s*${key}\\s*=\\s*\\{[^}]*?"?\\bversion"?\\s*=\\s*)"${oldReq.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
  );
  const tableVer = new RegExp(`^(\\s*"?version"?\\s*=\\s*)"${oldReq.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
  const lines = text.split("\n").map(line => {
    const h = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
    if (h) {
      const sec = h[1]!.replace(/^'|'$/g, "");
      tableDep = new RegExp(`(^|\\.)(dev-|build-)?dependencies\\.${key}$`).test(sec);
      inDeps = /(^|\.)(dev-|build-)?dependencies$/.test(sec) || /^workspace\.dependencies$/.test(sec);
      return line;
    }
    if (tableDep) {
      const r = tableVer.exec(line);
      if (r) {
        count++;
        return line.replace(tableVer, `$1"${newReq}"`);
      }
    }
    if (inDeps) {
      for (const re of [inline, inlineVer])
        if (re.test(line)) {
          count++;
          return line.replace(re, `$1"${newReq}"`);
        }
    }
    return line;
  });
  return { text: lines.join("\n"), count };
}

// ---------------------------------------------------------------- lock graph (pure, unit-tested)

export type LockGraph = {
  members: Set<string>;
  reverse: Map<string, Set<string>>;
};

/** Workspace members (lock packages without a source) and the name-level reverse dependency edges of Cargo.lock. */
export function lockGraph(text: string): LockGraph {
  const members = new Set<string>();
  const reverse = new Map<string, Set<string>>();
  for (const block of text.split("[[package]]").slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    if (!name) continue;
    if (!/^source = /m.test(block)) members.add(name);
    const deps = /^dependencies = \[([\s\S]*?)^\]/m.exec(block)?.[1] ?? "";
    for (const m of deps.matchAll(/"([^"\s]+)(?: [^"]*)?"/g)) {
      const d = m[1]!;
      (reverse.get(d) ?? reverse.set(d, new Set()).get(d)!).add(name);
    }
  }
  return { members, reverse };
}

/** Workspace members that (transitively) depend on any of `changed` crate names. */
export function touchedMembers(graph: LockGraph, changed: Iterable<string>): string[] {
  const seen = new Set<string>();
  const queue = [...changed];
  while (queue.length) {
    const n = queue.pop()!;
    for (const parent of graph.reverse.get(n) ?? [])
      if (!seen.has(parent)) {
        seen.add(parent);
        queue.push(parent);
      }
  }
  for (const n of changed) if (graph.members.has(n)) seen.add(n);
  return [...seen].filter(n => graph.members.has(n)).toSorted();
}

/** Parse `cargo update --dry-run` (or real) output lines such as `Updating syn v2.0.1 -> v2.0.2`. */
export function parseUpdateLines(output: string): { action: string; name: string; from?: string; to?: string }[] {
  const out: { action: string; name: string; from?: string; to?: string }[] = [];
  for (const l of output.split("\n")) {
    const m = /^\s*(Updating|Adding|Removing|Downgrading)\s+(\S+)\s+v(\S+)(?:\s+->\s+v(\S+))?/.exec(l);
    if (m)
      out.push({
        action: m[1]!,
        name: m[2]!,
        from: m[4] ? m[3] : undefined,
        to: m[4] ?? m[3],
      });
  }
  return out;
}

// ---------------------------------------------------------------- outdated classification (pure, unit-tested)

/**
 * `lockVersion`: the Cargo.lock entry must stay on this release (a companion crate cargo would otherwise refresh past its
 * parent). `relock`: specs to `cargo update -p <spec> --recursive` after the pin, to repair collateral re-resolution
 * (pinning yara-x-macros re-picks bindgen's syn/prettyplease pair).
 */
export type Hold = {
  crate: string;
  reason: string;
  lockVersion?: string;
  relock?: string[];
};

/** Lock entries that drifted from a `lockVersion` hold: every locked release of the crate that is not the pinned one. */
export function lockPinDrift(
  lock: { name: string; version: string }[],
  holds: Hold[],
): { crate: string; from: string; to: string }[] {
  return holds.flatMap(h =>
    h.lockVersion
      ? lock
          .filter(p => p.name === h.crate && noBuild(p.version) !== h.lockVersion)
          .map(p => ({ crate: h.crate, from: p.version, to: h.lockVersion! }))
      : [],
  );
}
export type OutdatedRow = {
  crate: string;
  req: string;
  locked?: string;
  /** Highest non-yanked release inside `req` when it is newer than `locked`. */
  inRange?: string;
  /** Highest non-yanked release outside `req` (a breaking release: next major, or next minor for 0.x). */
  beyond?: string;
  /** Rust version the `beyond` release needs, when it exceeds the pinned toolchain. */
  beyondMsrv?: string;
  yanked?: boolean;
  /** Reason from tools/config/deps/rust-holds.json: never moved by apply, not even with --majors. */
  held?: string;
  /** The manifest requires `=x.y.z`: the owner pinned it on purpose; only an explicit `--majors` moves it. */
  exactPin?: boolean;
  owner?: string;
  consumers: string[];
  optional: Record<string, string[]>;
  declaredIn: string[];
};

export type ClassifyInput = {
  direct: DirectDep[];
  lock: { name: string; version: string; source?: string }[];
  versions: Map<string, IndexVersion[]>;
  holds: Hold[];
  /** Crates whose versions another owner moves (for example the Tauri family under tauri-sync). */
  owners?: Map<string, string>;
  toolchain?: string;
};

/** Build metadata (`+spec-1.1.0`) never takes part in precedence; drop it before comparing. */
export const noBuild = (v: string) => v.replace(/\+.*$/, "");

export function classify(i: ClassifyInput): OutdatedRow[] {
  const rows: OutdatedRow[] = [];
  const holds = new Map(i.holds.map(h => [h.crate, h.reason]));
  for (const d of i.direct) {
    const locked = i.lock
      .filter(p => p.name === d.crate && p.source?.startsWith("registry+") && satisfies(p.version, d.req))
      .map(p => noBuild(p.version))
      .toSorted(cmpVersion)
      .at(-1);
    const vers = (i.versions.get(d.crate) ?? [])
      .filter(v => !v.yanked)
      .map(v => Object.assign(v, { vers: noBuild(v.vers) }));
    const allowPre = !!locked && locked.includes("-");
    const stable = vers.filter(v => allowPre || !v.vers.includes("-")).toSorted((a, b) => cmpVersion(a.vers, b.vers));
    const within = stable.findLast(v => satisfies(v.vers, d.req));
    const beyondV = stable.findLast(v => !satisfies(v.vers, d.req) && cmpVersion(v.vers, locked ?? "0.0.0") > 0);
    const exact = /^\s*=/.test(d.req);
    const row: OutdatedRow = {
      crate: d.crate,
      req: d.req,
      locked,
      consumers: d.consumers,
      optional: d.optional,
      declaredIn: d.declaredIn,
      inRange: locked && within && cmpVersion(locked, within.vers) < 0 ? within.vers : undefined,
      beyond: beyondV?.vers,
      beyondMsrv:
        beyondV?.rustVersion && i.toolchain && cmpVersion(i.toolchain, beyondV.rustVersion) < 0
          ? beyondV.rustVersion
          : undefined,
      yanked: !!locked && (i.versions.get(d.crate) ?? []).some(v => v.yanked && noBuild(v.vers) === locked),
      held: holds.get(d.crate),
      exactPin: exact || undefined,
      owner: i.owners?.get(d.crate),
    };
    if (locked) rows.push(row); // declared but unlocked (unused workspace entry, path patch): nothing to bump
  }
  return rows;
}

export type Advisory = { crate: string; version: string; ids: string[] };

/** Split OSV hits into open advisories and those named in advisory-holds.json (crates.io entries only). */
export function splitAdvisories(
  hits: Map<string, string[]>,
  holds: { ecosystem: string; name: string; reason: string }[],
): { open: Advisory[]; held: (Advisory & { reason: string })[] } {
  const open: Advisory[] = [];
  const held: (Advisory & { reason: string })[] = [];
  for (const [key, ids] of hits) {
    const m = /^crates\.io:(.+)@([^@]+)$/.exec(key);
    if (!m) continue;
    const a = { crate: m[1]!, version: m[2]!, ids };
    const h = holds.find(x => x.ecosystem === "crates.io" && x.name === a.crate);
    if (h) held.push({ ...a, reason: h.reason });
    else open.push(a);
  }
  const by = (x: Advisory, y: Advisory) => x.crate.localeCompare(y.crate) || cmpVersion(x.version, y.version);
  return { open: open.toSorted(by), held: held.toSorted(by) };
}

/** Crates named by `cargo deny --format json check advisories` diagnostics, with their advisory ids. */
export function denyAdvisories(output: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of output.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const j = JSON.parse(line) as {
        type?: string;
        fields?: { advisory?: { id?: string; package?: string } };
      };
      const a = j.fields?.advisory;
      if (j.type === "diagnostic" && a?.package && a.id) out.set(a.package, [...(out.get(a.package) ?? []), a.id]);
    } catch {
      /* not a diagnostic */
    }
  }
  return out;
}

export function parseToolchainChannel(text: string): string | undefined {
  return /^\s*channel\s*=\s*"([^"]+)"/m.exec(text)?.[1];
}

/** `channel-rust-*.toml` manifest: release version and date. */
export function parseChannelManifest(text: string): {
  version?: string;
  date?: string;
} {
  return {
    date: /^date\s*=\s*"([^"]+)"/m.exec(text)?.[1],
    version: /\[pkg\.rust\]\s*\nversion\s*=\s*"([^" ]+)/.exec(text)?.[1],
  };
}

// ---------------------------------------------------------------- IO

export type RustReport = {
  toolchain: {
    pinned?: string;
    installed?: string;
    stable?: string;
    nightly?: string;
    nightlyDate?: string;
    behind: boolean;
  };
  outdated: OutdatedRow[];
  advisories: { open: Advisory[]; held: (Advisory & { reason: string })[] };
  git: {
    url: string;
    how: string;
    pinned: string[];
    head?: string;
    moved: boolean;
  }[];
  sources: { id: string; current: string; latest?: string; note?: string }[];
  lockPins: { crate: string; from: string; to: string }[];
};

const cargo = (c: Ctx, args: string[], inherit = false) => c.run("bash", [WRAPPER, ...args], { inherit });

export const loadHolds = (c: Ctx): Hold[] => c.jsonFile<{ holds: Hold[] }>(HOLDS_FILE, { holds: [] }).holds;
export const loadAdvisoryHolds = (c: Ctx) =>
  c.jsonFile<{ holds: { ecosystem: string; name: string; reason: string }[] }>(ADVISORY_HOLDS_FILE, { holds: [] })
    .holds;

// Progress goes to stderr so a --json report on stdout stays parseable.
const say = (line: string) => console.error(line);

/**
 * Put every drifted `lockVersion` hold back (`cargo update -p name@ver --precise X`), then run the `relock` repairs of
 * the holds that moved. Shared by `apply` and by the doctor.
 */
export function restoreLockPins(c: Ctx): { restored: number; failed: number } {
  const drift = lockPinDrift(parseCargoLock(c.read("Cargo.lock")), loadHolds(c));
  let failed = 0;
  for (const d of drift) {
    const res = cargo(c, ["update", "-p", `${d.crate}@${d.from}`, "--precise", d.to]);
    say(`${res.status === 0 ? "lockpin" : "FAILED "} ${d.crate} ${d.from} -> ${d.to}`);
    if (res.status !== 0) failed++;
  }
  const relock = drift.length ? loadHolds(c).filter(h => h.lockVersion && h.relock?.length) : [];
  for (const spec of new Set(relock.flatMap(h => h.relock!))) {
    const res = cargo(c, ["update", "-p", spec, "--recursive"]);
    say(`${res.status === 0 ? "relock " : "FAILED "} ${spec} --recursive`);
    if (res.status !== 0) failed++;
  }
  return { restored: drift.length, failed };
}

function owners(c: Ctx): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of c.jsonFile<{ rust?: { crates?: string[] } }>("tools/config/tauri-upstream.json", {}).rust?.crates ??
    [])
    m.set(n, "tauri-sync (yolo ops tauri-sync)");
  return m;
}

/** Member manifests of the root workspace (members globs of Cargo.toml, minus the excludes). */
export function memberManifests(c: Ctx): string[] {
  const root = Bun.TOML.parse(c.read("Cargo.toml")) as {
    workspace?: { members?: string[]; exclude?: string[] };
  };
  const out = ["Cargo.toml"];
  const exclude = new Set(root.workspace?.exclude ?? []);
  for (const pattern of root.workspace?.members ?? []) {
    if (pattern.endsWith("/*")) {
      const base = pattern.slice(0, -2);
      if (!existsSync(join(c.root, base))) continue;
      for (const e of readdirSync(join(c.root, base), {
        withFileTypes: true,
      })) {
        const rel = `${base}/${e.name}`;
        if (e.isDirectory() && !exclude.has(rel) && c.exists(`${rel}/Cargo.toml`)) out.push(`${rel}/Cargo.toml`);
      }
    } else if (c.exists(`${pattern}/Cargo.toml`) && !exclude.has(pattern)) out.push(`${pattern}/Cargo.toml`);
  }
  return out;
}

export function collectDecls(c: Ctx): DepDecl[] {
  return memberManifests(c).flatMap(m => readDecls(m, c.read(m)));
}

async function fetchVersions(c: Ctx, crates: string[]): Promise<Map<string, IndexVersion[]>> {
  const cache = new Cache(join(c.root, "target", "deps-inventory", "cache"));
  const out = new Map<string, IndexVersion[]>();
  const queue = [...crates];
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      for (let n = queue.pop(); n; n = queue.pop()) {
        // oxlint-disable-next-line no-await-in-loop -- each pool worker fetches its queue one crate at a time; the 16 workers are the concurrency limit
        const t = await cachedText(cache, `https://index.crates.io/${sparsePath(n)}`);
        out.set(n, t ? parseIndex(t) : []);
      }
    }),
  );
  return out;
}

async function channel(name: "stable" | "nightly"): Promise<{ version?: string; date?: string }> {
  const res = await fetch(`https://static.rust-lang.org/dist/channel-rust-${name}.toml`, {
    signal: AbortSignal.timeout(30_000),
  }).catch(() => undefined);
  return res?.ok ? parseChannelManifest(await res.text()) : {};
}

export async function outdated(c: Ctx, toolchain?: string): Promise<OutdatedRow[]> {
  const direct = directDeps(collectDecls(c));
  const lock = parseCargoLock(c.read("Cargo.lock"));
  const versions = await fetchVersions(c, [...new Set(direct.map(d => d.crate))]);
  return classify({
    direct,
    lock,
    versions,
    holds: loadHolds(c),
    owners: owners(c),
    toolchain,
  });
}

export async function rustStatus(c: Ctx): Promise<RustReport> {
  const pinned = parseToolchainChannel(c.read("rust-toolchain.toml"));
  const [stable, nightly] = await Promise.all([channel("stable"), channel("nightly")]);
  const installed = /rustc (\S+)/.exec(c.run("rustc", ["--version"]).stdout)?.[1];
  const rows = await outdated(c, pinned);
  const lock = parseCargoLock(c.read("Cargo.lock"));
  const deps: Dep[] = lock
    .filter(p => p.source?.startsWith("registry+"))
    .map(p => ({ ecosystem: "crates.io", name: p.name, version: p.version }));
  const advisories = splitAdvisories(await osv(deps), loadAdvisoryHolds(c));
  const git = cargoGitRemotes(c).map(({ url, how, pinned: p, head, moved }) => ({
    url,
    how,
    pinned: p,
    head,
    moved,
  }));
  const sources = (await driftRows(c))
    .filter(r => r.behind || r.note)
    .map(r => ({
      id: r.id,
      current: r.current,
      latest: r.latest,
      note: r.note,
    }));
  return {
    toolchain: {
      pinned,
      installed,
      stable: stable.version,
      nightly: nightly.version,
      nightlyDate: nightly.date,
      behind: !!pinned && !!stable.version && cmpVersion(pinned, stable.version) < 0,
    },
    outdated: rows,
    advisories,
    git,
    sources,
    lockPins: lockPinDrift(lock, loadHolds(c)),
  };
}

const fmtRow = (r: OutdatedRow) =>
  `${r.crate.padEnd(28)} req ${r.req.padEnd(12)} locked ${(r.locked ?? "-").padEnd(14)}${r.inRange ? ` in-range ${r.inRange}` : ""}${r.beyond ? ` beyond ${r.beyond}` : ""}${r.beyondMsrv ? ` (needs rust ${r.beyondMsrv})` : ""}${r.yanked ? " YANKED" : ""}${r.held ? ` [held: ${r.held}]` : ""}${r.exactPin ? " [exact pin]" : ""}${r.owner ? ` [owner: ${r.owner}]` : ""}`;

function printStatus(r: RustReport) {
  const t = r.toolchain;
  console.log(
    `toolchain  pinned ${t.pinned ?? "?"}, installed ${t.installed ?? "?"}, latest stable ${t.stable ?? "?"}, nightly ${t.nightly ?? "?"} (${t.nightlyDate ?? "?"})${t.behind ? "  <- pin behind stable: yolo update tools rust --apply" : ""}`,
  );
  const inRange = r.outdated.filter(x => x.inRange);
  const beyond = r.outdated.filter(x => x.beyond);
  console.log(
    `outdated   ${r.outdated.length} direct requirement(s); ${inRange.length} behind inside the manifest range, ${beyond.length} with a release beyond it`,
  );
  for (const x of inRange) console.log(`  range    ${fmtRow(x)}`);
  for (const x of beyond) console.log(`  beyond   ${fmtRow(x)}`);
  for (const x of r.outdated.filter(y => y.yanked)) console.log(`  yanked   ${fmtRow(x)}`);
  console.log(
    `advisories ${r.advisories.open.length} open, ${r.advisories.held.length} held (tools/config/deps/advisory-holds.json)`,
  );
  for (const a of r.advisories.open) console.log(`  open     ${a.crate} ${a.version}: ${a.ids.slice(0, 4).join(", ")}`);
  for (const d of r.lockPins) console.log(`lockpin    ${d.crate} ${d.from} should be ${d.to}: run apply`);
  for (const g of r.git)
    console.log(
      `git        ${g.moved ? "moved" : "ok   "} ${g.url.replace("https://github.com/", "")} ${g.how} ${g.pinned.join(",") || "(tag)"} head ${g.head ?? "?"}`,
    );
  for (const s of r.sources)
    console.log(`source     ${s.id} ${s.current} -> ${s.latest ?? "?"}${s.note ? ` (${s.note})` : ""}`);
}

export type RustPlan = {
  lock: { action: string; name: string; from?: string; to?: string }[];
  precise: { crate: string; from: string; to: string }[];
  majors: {
    crate: string;
    req: string;
    from?: string;
    to: string;
    newReq?: string;
    consumers: string[];
    manifests: string[];
    held?: string;
    exactPin?: boolean;
    owner?: string;
    msrv?: string;
  }[];
  held: OutdatedRow[];
};

export function buildPlan(rows: OutdatedRow[], lock: RustPlan["lock"]): RustPlan {
  const lockedNames = new Set(lock.filter(l => l.action === "Updating").map(l => l.name));
  return {
    lock,
    precise: rows
      .filter(r => r.inRange && !r.held && !r.owner && !lockedNames.has(r.crate))
      .map(r => ({ crate: r.crate, from: r.locked!, to: r.inRange! })),
    majors: rows
      .filter(r => r.beyond)
      .map(r => ({
        crate: r.crate,
        req: r.req,
        from: r.locked,
        to: r.beyond!,
        newReq: bumpReq(r.req, r.beyond!),
        consumers: r.consumers,
        manifests: r.declaredIn,
        held: r.held,
        exactPin: r.exactPin,
        owner: r.owner,
        msrv: r.beyondMsrv,
      })),
    held: rows.filter(r => r.held),
  };
}

async function plan(c: Ctx, args: string[]): Promise<number> {
  const pinned = parseToolchainChannel(c.read("rust-toolchain.toml"));
  const rows = await outdated(c, pinned);
  const dry = args.includes("--no-cargo") ? undefined : cargo(c, ["update", "--dry-run"]);
  const lock = dry ? parseUpdateLines(dry.stderr + dry.stdout) : [];
  const p = buildPlan(rows, lock);
  if (c.json) {
    console.log(JSON.stringify(p, null, 2));
    return 0;
  }
  console.log(
    `plan  in-range lock refresh: ${lock.filter(l => l.action === "Updating").length} update(s), ${lock.filter(l => l.action === "Adding").length} added, ${lock.filter(l => l.action === "Removing").length} removed${dry ? "" : " (cargo dry run skipped)"}`,
  );
  for (const l of lock.filter(x => x.action === "Updating").slice(0, 60))
    console.log(`  update   ${l.name} ${l.from} -> ${l.to}`);
  if (lock.length > 60) console.log(`  ... ${lock.length - 60} more`);
  console.log(`plan  precise updates after the refresh: ${p.precise.length}`);
  for (const x of p.precise) console.log(`  precise  cargo update -p ${x.crate}@${x.from} --precise ${x.to}`);
  console.log(`plan  majors (never part of a plain apply; use \`apply --majors a,b+c\`): ${p.majors.length}`);
  for (const m of p.majors) {
    console.log(
      `  major    ${m.crate} ${m.from ?? "-"} -> ${m.to}${m.newReq ? ` (req ${m.req} -> ${m.newReq})` : " (compound req: edit by hand)"}${m.held ? ` [held: ${m.held}]` : ""}${m.exactPin ? " [exact pin]" : ""}${m.owner ? ` [owner: ${m.owner}]` : ""}${m.msrv ? ` [needs rust ${m.msrv}]` : ""}`,
    );
    console.log(
      `           consumers: ${m.consumers.join(", ") || "(workspace only)"}; manifests: ${m.manifests.join(", ")}`,
    );
  }
  const drift = lockPinDrift(parseCargoLock(c.read("Cargo.lock")), loadHolds(c));
  console.log(`plan  lock pins to restore after the refresh: ${drift.length}`);
  for (const d of drift) console.log(`  lockpin  cargo update -p ${d.crate}@${d.from} --precise ${d.to}`);
  console.log(`plan  held (stay as they are): ${p.held.length}`);
  for (const h of p.held) console.log(`  held     ${h.crate} ${h.req}: ${h.held}`);
  return 0;
}

// ---------------------------------------------------------------- apply

const stamp = () => new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

type Snapshot = { dir: string; files: string[] };

function snapshot(c: Ctx, label: string, files: string[]): Snapshot {
  const dir = join(c.root, "target", "update", "rust", `${stamp()}-${label}`);
  for (const f of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    copyFileSync(join(c.root, f), join(dir, f));
  }
  return { dir, files };
}

function restore(c: Ctx, s: Snapshot) {
  for (const f of s.files) copyFileSync(join(s.dir, f), join(c.root, f));
}

function recordTouched(c: Ctx, names: string[]) {
  const f = "target/update/rust-touched.json";
  const prev = c.jsonFile<{ crates: string[] }>(f, { crates: [] }).crates;
  c.write(f, JSON.stringify({ crates: [...new Set([...prev, ...names])].toSorted() }, null, 2));
}

async function apply(c: Ctx, args: string[]): Promise<number> {
  const mi = args.indexOf("--majors");
  // Comma separates transactions; `+` joins crates that must move together (`nu-command+nu-engine`).
  const wantMajors = mi >= 0 ? (args[mi + 1] ?? "").split(",").filter(Boolean) : [];
  const pinned = parseToolchainChannel(c.read("rust-toolchain.toml"));
  mkdirSync(join(c.root, "target", "update"), { recursive: true });
  let failed = 0;

  if (!args.includes("--skip-refresh")) {
    c.write("target/update/rust-touched.json", JSON.stringify({ crates: [] }));
    const lockBefore = lockMap(c.read("Cargo.lock"));

    // 1. in-range refresh (cargo.ts: snapshot target/update/Cargo.lock.before, journal run)
    if (runCargo(new Ctx(c.root, true, c.json), []) !== 0) return 1;

    // 2. direct crates the bulk refresh left behind. Most are held back by a transitive exact or tilde requirement
    //    (cargo says which); that is reported, not fatal, and clears when the blocking crate moves.
    for (const r of (await outdated(c, pinned)).filter(x => x.inRange && !x.held && !x.owner)) {
      const res = cargo(c, ["update", "-p", `${r.crate}@${r.locked}`, "--precise", r.inRange!]);
      console.log(
        `${res.status === 0 ? "precise" : "blocked"} ${r.crate} ${r.locked} -> ${r.inRange}${res.status === 0 ? "" : `  ${(res.stderr.split("\n").find(l => /required by|didn't match|conflict/.test(l)) ?? "transitive requirement").trim()}`}`,
      );
    }

    // 2b. lock pins: companions of a held crate that the refresh moved past it (for example yara-x-proto vs yara-x)
    failed += restoreLockPins(c).failed;

    // 3. check the workspace: a `-p` subset unifies features differently and can fail on crates (bindgen, syn) that rely on
    //    another member to enable a feature, so a refresh is always verified as a whole
    const graph = lockGraph(c.read("Cargo.lock"));
    const changed = lockDiff(lockBefore, lockMap(c.read("Cargo.lock"))).map(x => x.name);
    const touched = touchedMembers(graph, changed);
    recordTouched(c, touched);
    console.log(
      `apply  ${changed.length} package(s) changed, ${touched.length}/${graph.members.size} workspace member(s) touched`,
    );
    if (changed.length && cargo(c, ["check", "--workspace"], true).status !== 0) {
      console.error(
        "apply  cargo check FAILED after the in-range refresh. Roll back: cp target/update/Cargo.lock.before Cargo.lock",
      );
      return 1;
    }
  }

  // 4. majors, one transaction per comma-separated group
  for (const group of wantMajors)
    // oxlint-disable-next-line no-await-in-loop -- each major group is one cargo transaction on the same Cargo.lock, so groups must not overlap
    failed += (await applyMajor(c, group.split("+").filter(Boolean), pinned, args.includes("--keep"))) ? 0 : 1;
  return failed ? 1 : 0;
}

/**
 * One transaction for a set of crates that must move together (`nu-command+nu-engine`, `resvg+usvg`): edit every
 * requirement, let cargo re-resolve them, check the direct consumers; any failure restores manifests and lock.
 */
async function applyMajor(c: Ctx, group: string[], pinned: string | undefined, keep = false): Promise<boolean> {
  const label = group.join("+");
  const rows = (await outdated(c, pinned)).filter(r => group.includes(r.crate) && r.beyond);
  const missing = group.filter(g => !rows.some(r => r.crate === g));
  if (missing.length) {
    console.error(`major  ${label}: nothing beyond the current requirement for ${missing.join(", ")}`);
    return false;
  }
  const blocked = rows.find(r => r.held || r.owner);
  if (blocked) {
    console.error(`major  ${label}: refused, ${blocked.crate} (${blocked.held ?? blocked.owner})`);
    return false;
  }
  const manifests = [...new Set(rows.flatMap(r => r.declaredIn))];
  const snap = snapshot(c, `major-${label.slice(0, 60)}`, ["Cargo.lock", ...manifests]);
  const fail = (why: string) => {
    if (keep) {
      console.error(
        `KEPT     ${label}: ${why}. Manifests and Cargo.lock stay on the new version for a fix-forward; undo with the snapshot in ${relative(c.root, snap.dir)}.`,
      );
      return false;
    }
    restore(c, snap);
    console.error(
      `ROLLBACK ${label}: ${why}; manifests and Cargo.lock restored from ${relative(c.root, snap.dir)}. Record the reason in docs/operations/infra/update/RUST.md and ${HOLDS_FILE}.`,
    );
    return false;
  };
  for (const r of rows) {
    const nr = bumpReq(r.req, r.beyond!);
    if (!nr) return fail(`requirement ${r.req} of ${r.crate} is compound; edit it by hand`);
    let edited = 0;
    for (const m of r.declaredIn) {
      const out = rewriteReq(c.read(m), r.crate, r.req, nr);
      if (out.count) {
        c.write(m, out.text);
        edited += out.count;
      }
    }
    if (!edited) return fail(`could not locate the ${r.crate} requirement ${r.req}`);
  }
  const specs = [...new Set(rows.map(r => `${r.crate}@${r.locked}`))];
  // The edited requirements exclude the locked versions, so cargo re-resolves exactly these packages.
  const up = cargo(c, ["update", ...specs.flatMap(x => ["-p", x])], true);
  if (up.status !== 0) return fail("cargo update could not resolve the new requirements");
  const members = lockGraph(c.read("Cargo.lock")).members;
  const direct = [...new Set(rows.flatMap(r => r.consumers))].filter(n => members.has(n));
  // An optional dependency is only compiled with the feature that enables it: check those consumers with it switched on.
  const optional = new Map<string, Set<string>>();
  for (const r of rows)
    for (const [pkg, f] of Object.entries(r.optional))
      (optional.get(pkg) ?? optional.set(pkg, new Set()).get(pkg)!).add(f.join(",") || "*");
  const plain = direct.filter(n => !optional.has(n));
  const runs: string[][] = [];
  if (plain.length || !direct.length)
    runs.push(["check", ...(plain.length ? plain.flatMap(n => ["-p", n]) : ["--workspace"])]);
  for (const [pkg, f] of optional) {
    const feats = [...f].flatMap(x => x.split(",")).filter(x => x && x !== "*");
    runs.push(["check", "-p", pkg, ...(feats.length ? ["--features", feats.join(",")] : ["--all-features"])]);
  }
  for (const a of runs) if (cargo(c, a, true).status !== 0) return fail(`cargo ${a.join(" ")} failed`);
  recordTouched(c, direct);
  console.log(
    `major  ${label} ${rows.map(r => `${r.crate} ${r.locked} -> ${r.beyond}`).join(", ")} done; consumers checked: ${direct.join(", ") || "(workspace)"}`,
  );
  return true;
}

// ---------------------------------------------------------------- verify

async function verify(c: Ctx, args: string[]): Promise<number> {
  let code = 0;
  const ci = args.indexOf("--crates");
  const touched =
    ci >= 0
      ? (args[ci + 1] ?? "").split(",").filter(Boolean)
      : c.jsonFile<{ crates: string[] }>("target/update/rust-touched.json", {
          crates: [],
        }).crates;
  const step = (label: string, a: string[]) => {
    const r = cargo(c, a, true);
    console.log(`verify ${r.status === 0 ? "ok    " : "FAILED"} ${label}`);
    if (r.status !== 0) code = 1;
    return r.status === 0;
  };
  step("cargo check --workspace", ["check", "--workspace"]);
  if (touched.length)
    step(`cargo clippy (${touched.length} touched crate(s))`, ["clippy", ...touched.flatMap(n => ["-p", n])]);
  else console.log("verify skip   clippy (no touched crates recorded; run apply or pass --crates a,b)");
  const deny = c.run("cargo-deny", ["--version"]);
  if (deny.status === 0) {
    // Held advisories (advisory-holds.json) are expected findings; anything else fails the gate.
    const r = cargo(c, ["deny", "--format", "json", "check", "advisories"]);
    const found = denyAdvisories(r.stderr + r.stdout);
    const held = new Set(
      loadAdvisoryHolds(c)
        .filter(h => h.ecosystem === "crates.io")
        .map(h => h.name),
    );
    const open = [...found].filter(([n]) => !held.has(n));
    console.log(
      `verify ${open.length ? "FAILED" : "ok    "} cargo deny check advisories (${found.size} crate(s) flagged, ${found.size - open.length} held${open.length ? `; open: ${open.map(([n, ids]) => `${n} ${ids.join("/")}`).join(", ")}` : ""})`,
    );
    if (open.length) code = 1;
  } else console.log("verify skip   cargo deny (cargo-deny not installed: cargo install cargo-deny)");
  return code;
}

// ---------------------------------------------------------------- entry

/** Entry point for `yolo update rust <status|plan|apply|verify>`. Arguments: the subcommand, its flags, --root, --json. */
export async function runRust(args: string[]): Promise<number> {
  const ri = args.indexOf("--root");
  const root = resolve(ri >= 0 ? args[ri + 1]! : process.cwd());
  const rest = args.filter((a, i) => !(a === "--root" || (ri >= 0 && i === ri + 1)));
  const c = new Ctx(root, true, rest.includes("--json"));
  const [sub = "status", ...flags] = rest;
  switch (sub) {
    case "status": {
      const r = await rustStatus(c);
      if (c.json) console.log(JSON.stringify(r, null, 2));
      else printStatus(r);
      return flags.includes("--strict") && r.advisories.open.length ? 1 : 0;
    }
    case "plan":
      return plan(c, flags);
    case "apply":
      return apply(c, flags);
    case "verify":
      return verify(c, flags);
    // Loaded on demand: the doctor imports this module for the holds, the lock pins and the status report.
    case "doctor":
      return (await import("./rust-doctor.ts")).runDoctor(c, flags);
    case "fix":
      return (await import("./rust-doctor.ts")).runDoctor(c, ["--fix", ...flags]);
    default:
      console.error(
        "usage: rust [status [--strict]|plan [--no-cargo]|apply [--majors a,b+c] [--skip-refresh] [--keep]|verify [--crates a,b]|doctor [--fix] [--only a,b] [--skip a,b] [--strict] [--allow-dirty] [--verbose]|fix] [--root <repo>] [--json]",
      );
      return 2;
  }
}

if (import.meta.main) process.exit(await runRust(process.argv.slice(2)));
