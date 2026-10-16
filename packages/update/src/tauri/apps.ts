// SPDX-License-Identifier: Apache-2.0
/**
 * Registry and audit of every Tauri project in the monorepo.
 *
 * `tools/config/tauri-apps.json` is the single list of Tauri apps, plugins, generators and upstream fixtures.
 * This command scans the whole tree (git-ignored and Cargo-workspace-excluded paths included; only
 * `scanSkip` directories such as target/node_modules are skipped), compares it with the registry and
 * checks the duplication rules: Tauri crates come from the root `[workspace.dependencies]`, Tauri npm
 * packages from the `workspaces.catalog`, every first-party `tauri*.conf.json` `$schema` carries the
 * pinned Tauri tag and nothing points at the legacy sibling checkouts.
 *
 * Usage: yolo ops tauri-apps [--root <repo>] [--check] [--fix] [--json]
 */
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export type ProjectKind =
  | "app"
  | "library"
  | "plugin"
  | "tool"
  | "generator"
  | "integration"
  | "js-package"
  | "upstream"
  /** Standalone project written by a generator; pins its own versions. */
  | "template";

export type RegistryProject = {
  id: string;
  kind: ProjectKind;
  path: string;
  package?: string;
  runtime?: "cef";
  workspace?: "member" | "excluded" | "upstream";
  confs?: string[];
  /** Part of the `cargo check -p` gate run by tauri-sync. */
  gate?: boolean;
  /** Paths rewritten by tauri builds; restore or review after a gate run. */
  generated?: string[];
  /** Covers every discovered project below `path` (upstream-owned workspaces). */
  subtree?: boolean;
  note?: string;
};

export type Registry = {
  schemaVersion: number;
  scanSkip: string[];
  projects: RegistryProject[];
};

export function parseRegistry(text: string): Registry {
  const value = JSON.parse(text) as Partial<Registry>;
  if (value.schemaVersion !== 1)
    throw new Error("tauri-apps.json: unsupported schemaVersion");
  if (!Array.isArray(value.projects))
    throw new Error("tauri-apps.json: projects must be an array");
  const seen = new Set<string>();
  for (const project of value.projects) {
    if (!project.id || !project.path || !project.kind)
      throw new Error(
        `tauri-apps.json: incomplete project ${JSON.stringify(project)}`,
      );
    if (seen.has(project.id))
      throw new Error(`tauri-apps.json: duplicate id ${project.id}`);
    seen.add(project.id);
  }
  return {
    schemaVersion: 1,
    scanSkip: value.scanSkip ?? [],
    projects: value.projects,
  };
}

/** Cargo packages and generated paths that tauri-sync's gate derives from the registry. */
export function gateFromRegistry(registry: Registry): {
  cargoPackages: string[];
  generatedPaths: string[];
} {
  const gated = registry.projects.filter(
    (project) => project.gate && project.package,
  );
  return {
    cargoPackages: gated.map((project) => project.package as string),
    generatedPaths: registry.projects.flatMap(
      (project) => project.generated ?? [],
    ),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------------------------------------

export type Via = "conf" | "cargo" | "npm";
export type Discovered = { dir: string; via: Via[]; confs: string[] };

const CONF_FILE =
  /^tauri(\.[a-z0-9-]+)?\.conf\.json5?$|^Tauri(\.[a-z0-9-]+)?\.toml$/;
const TAURI_CRATE = /^(tauri|tauri-[a-z0-9-]+)$/;

/** Dependency table lines (`[dependencies]`, `[build-dependencies]`, `[dev-dependencies]`, target tables). */
export function tauriCargoDeps(
  cargoToml: string,
): { name: string; inherited: boolean }[] {
  const out: { name: string; inherited: boolean }[] = [];
  let inDeps = false;
  for (const raw of cargoToml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inDeps =
        /^\[(?:target\.[^\]]+\.)?(?:dependencies|build-dependencies|dev-dependencies)\]$/.test(
          line,
        );
      const named =
        /^\[(?:target\.[^\]]+\.)?(?:dependencies|build-dependencies|dev-dependencies)\.([\w-]+)\]$/.exec(
          line,
        );
      if (named?.[1] && TAURI_CRATE.test(named[1]))
        out.push({ name: named[1], inherited: false });
      continue;
    }
    if (!inDeps) continue;
    const dep = /^([\w-]+)(\.workspace)?\s*(?:=\s*(.*))?$/.exec(line);
    if (!dep?.[1] || !TAURI_CRATE.test(dep[1])) continue;
    out.push({
      name: dep[1],
      // A path dependency points at the vendored fork, whose version is the pin itself.
      inherited:
        Boolean(dep[2]) ||
        /\b(?:workspace\s*=\s*true\b|path\s*=)/.test(dep[3] ?? ""),
    });
  }
  return out;
}

/** Tauri npm dependencies a package.json declares (peer ranges are not versions we pin). */
export function npmTauriDeps(
  packageJson: string,
): { name: string; version: string }[] {
  const manifest = JSON.parse(packageJson) as Record<
    string,
    Record<string, string> | undefined
  >;
  const out: { name: string; version: string }[] = [];
  for (const table of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    for (const [name, version] of Object.entries(manifest[table] ?? {})) {
      if (name.startsWith("@tauri-apps/") || name.startsWith("tauri-plugin-"))
        out.push({ name, version });
    }
  }
  return out;
}

async function walk(
  root: string,
  skip: Set<string>,
  visit: (rel: string, name: string) => Promise<void>,
) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      // oxlint-disable-next-line no-await-in-loop -- directories are walked depth-first one at a time and visit() runs in traversal order
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) stack.push(join(dir, entry.name));
      } else if (entry.isFile()) {
        // oxlint-disable-next-line no-await-in-loop -- directories are walked depth-first one at a time and visit() runs in traversal order
        await visit(relative(root, dir).split(sep).join("/"), entry.name);
      }
    }
  }
}

export async function discover(
  root: string,
  scanSkip: string[],
): Promise<Discovered[]> {
  const found = new Map<string, Discovered>();
  const touch = (dir: string, via: Via) => {
    const key = dir === "" ? "." : dir;
    const item = found.get(key) ?? { dir: key, via: [], confs: [] };
    if (!item.via.includes(via)) item.via.push(via);
    found.set(key, item);
    return item;
  };
  await walk(root, new Set(scanSkip), async (dir, name) => {
    const path = join(root, dir, name);
    if (CONF_FILE.test(name)) {
      touch(dir, "conf").confs.push(name);
    } else if (name === "Cargo.toml" && dir !== "") {
      if (tauriCargoDeps(await readFile(path, "utf8")).length > 0)
        touch(dir, "cargo");
    } else if (name === "package.json" && dir !== "") {
      try {
        if (npmTauriDeps(await readFile(path, "utf8")).length > 0)
          touch(dir, "npm");
      } catch {
        // not a parseable manifest (template fragments); not a Tauri consumer
      }
    }
  });
  return [...found.values()].toSorted((a, b) => a.dir.localeCompare(b.dir));
}

// ---------------------------------------------------------------------------------------------------------
// Workspace membership and registry coverage
// ---------------------------------------------------------------------------------------------------------

function stringArray(cargoToml: string, key: "members" | "exclude"): string[] {
  const workspace =
    /\[workspace\]([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(cargoToml)?.[1] ?? "";
  const array =
    new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m").exec(
      workspace,
    )?.[1] ?? "";
  return [...array.matchAll(/"([^"]+)"/g)].map((match) => match[1] as string);
}

export type WorkspaceState = "member" | "excluded" | "upstream" | "outside";

/** Whether a crate directory is a member of the root Cargo workspace, excluded from it, or elsewhere. */
export function workspaceState(cargoToml: string, dir: string): WorkspaceState {
  if (
    stringArray(cargoToml, "exclude").some((glob) =>
      new Bun.Glob(glob).match(dir),
    )
  )
    return "excluded";
  if (
    stringArray(cargoToml, "members").some((glob) =>
      new Bun.Glob(glob).match(dir),
    )
  )
    return "member";
  return dir === "upstream" || dir.startsWith("upstream/")
    ? "upstream"
    : "outside";
}

/** The registry project covering a discovered directory (exact path, or any depth below a subtree). */
export function owner(
  registry: Registry,
  dir: string,
): RegistryProject | undefined {
  return registry.projects.find(
    (project) =>
      project.path === dir ||
      (project.subtree === true && dir.startsWith(`${project.path}/`)),
  );
}

// ---------------------------------------------------------------------------------------------------------
// `$schema` tag
// ---------------------------------------------------------------------------------------------------------

const SCHEMA_TAG =
  /(tauri-apps\/tauri\/)tauri-v([^/"]+)(\/crates\/tauri-schema-generator\/schemas\/config\.schema\.json)/;

export function schemaTag(confText: string): string | null {
  return SCHEMA_TAG.exec(confText)?.[2] ?? null;
}

export function rewriteSchemaTag(confText: string, version: string): string {
  return confText.replace(SCHEMA_TAG, `$1tauri-v${version}$3`);
}

export function schemaUrl(version: string): string {
  return `https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v${version}/crates/tauri-schema-generator/schemas/config.schema.json`;
}

/** Pinned `tauri` version from the root `[workspace.dependencies]`. */
export function pinnedTauriVersion(rootCargoToml: string): string | null {
  const body =
    /\[workspace\.dependencies\]([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(
      rootCargoToml,
    )?.[1] ?? "";
  const line = /^tauri\s*=\s*(.+)$/m.exec(body)?.[1];
  return (
    /(?:^"|version\s*=\s*")=?([^"]+)"/.exec(line?.trim() ?? "")?.[1] ?? null
  );
}

/** First-party configs whose `$schema` tag differs from the pinned Tauri version. */
export async function confSchemaDrift(
  root: string,
  registry: Registry,
  version: string,
): Promise<{ file: string; tag: string | null }[]> {
  const confs = registry.projects.flatMap((project) =>
    (project.confs ?? []).map((conf) => `${project.path}/${conf}`),
  );
  // Reads are independent; Promise.all keeps the registry order of the drift list.
  const drift = await Promise.all(
    confs.map(async (file) => {
      const path = join(root, file);
      if (!existsSync(path)) return undefined;
      const tag = schemaTag(await readFile(path, "utf8"));
      return tag !== version ? { file, tag } : undefined;
    }),
  );
  return drift.filter(
    (item): item is { file: string; tag: string | null } => item !== undefined,
  );
}

/** Rewrite drifted first-party `$schema` tags; returns the files changed. */
export async function fixConfSchemas(
  root: string,
  registry: Registry,
  version: string,
): Promise<string[]> {
  const drift = await confSchemaDrift(root, registry, version);
  // Each file is rewritten independently; Promise.all keeps the drift order of the changed list.
  const changed = await Promise.all(
    drift.map(async ({ file }) => {
      const path = join(root, file);
      const text = await readFile(path, "utf8");
      const next = SCHEMA_TAG.test(text)
        ? rewriteSchemaTag(text, version)
        : text.replace(
            /^\{\n/,
            `{\n  "$schema": ${JSON.stringify(schemaUrl(version))},\n`,
          );
      if (next === text) return undefined;
      await writeFile(path, next);
      return file;
    }),
  );
  return changed.filter((file): file is string => file !== undefined);
}

// ---------------------------------------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------------------------------------

export type GitState = "tracked" | "untracked" | "ignored";
export type Row = {
  dir: string;
  via: Via[];
  id: string | null;
  kind: ProjectKind | null;
  workspace: WorkspaceState;
  git: GitState;
};
export type Violation = { code: string; subject: string; detail: string };
export type AuditReport = {
  tauri: string | null;
  rows: Row[];
  violations: Violation[];
  warnings: Violation[];
};

const FIRST_PARTY: ReadonlySet<ProjectKind> = new Set<ProjectKind>([
  "app",
  "library",
  "plugin",
  "tool",
  "generator",
  "integration",
  "js-package",
]);
const LEGACY_SIBLING =
  /(?:\.\.\/)+aphrody-(?:ui|ai|koharu|infra|py)\b|\bbun\s+--cwd\s+\.\.\/aphrody-/;

function git(root: string, args: string[], input?: string): string {
  const result = Bun.spawnSync(["git", ...args], {
    windowsHide: true,
    cwd: root,
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0 || result.exitCode === 1
    ? new TextDecoder().decode(result.stdout)
    : "";
}

export function gitStates(root: string, dirs: string[]): Map<string, GitState> {
  const tracked = git(root, ["ls-files", "-z"]).split("\0");
  const ignored = new Set(
    git(root, ["check-ignore", "-z", "--stdin"], dirs.join("\0"))
      .split("\0")
      .filter(Boolean),
  );
  const states = new Map<string, GitState>();
  for (const dir of dirs) {
    const prefix = `${dir}/`;
    const isTracked = tracked.some((file) => file.startsWith(prefix));
    states.set(
      dir,
      isTracked ? "tracked" : ignored.has(dir) ? "ignored" : "untracked",
    );
  }
  return states;
}

export async function audit(
  root: string,
  registry: Registry,
): Promise<AuditReport> {
  const rootCargo = await readFile(join(root, "Cargo.toml"), "utf8");
  const tauri = pinnedTauriVersion(rootCargo);
  const discovered = await discover(root, registry.scanSkip);
  const states = gitStates(
    root,
    discovered.map((item) => item.dir),
  );
  const violations: Violation[] = [];
  const warnings: Violation[] = [];
  const rows: Row[] = [];

  for (const item of discovered) {
    const project = owner(registry, item.dir);
    rows.push({
      dir: item.dir,
      via: item.via,
      id: project?.id ?? null,
      kind: project?.kind ?? null,
      workspace: workspaceState(rootCargo, item.dir),
      git: states.get(item.dir) ?? "untracked",
    });
    if (!project) {
      violations.push({
        code: "unregistered",
        subject: item.dir,
        detail: `Tauri project (${item.via.join("+")}) missing from tools/config/tauri-apps.json`,
      });
      continue;
    }
    const unlisted = item.confs.filter(
      (conf) => !(project.confs ?? []).includes(conf),
    );
    if (!project.subtree && unlisted.length > 0) {
      violations.push({
        code: "unregistered-conf",
        subject: item.dir,
        detail: `config files not listed in the registry: ${unlisted.join(", ")}`,
      });
    }
  }

  for (const project of registry.projects) {
    if (!existsSync(join(root, project.path))) {
      violations.push({
        code: "missing",
        subject: project.id,
        detail: `${project.path} does not exist`,
      });
      continue;
    }
    for (const conf of project.confs ?? []) {
      if (!existsSync(join(root, project.path, conf))) {
        violations.push({
          code: "missing-conf",
          subject: project.id,
          detail: `${project.path}/${conf} does not exist`,
        });
      }
    }
    if (project.workspace && project.package) {
      const actual = workspaceState(rootCargo, project.path);
      if (actual !== project.workspace) {
        violations.push({
          code: "workspace-mismatch",
          subject: project.id,
          detail: `registry says ${project.workspace}, root Cargo.toml says ${actual}`,
        });
      }
    }
  }

  // Duplication rules for first-party projects (upstream trees keep their own manifests).
  for (const project of registry.projects.filter((entry) =>
    FIRST_PARTY.has(entry.kind),
  )) {
    const cargo = join(root, project.path, "Cargo.toml");
    if (existsSync(cargo)) {
      // oxlint-disable-next-line no-await-in-loop -- violations are appended in registry order, so the report keeps a stable order
      for (const dep of tauriCargoDeps(await readFile(cargo, "utf8"))) {
        if (!dep.inherited) {
          violations.push({
            code: "pinned-crate",
            subject: project.id,
            detail: `${dep.name} must be \`workspace = true\` (version lives in the root Cargo.toml)`,
          });
        }
      }
    }
    const manifest = join(root, project.path, "package.json");
    if (existsSync(manifest)) {
      // oxlint-disable-next-line no-await-in-loop -- violations are appended in registry order, so the report keeps a stable order
      for (const dep of npmTauriDeps(await readFile(manifest, "utf8"))) {
        if (dep.version !== "catalog:") {
          violations.push({
            code: "pinned-npm",
            subject: project.id,
            detail: `${dep.name} is "${dep.version}"; use "catalog:" (version lives in workspaces.catalog)`,
          });
        }
      }
    }
    for (const conf of project.confs ?? []) {
      const path = join(root, project.path, conf);
      if (!existsSync(path)) continue;
      // oxlint-disable-next-line no-await-in-loop -- violations are appended in registry order, so the report keeps a stable order
      const text = await readFile(path, "utf8");
      const tag = schemaTag(text);
      if (tauri && tag !== tauri) {
        violations.push({
          code: "schema-drift",
          subject: `${project.path}/${conf}`,
          detail: `$schema tag is ${tag ?? "missing"}, pinned tauri is ${tauri} (run with --fix)`,
        });
      }
      const stale = LEGACY_SIBLING.exec(text)?.[0];
      if (stale) {
        violations.push({
          code: "legacy-sibling",
          subject: `${project.path}/${conf}`,
          detail: `references the legacy sibling checkout \`${stale}\``,
        });
      }
      if (conf === "tauri.conf.json") {
        try {
          const dist = (
            JSON.parse(text) as { build?: { frontendDist?: unknown } }
          ).build?.frontendDist;
          if (
            typeof dist === "string" &&
            !/^https?:/.test(dist) &&
            !existsSync(resolve(root, project.path, dist))
          ) {
            warnings.push({
              code: "frontend-missing",
              subject: `${project.path}/${conf}`,
              detail: `frontendDist ${dist} is not built here (generated by the frontend build)`,
            });
          }
        } catch {
          violations.push({
            code: "invalid-conf",
            subject: `${project.path}/${conf}`,
            detail: "not valid JSON",
          });
        }
      }
    }
  }
  return { tauri, rows, violations, warnings };
}

export function renderAudit(report: AuditReport): string {
  const width = Math.max(10, ...report.rows.map((row) => row.dir.length));
  const lines = [
    `Tauri projects (pinned tauri ${report.tauri ?? "?"}): ${report.rows.length} discovered`,
    ...report.rows.map(
      (row) =>
        `  ${row.dir.padEnd(width)}  ${(row.id ?? "UNREGISTERED").padEnd(26)} ${(row.kind ?? "-").padEnd(11)} ${row.workspace.padEnd(8)} ${row.git.padEnd(9)} ${row.via.join("+")}`,
    ),
  ];
  for (const [label, list] of [
    ["violations", report.violations],
    ["warnings", report.warnings],
  ] as const) {
    if (list.length > 0) {
      lines.push("", `${label} (${list.length})`);
      for (const item of list)
        lines.push(`  [${item.code}] ${item.subject}: ${item.detail}`);
    }
  }
  if (report.violations.length === 0)
    lines.push("", "registry matches the tree: no violation");
  return lines.join("\n");
}

export type Args = {
  root: string;
  check: boolean;
  fix: boolean;
  json: boolean;
};

export function parseArgs(argv: string[], cwd = process.cwd()): Args {
  const args: Args = { root: cwd, check: false, fix: false, json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--root") args.root = resolve(argv[++index] ?? "");
    else if (arg === "--check") args.check = true;
    else if (arg === "--fix") args.fix = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") throw new Error("help");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.fix && args.check)
    throw new Error("--fix and --check are mutually exclusive");
  return args;
}

export async function runTauriApps(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      "Usage: yolo ops tauri-apps [--root <repo>] [--check] [--fix] [--json]",
    );
    return message === "help" ? 0 : (console.error(message), 2);
  }
  const registry = parseRegistry(
    await readFile(join(args.root, "tools/config/tauri-apps.json"), "utf8"),
  );
  if (args.fix) {
    const version = pinnedTauriVersion(
      await readFile(join(args.root, "Cargo.toml"), "utf8"),
    );
    if (!version)
      throw new Error("root Cargo.toml has no pinned tauri version");
    for (const file of await fixConfSchemas(args.root, registry, version))
      console.log(`[tauri-apps] $schema updated: ${file}`);
  }
  const report = await audit(args.root, registry);
  console.log(
    args.json ? JSON.stringify(report, null, 2) : renderAudit(report),
  );
  return args.check && report.violations.length > 0 ? 1 : 0;
}

if (import.meta.main) process.exit(await runTauriApps(process.argv.slice(2)));
