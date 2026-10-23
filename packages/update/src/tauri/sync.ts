// SPDX-License-Identifier: Apache-2.0
/**
 * Tauri upstream auto-sync.
 *
 * Reads `tools/config/tauri-upstream.json`, compares the centralized versions (root
 * `Cargo.toml` [workspace.dependencies] and the root `package.json`
 * `workspaces.catalog`) with crates.io / npm / the tracked git refs, prints a
 * report, and with `--apply` bumps ONLY those two central files, refreshes the
 * lockfiles and runs a small gate, restoring every edited file when it fails.
 *
 * Usage: yolo ops tauri-sync [--root <repo>] [--check] [--apply] [--json] [--offline]
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  confSchemaDrift,
  fixConfSchemas,
  gateFromRegistry,
  parseRegistry,
  type Registry,
  workspaceState,
} from "./apps.ts";

const USER_AGENT = "aphrody-tauri-sync (https://github.com/aphrody-labs/aphrody)";

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

export type Semver = {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
};

export function parseSemver(input: string): Semver | null {
  const match = /^[=^~v\s]*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(input);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split(".") : [],
  };
}

const bare = (version: string) => version.replace(/^[=^~v\s]*/, "").trim();

/** SemVer 2.0 precedence (Bun.semver.order) after the same validation and prefix stripping as parseSemver. */
export function compareSemver(a: string, b: string): number {
  if (!parseSemver(a)) throw new Error(`invalid semver: ${a}`);
  if (!parseSemver(b)) throw new Error(`invalid semver: ${b}`);
  return Bun.semver.order(bare(a), bare(b));
}

/** Highest version of the requested major line (pre-releases included), ignoring yanked/invalid ids. */
export function pickLatest(versions: string[], line: number): string | null {
  let best: string | null = null;
  for (const version of versions) {
    const parsed = parseSemver(version);
    if (!parsed || parsed.major !== line) continue;
    if (best === null || compareSemver(version, best) > 0) best = version;
  }
  return best;
}

/** Highest version of the line that is at least `minAgeSeconds` old (mirrors bunfig minimumReleaseAge). */
export function pickEligible(
  times: Record<string, string>,
  line: number,
  now: number,
  minAgeSeconds: number,
): { latest: string | null; eligible: string | null } {
  const versions = Object.keys(times).filter(key => parseSemver(key));
  const latest = pickLatest(versions, line);
  const old = versions.filter(version => {
    const published = Date.parse(times[version] ?? "");
    return Number.isFinite(published) && now - published >= minAgeSeconds * 1000;
  });
  return { latest, eligible: pickLatest(old, line) };
}

export type CargoDep = {
  name: string;
  version: string | null;
  source: "crates.io" | "git" | "path";
};

/** Parse the `[workspace.dependencies]` table for the requested crate names (single-line entries). */
export function parseWorkspaceDeps(cargoToml: string, names: string[]): CargoDep[] {
  const section = /\[workspace\.dependencies\]([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(cargoToml);
  const body = section?.[1] ?? "";
  const out: CargoDep[] = [];
  for (const name of names) {
    const line = new RegExp(`^${escapeRegExp(name)}\\s*=\\s*(.+)$`, "m").exec(body)?.[1];
    if (line === undefined) continue;
    const version = /(?:^"|version\s*=\s*")([^"]+)"/.exec(line.trim())?.[1] ?? null;
    const source = /\bgit\s*=/.test(line) ? "git" : /\bpath\s*=/.test(line) ? "path" : "crates.io";
    out.push({ name, version: version?.replace(/^[=^~]/, "") ?? null, source });
  }
  return out;
}

/** Rewrite the version of one `[workspace.dependencies]` entry, keeping the `=` pin and other fields. */
export function rewriteWorkspaceDep(cargoToml: string, name: string, version: string): string {
  const section = /(\[workspace\.dependencies\])([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(cargoToml);
  if (!section) throw new Error("[workspace.dependencies] not found");
  const start = section.index + section[1]!.length;
  const body = section[2]!;
  const pattern = new RegExp(`^(${escapeRegExp(name)}\\s*=\\s*(?:"|\\{[^}\\n]*?version\\s*=\\s*"))=?[^"]+"`, "m");
  if (!pattern.test(body)) throw new Error(`${name} not found in [workspace.dependencies]`);
  const next = body.replace(pattern, (_all, head: string) => `${head}=${version}"`);
  return cargoToml.slice(0, start) + next + cargoToml.slice(start + body.length);
}

export function parseCatalog(packageJson: string, names: string[]): Record<string, string> {
  const catalog = (JSON.parse(packageJson).workspaces?.catalog ?? {}) as Record<string, string>;
  const out: Record<string, string> = {};
  for (const name of names) if (catalog[name] !== undefined) out[name] = catalog[name]!;
  return out;
}

/** Textual rewrite of one catalog entry so the file keeps its formatting. */
export function rewriteCatalogEntry(packageJson: string, name: string, version: string): string {
  const pattern = new RegExp(`("${escapeRegExp(name)}"\\s*:\\s*")[^"]*(")`);
  if (!pattern.test(packageJson)) throw new Error(`${name} not found in catalog`);
  return packageJson.replace(pattern, `$1${version}$2`);
}

export type PatchSpec = {
  id: string;
  kind: "vendored-crate" | "git-fork";
  crate: string;
  base?: string;
  path?: string;
  appliedFile?: string;
  appliedMarker?: string;
  rationale?: string;
  disposition?: string;
  upstreamContains?: {
    crate?: string;
    file?: string;
    url?: string;
    regex: string;
  };
};

export type MirrorSpec = { file: string; keys: Record<string, string> };

export type TauriUpstreamConfig = {
  schemaVersion: number;
  line: number;
  upstream: Record<
    string,
    {
      repository: string;
      trackedRef: string;
      observedCommit?: string;
      lineOfDev?: number;
    }
  >;
  policy: { npmMinimumReleaseAgeSeconds: number };
  rust: { crates: string[]; forks: string[] };
  js: { catalog: string[]; cli: { package: string; version: string } };
  /** Cargo packages and generated paths come from `tools/config/tauri-apps.json` (see tauri-apps.ts). */
  gate: { bun: string[] };
  patches: PatchSpec[];
  /** Source files that copy central versions (e.g. scaffold templates); keys map a source key to a tracked name. */
  mirrors?: MirrorSpec[];
  retired?: unknown[];
};

export function parseConfig(text: string): TauriUpstreamConfig {
  const value = JSON.parse(text) as Partial<TauriUpstreamConfig>;
  if (value.schemaVersion !== 1) throw new Error("tauri-upstream.json: unsupported schemaVersion");
  if (typeof value.line !== "number") throw new Error("tauri-upstream.json: line must be a number");
  for (const key of ["upstream", "policy", "rust", "js", "gate", "patches"] as const) {
    if (value[key] === undefined) throw new Error(`tauri-upstream.json: missing ${key}`);
  }
  if (!Array.isArray(value.rust?.crates)) throw new Error("tauri-upstream.json: rust.crates must be an array");
  return value as TauriUpstreamConfig;
}

export type Row = {
  kind: "crate" | "npm" | "cli";
  name: string;
  current: string | null;
  latest: string | null;
  /** Newest version we may apply (npm minimumReleaseAge, held patches). */
  target: string | null;
  status: "ok" | "behind" | "held" | "too-fresh" | "unknown" | "fork";
  note?: string;
};

export function classify(
  current: string | null,
  latest: string | null,
  target: string | null,
  hold?: string,
): Pick<Row, "status" | "note"> {
  if (current === null || latest === null) return { status: "unknown", note: "version not resolved" };
  if (compareSemver(current, latest) >= 0) return { status: "ok" };
  if (hold) return { status: "held", note: hold };
  if (target === null || compareSemver(current, target) >= 0) {
    return {
      status: "too-fresh",
      note: "newest release is younger than minimumReleaseAge",
    };
  }
  return { status: "behind" };
}

export type PatchResult = {
  id: string;
  state: "applied" | "missing" | "unapplied" | "upstream-contains" | "newer-base" | "unchecked";
  detail: string;
};

export function evaluatePatch(input: {
  spec: PatchSpec;
  fileText: string | null;
  cargoPatchPresent: boolean;
  latestPublished: string | null;
  upstreamContainsFix: boolean | null;
}): PatchResult {
  const { spec } = input;
  if (spec.kind === "vendored-crate") {
    if (input.fileText === null)
      return {
        id: spec.id,
        state: "missing",
        detail: `${spec.appliedFile} not found`,
      };
    if (spec.appliedMarker && !input.fileText.includes(spec.appliedMarker)) {
      return {
        id: spec.id,
        state: "unapplied",
        detail: "patched line not present in the vendored copy",
      };
    }
    if (!input.cargoPatchPresent) {
      return {
        id: spec.id,
        state: "unapplied",
        detail: "vendored copy is neither a path dependency nor a workspace member",
      };
    }
  }
  if (input.upstreamContainsFix === true) {
    return {
      id: spec.id,
      state: "upstream-contains",
      detail: spec.disposition ?? "upstream contains the fix",
    };
  }
  if (spec.base && input.latestPublished && compareSemver(input.latestPublished, spec.base) > 0) {
    return {
      id: spec.id,
      state: "newer-base",
      detail: `${spec.crate} ${input.latestPublished} is published, base is ${spec.base}; re-check the patch`,
    };
  }
  return {
    id: spec.id,
    state: input.upstreamContainsFix === null ? "unchecked" : "applied",
    detail: input.upstreamContainsFix === null ? "upstream not queried" : "still required",
  };
}

export type Drift = {
  file: string;
  key: string;
  name: string;
  mirror: string | null;
  expected: string;
};

/** Compare `key: "version"` literals of a mirror file with the central versions. */
export function mirrorDrift(text: string, spec: MirrorSpec, central: Record<string, string | null>): Drift[] {
  const out: Drift[] = [];
  for (const [key, name] of Object.entries(spec.keys)) {
    const expected = central[name];
    if (!expected) continue;
    const mirror = new RegExp(`\\b${escapeRegExp(key)}:\\s*"([^"]+)"`).exec(text)?.[1] ?? null;
    if (mirror !== expected) out.push({ file: spec.file, key, name, mirror, expected });
  }
  return out;
}

export function rewriteMirror(text: string, spec: MirrorSpec, central: Record<string, string | null>): string {
  let next = text;
  for (const [key, name] of Object.entries(spec.keys)) {
    const value = central[name];
    if (!value) continue;
    const pattern = new RegExp(`(\\b${escapeRegExp(key)}:\\s*")[^"]+(")`);
    if (!pattern.test(next)) throw new Error(`${spec.file}: key ${key} not found`);
    next = next.replace(pattern, `$1${value}$2`);
  }
  return next;
}

export type Report = {
  rows: Row[];
  patches: PatchResult[];
  refs: {
    name: string;
    ref: string;
    commit: string | null;
    line?: string | null;
  }[];
  behind: number;
  brokenPatches: number;
  drift: Drift[];
};

export function summarize(rows: Row[], patches: PatchResult[], refs: Report["refs"], drift: Drift[] = []): Report {
  return {
    drift,
    rows,
    patches,
    refs,
    behind: rows.filter(row => row.status === "behind").length,
    brokenPatches: patches.filter(patch => patch.state === "missing" || patch.state === "unapplied").length,
  };
}

export function renderReport(report: Report): string {
  const width = Math.max(4, ...report.rows.map(row => row.name.length));
  const lines: string[] = [];
  lines.push("Tauri upstream sync");
  for (const ref of report.refs) {
    lines.push(`  ref ${ref.name} ${ref.ref} -> ${ref.commit?.slice(0, 8) ?? "?"}${ref.line ? ` (${ref.line})` : ""}`);
  }
  lines.push("");
  lines.push(`${"name".padEnd(width)}  kind   current           latest            status`);
  for (const row of report.rows) {
    lines.push(
      `${row.name.padEnd(width)}  ${row.kind.padEnd(5)}  ${(row.current ?? "-").padEnd(16)}  ${(row.latest ?? "-").padEnd(16)}  ${row.status}${row.note ? ` (${row.note})` : ""}`,
    );
  }
  lines.push("");
  lines.push("patches");
  for (const patch of report.patches) lines.push(`  ${patch.id}: ${patch.state} - ${patch.detail}`);
  if (report.drift.length > 0) {
    lines.push("");
    lines.push("mirror drift");
    for (const item of report.drift) {
      lines.push(`  ${item.file}: ${item.key} is ${item.mirror ?? "missing"}, expected ${item.expected}`);
    }
  }
  lines.push("");
  lines.push(`behind=${report.behind} brokenPatches=${report.brokenPatches} drift=${report.drift.length}`);
  return lines.join("\n");
}

export type Args = {
  root: string;
  check: boolean;
  apply: boolean;
  json: boolean;
  offline: boolean;
};

export function parseArgs(argv: string[], cwd = process.cwd()): Args {
  const args: Args = {
    root: cwd,
    check: false,
    apply: false,
    json: false,
    offline: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--root") {
      const value = argv[++index];
      if (!value) throw new Error("--root requires a path");
      args.root = value;
    } else if (arg === "--check") args.check = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--offline") args.offline = true;
    else if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.apply && args.offline) throw new Error("--apply needs network access; drop --offline");
  if (args.apply && args.check) throw new Error("--apply and --check are mutually exclusive");
  args.root = resolve(args.root);
  return args;
}

export function exitCode(report: Report, args: Pick<Args, "check">): number {
  if (report.brokenPatches > 0 || report.drift.length > 0) return 1;
  return args.check && report.behind > 0 ? 1 : 0;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Network + process helpers (read-only queries only)
// ---------------------------------------------------------------------------

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function crateVersions(name: string): Promise<string[]> {
  const body = await fetchJson(`https://crates.io/api/v1/crates/${name}/versions`);
  return (body.versions as { num: string; yanked: boolean }[]).filter(v => !v.yanked).map(v => v.num);
}

async function npmTimes(name: string): Promise<Record<string, string>> {
  const body = await fetchJson(`https://registry.npmjs.org/${name.replace("/", "%2F")}`);
  const times = { ...(body.time as Record<string, string>) };
  delete times.created;
  delete times.modified;
  return times;
}

function lsRemote(repository: string, ref: string): string | null {
  const result = Bun.spawnSync(["git", "ls-remote", `https://github.com/${repository}.git`, `refs/heads/${ref}`], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  return new TextDecoder().decode(result.stdout).split(/\s+/)[0] || null;
}

/** Read one regular archive member without extracting files or invoking host tools. */
export async function readCrateArchiveFile(bytes: ArrayBuffer, path: string): Promise<string | null> {
  try {
    const literalPath = path.replace(/[\\*?[\]{}]/g, "\\$&");
    const entries = await new Bun.Archive(bytes).files(literalPath);
    return (await entries.get(path)?.text()) ?? null;
  } catch {
    // Match the former tar command's nonzero exit result for invalid archives.
    return null;
  }
}

async function crateFile(crate: string, version: string, file: string): Promise<string | null> {
  const response = await fetch(`https://static.crates.io/crates/${crate}/${crate}-${version}.crate`, {
    headers: { "user-agent": USER_AGENT },
  });
  if (!response.ok) return null;
  return readCrateArchiveFile(await response.arrayBuffer(), `${crate}-${version}/${file}`);
}

function run(command: string[], cwd: string): { ok: boolean; output: string } {
  console.log(`[tauri-sync] ${command.join(" ")}`);
  const result = Bun.spawnSync(command, {
    windowsHide: true,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, RUSTC_WRAPPER: process.env.RUSTC_WRAPPER ?? "" },
  });
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  return { ok: result.exitCode === 0, output };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function loadRegistry(root: string): Promise<Registry | null> {
  const path = join(root, "tools/config/tauri-apps.json");
  return existsSync(path) ? parseRegistry(await readFile(path, "utf8")) : null;
}

export async function buildReport(root: string, config: TauriUpstreamConfig, offline: boolean): Promise<Report> {
  const cargoToml = await readFile(join(root, "Cargo.toml"), "utf8");
  const packageJson = await readFile(join(root, "package.json"), "utf8");
  const held = new Map<string, string>();
  for (const spec of config.patches) {
    if (spec.kind === "vendored-crate") held.set(spec.crate, `held by patch ${spec.id}`);
  }
  const rows: Row[] = [];
  const now = Date.now();
  const deps = parseWorkspaceDeps(cargoToml, [...config.rust.crates, ...config.rust.forks]);
  const latestPublished = new Map<string, string | null>();
  for (const dep of deps) {
    if (dep.source === "git") {
      rows.push({
        kind: "crate",
        name: dep.name,
        current: dep.version,
        latest: null,
        target: null,
        status: "fork",
        note: "git fork, see patches",
      });
      continue;
    }
    let latest: string | null = null;
    if (!offline) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- interrogation séquentielle de crates.io, limite de débit du registre
        latest = pickLatest(await crateVersions(dep.name), config.line);
      } catch (error) {
        rows.push({
          kind: "crate",
          name: dep.name,
          current: dep.version,
          latest: null,
          target: null,
          status: "unknown",
          note: String(error),
        });
        continue;
      }
    }
    latestPublished.set(dep.name, latest);
    const hold = held.get(dep.name);
    rows.push({
      kind: "crate",
      name: dep.name,
      current: dep.version,
      latest,
      target: latest,
      ...(offline ? { status: "unknown" as const, note: "offline" } : classify(dep.version, latest, latest, hold)),
    });
  }
  const catalog = parseCatalog(packageJson, config.js.catalog);
  const npmTargets: [string, "npm" | "cli", string | null][] = [
    ...config.js.catalog.map(name => [name, "npm", catalog[name] ?? null] as [string, "npm", string | null]),
    [config.js.cli.package, "cli", config.js.cli.version],
  ];
  // Packages listed in bunfig `minimumReleaseAgeExcludes` skip the age gate in bun install, so skip it here too.
  const bunfig = existsSync(join(root, "bunfig.toml")) ? await readFile(join(root, "bunfig.toml"), "utf8") : "";
  const ageExcluded = new Set(
    [...(bunfig.match(/^minimumReleaseAgeExcludes\s*=\s*\[([^\]]*)\]/m)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
      m => m[1]!,
    ),
  );
  for (const [name, kind, current] of npmTargets) {
    const clean = current?.replace(/^[=^~]/, "") ?? null;
    if (offline) {
      rows.push({
        kind,
        name,
        current: clean,
        latest: null,
        target: null,
        status: "unknown",
        note: "offline",
      });
      continue;
    }
    try {
      const { latest, eligible } = pickEligible(
        // oxlint-disable-next-line no-await-in-loop -- interrogation séquentielle du registre npm, limite de débit
        await npmTimes(name),
        config.line,
        now,
        ageExcluded.has(name) ? 0 : config.policy.npmMinimumReleaseAgeSeconds,
      );
      rows.push({
        kind,
        name,
        current: clean,
        latest,
        target: eligible,
        ...classify(clean, latest, eligible),
      });
    } catch (error) {
      rows.push({
        kind,
        name,
        current: clean,
        latest: null,
        target: null,
        status: "unknown",
        note: String(error),
      });
    }
  }
  const patches: PatchResult[] = [];
  for (const spec of config.patches) {
    const fileText =
      spec.appliedFile && existsSync(join(root, spec.appliedFile))
        ? // oxlint-disable-next-line no-await-in-loop -- lecture séquentielle des correctifs dans l'ordre de la configuration
          await readFile(join(root, spec.appliedFile), "utf8")
        : null;
    // The vendored copy is wired as a path dependency (workspace.dependencies or
    // [patch.crates-io]) or as a workspace member of the fork under crates/tauri.
    const cargoPatchPresent =
      spec.kind !== "vendored-crate" ||
      new RegExp(`\\bpath\\s*=\\s*"${escapeRegExp(spec.path ?? "")}"`).test(cargoToml) ||
      (spec.path !== undefined && workspaceState(cargoToml, spec.path) === "member");
    let contains: boolean | null = null;
    const check = spec.upstreamContains;
    if (!offline && check) {
      try {
        let text: string | null = null;
        // oxlint-disable-next-line no-await-in-loop -- vérifications amont séquentielles par correctif (sites et registres, limite de débit)
        if (check.url) text = await fetchText(check.url);
        else if (check.crate && check.file) {
          const latest =
            latestPublished.get(check.crate) ??
            // oxlint-disable-next-line no-await-in-loop -- interrogation séquentielle de crates.io, limite de débit du registre
            pickLatest(await crateVersions(check.crate), config.line);
          // oxlint-disable-next-line no-await-in-loop -- téléchargement séquentiel du fichier amont de la version retenue
          text = latest ? await crateFile(check.crate, latest, check.file) : null;
        }
        contains = text === null ? null : new RegExp(check.regex, "m").test(text);
      } catch {
        contains = null;
      }
    }
    patches.push(
      evaluatePatch({
        spec,
        fileText,
        cargoPatchPresent,
        latestPublished: spec.crate ? (latestPublished.get(spec.crate) ?? null) : null,
        upstreamContainsFix: contains,
      }),
    );
  }
  const refs: Report["refs"] = [];
  if (!offline) {
    for (const [name, up] of Object.entries(config.upstream)) {
      const commit = lsRemote(up.repository, up.trackedRef);
      let line: string | null = null;
      if (name === "tauri") {
        const dev = lsRemote(up.repository, "dev");
        try {
          // oxlint-disable-next-line no-await-in-loop -- lecture séquentielle du manifeste de dev, par dépôt amont (limite de débit de GitHub)
          const devToml = await fetchText(
            `https://raw.githubusercontent.com/${up.repository}/dev/crates/tauri/Cargo.toml`,
          );
          const devVersion = /^version\s*=\s*"([^"]+)"/m.exec(devToml)?.[1];
          line = `dev ${dev?.slice(0, 8) ?? "?"} tracks tauri ${devVersion ?? "?"}`;
        } catch {
          line = null;
        }
      }
      refs.push({ name, ref: up.trackedRef, commit, line });
    }
  }
  const central: Record<string, string | null> = {};
  for (const row of rows) central[row.name] = row.current;
  const drift: Drift[] = [];
  for (const spec of config.mirrors ?? []) {
    const path = join(root, spec.file);
    if (!existsSync(path)) {
      drift.push({
        file: spec.file,
        key: "*",
        name: "*",
        mirror: null,
        expected: "file present",
      });
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- lecture séquentielle des miroirs : l'ordre des dérives reste celui de la configuration
    drift.push(...mirrorDrift(await readFile(path, "utf8"), spec, central));
  }
  const registry = await loadRegistry(root);
  if (registry && central["tauri"]) {
    for (const { file, tag } of await confSchemaDrift(root, registry, central["tauri"])) {
      drift.push({
        file,
        key: "$schema",
        name: "tauri",
        mirror: tag,
        expected: central["tauri"],
      });
    }
  }
  return summarize(rows, patches, refs, drift);
}

type Snapshot = Map<string, string | null>;

async function snapshot(root: string, files: string[]): Promise<Snapshot> {
  const texts = await Promise.all(
    files.map(file => {
      const path = join(root, file);
      return existsSync(path) ? readFile(path, "utf8") : null;
    }),
  );
  return new Map(files.map((file, index): [string, string | null] => [file, texts[index] ?? null]));
}

async function restore(root: string, saved: Snapshot): Promise<void> {
  for (const [file, text] of saved) if (text !== null) await writeFile(join(root, file), text);
}

export async function applyReport(root: string, config: TauriUpstreamConfig, report: Report): Promise<number> {
  const todo = report.rows.filter(row => row.status === "behind" && row.target);
  if (todo.length === 0 && report.drift.length === 0) {
    console.log("[tauri-sync] nothing to apply");
    return 0;
  }
  const registry = await loadRegistry(root);
  const confFiles = (registry?.projects ?? []).flatMap(project =>
    (project.confs ?? []).map(conf => `${project.path}/${conf}`),
  );
  const files = [
    "Cargo.toml",
    "Cargo.lock",
    "package.json",
    "bun.lock",
    "tools/config/tauri-upstream.json",
    ...(config.mirrors ?? []).map(mirror => mirror.file),
    ...confFiles,
  ];
  const saved = await snapshot(root, files);
  try {
    let cargoToml = saved.get("Cargo.toml")!;
    let packageJson = saved.get("package.json")!;
    let configText = saved.get("tools/config/tauri-upstream.json")!;
    for (const row of todo) {
      if (row.kind === "crate") cargoToml = rewriteWorkspaceDep(cargoToml, row.name, row.target!);
      else if (row.kind === "npm") packageJson = rewriteCatalogEntry(packageJson, row.name, row.target!);
      else
        configText = configText.replace(
          new RegExp(`("${escapeRegExp(config.js.cli.package)}"[\\s\\S]*?"version"\\s*:\\s*")[^"]+(")`),
          `$1${row.target}$2`,
        );
      console.log(`[tauri-sync] ${row.name}: ${row.current} -> ${row.target}`);
    }
    await writeFile(join(root, "Cargo.toml"), cargoToml);
    await writeFile(join(root, "package.json"), packageJson);
    await writeFile(join(root, "tools/config/tauri-upstream.json"), configText);
    const central: Record<string, string | null> = {};
    for (const row of report.rows) central[row.name] = row.current;
    for (const row of todo) central[row.name] = row.target;
    for (const mirror of config.mirrors ?? []) {
      const text = saved.get(mirror.file);
      if (text === null || text === undefined) continue;
      const next = rewriteMirror(text, mirror, central);
      if (next !== text) {
        // oxlint-disable-next-line no-await-in-loop -- écritures des miroirs séquentielles : le journal de console suit l'ordre de la configuration
        await writeFile(join(root, mirror.file), next);
        console.log(`[tauri-sync] mirror updated: ${mirror.file}`);
      }
    }
    if (registry && central["tauri"]) {
      for (const file of await fixConfSchemas(root, registry, central["tauri"])) {
        console.log(`[tauri-sync] $schema updated: ${file}`);
      }
    }
    const gate = registry ? gateFromRegistry(registry) : { cargoPackages: [], generatedPaths: [] };
    const gates: string[][] = [
      ...(gate.cargoPackages.length > 0
        ? [
            [
              "bash",
              "scripts/aphrody/build/rust/cargo-serial.sh",
              "check",
              ...gate.cargoPackages.flatMap(pkg => ["-p", pkg]),
            ],
          ] // repo rule: Cargo only through the serialized wrapper
        : []),
      ...config.gate.bun.map(command => command.split(" ")),
    ];
    for (const command of gates) {
      const result = run(command, root);
      if (!result.ok) {
        console.error(result.output.split("\n").slice(-40).join("\n"));
        throw new Error(`gate failed: ${command.join(" ")}`);
      }
    }
    console.log("[tauri-sync] gate passed");
    console.log(`[tauri-sync] cargo rewrites generated schemas; review or restore: ${gate.generatedPaths.join(", ")}`);
    return 0;
  } catch (error) {
    await restore(root, saved);
    console.error(
      `[tauri-sync] reverted Cargo.toml, Cargo.lock, package.json, bun.lock, config, mirrors and conf schemas: ${error instanceof Error ? error.message : error}`,
    );
    return 1;
  }
}

export async function runTauriSync(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("Usage: yolo ops tauri-sync [--root <repo>] [--check] [--apply] [--json] [--offline]");
    return message === "help" ? 0 : (console.error(message), 2);
  }
  const config = parseConfig(await readFile(join(args.root, "tools/config/tauri-upstream.json"), "utf8"));
  const report = await buildReport(args.root, config, args.offline);
  console.log(args.json ? JSON.stringify(report, null, 2) : renderReport(report));
  if (args.apply) {
    if (report.brokenPatches > 0) {
      console.error("[tauri-sync] refusing to apply while a local patch is missing or unapplied");
      return 1;
    }
    return applyReport(args.root, config, report);
  }
  return exitCode(report, args);
}

if (import.meta.main) process.exit(await runTauriSync(process.argv.slice(2)));
