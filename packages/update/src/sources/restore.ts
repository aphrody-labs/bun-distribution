// SPDX-License-Identifier: Apache-2.0
/**
 * Upstream source checkouts kept outside the repository.
 *
 * Reads `tools/config/upstream-sources.json` and reports, verifies or (with
 * `--apply`) restores every listed checkout under the source root: git clones
 * at their pinned commit, crates.io archives, and the local patches applied on
 * top. `aphrody git source` reads the same manifest natively.
 *
 * Usage: yolo ops upstream-sources [status|sync|verify] [--root <repo>]
 *        [--source-root <dir>] [--only <id>] [--apply] [--json]
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export type Patch = {
  id: string;
  file: string;
  strip: number;
  marker: { file: string; contains: string };
};

export type Source = {
  id: string;
  kind: "git" | "crate";
  role: "dependency" | "reference";
  pinned: boolean;
  url?: string;
  ref?: string;
  commit?: string;
  sparse?: string[];
  crate?: string;
  version?: string;
  cargoPathDep?: string;
  /** Why this pin must not move (e.g. a consumer requires this exact version); drift and bump skip it. */
  hold?: string;
  patches?: Patch[];
};

/** An upstream that is never cloned by default: read live (`aphrody git upstream`, MCP `upstream_*`) or fetched into the cache. */
export type Reference = {
  id: string;
  kind: "git";
  /** `build`: restored under the source root only for the WSL build; `reference`: read live, cached on demand. */
  tier: "build" | "reference";
  url: string;
  ref?: string;
  /** Last head seen when the entry was written (provenance, not a pin). */
  observedCommit?: string;
  sparse?: string[];
  license?: string;
  purpose: string;
  consumers: string;
  note?: string;
};

export type IntegratedSource = Source & { integratedPath: string };
export type Manifest = {
  schemaVersion: 1;
  root: string;
  sources: Source[];
  reference?: Reference[];
  integrated?: IntegratedSource[];
};

export function parseManifest(text: string): Manifest {
  const raw = JSON.parse(text) as Manifest;
  if (raw.schemaVersion !== 1)
    throw new Error("upstream-sources: schemaVersion must be 1");
  if (typeof raw.root !== "string" || raw.root === "")
    throw new Error("upstream-sources: root");
  const seen = new Set<string>();
  for (const ref of raw.reference ?? []) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref.id))
      throw new Error(`upstream-sources: invalid reference id ${ref.id}`);
    if (seen.has(ref.id))
      throw new Error(`upstream-sources: duplicate id ${ref.id}`);
    seen.add(ref.id);
    if (ref.kind !== "git" || !ref.url)
      throw new Error(`${ref.id}: reference needs kind git and url`);
    if (ref.tier !== "build" && ref.tier !== "reference")
      throw new Error(`${ref.id}: tier must be build or reference`);
    if (
      ref.observedCommit !== undefined &&
      !/^[0-9a-f]{40}$/.test(ref.observedCommit)
    ) {
      throw new Error(`${ref.id}: observedCommit must be a 40-hex SHA`);
    }
    if (!ref.purpose || !ref.consumers)
      throw new Error(`${ref.id}: purpose and consumers are required`);
  }
  for (const source of raw.integrated ?? []) {
    if (
      !source.integratedPath?.startsWith("crates/") ||
      source.integratedPath.split("/").includes("..")
    )
      throw new Error(`${source.id}: integratedPath must stay under crates/`);
  }
  for (const source of [...raw.sources, ...(raw.integrated ?? [])]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(source.id)) {
      throw new Error(`upstream-sources: invalid id ${source.id}`);
    }
    if (seen.has(source.id))
      throw new Error(`upstream-sources: duplicate id ${source.id}`);
    seen.add(source.id);
    if (source.kind === "git") {
      if (!source.url) throw new Error(`${source.id}: git source needs url`);
      if (
        source.commit !== undefined &&
        !/^[0-9a-f]{40}$/.test(source.commit)
      ) {
        throw new Error(`${source.id}: commit must be a 40-hex SHA`);
      }
      if (source.pinned && !source.commit)
        throw new Error(`${source.id}: pinned needs commit`);
    } else if (source.kind === "crate") {
      if (!source.crate || !source.version)
        throw new Error(`${source.id}: crate needs version`);
    } else {
      throw new Error(`${source.id}: unknown kind`);
    }
    for (const patch of source.patches ?? []) {
      if (isAbsolute(patch.file) || patch.file.includes("..")) {
        throw new Error(
          `${source.id}: patch ${patch.id} must be repo-relative`,
        );
      }
      if (!Number.isInteger(patch.strip) || patch.strip < 0) {
        throw new Error(`${source.id}: patch ${patch.id} strip`);
      }
    }
  }
  return raw;
}

export function resolveSourceRoot(
  repo: string,
  manifest: Manifest,
  override?: string,
): string {
  const chosen = override ?? process.env.APHRODY_SOURCE_ROOT ?? manifest.root;
  const expanded =
    chosen === "~" || chosen.startsWith("~/")
      ? join(homedir(), chosen.slice(1))
      : chosen;
  return resolve(repo, expanded);
}

/** Path of a Cargo path dependency as written in the root Cargo.toml (forward slashes). */
export function cargoPathFor(
  repo: string,
  root: string,
  source: Source,
): string | undefined {
  if (source.cargoPathDep === undefined) return undefined;
  const base = relative(repo, join(root, source.id, source.cargoPathDep));
  return base.split(sep).join("/");
}

export type State =
  "ok" | "missing" | "drift" | "dirty" | "patch-missing" | "tracked";

export type Row = {
  id: string;
  state: State;
  detail: string;
  head?: string;
  patches: Record<string, boolean>;
};

async function run(
  cmd: string[],
  cwd?: string,
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(cmd, {
    windowsHide: true,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: out.trim(), err: err.trim() };
}

async function patchState(dir: string, patch: Patch): Promise<boolean> {
  const file = join(dir, patch.marker.file);
  if (!existsSync(file)) return false;
  return (await readFile(file, "utf8")).includes(patch.marker.contains);
}

export async function inspect(root: string, source: Source): Promise<Row> {
  const dir = join(root, source.id);
  const patches: Record<string, boolean> = {};
  if (!existsSync(dir))
    return { id: source.id, state: "missing", detail: dir, patches };
  // Lectures seules et indépendantes : l'état de chaque patch est lu en parallèle, dans l'ordre déclaré.
  const states = await Promise.all(
    (source.patches ?? []).map(
      async (patch) => [patch.id, await patchState(dir, patch)] as const,
    ),
  );
  for (const [id, applied] of states) patches[id] = applied;
  const unapplied = Object.entries(patches)
    .filter(([, applied]) => !applied)
    .map(([id]) => id);
  let head: string | undefined;
  if (source.kind === "git") {
    const rev = await run(["git", "rev-parse", "HEAD"], dir);
    if (rev.code !== 0)
      return {
        id: source.id,
        state: "drift",
        detail: "not a git checkout",
        patches,
      };
    head = rev.out;
    if (source.pinned && head !== source.commit) {
      return {
        id: source.id,
        state: "drift",
        detail: `HEAD ${head.slice(0, 8)} != pin ${source.commit?.slice(0, 8)}`,
        head,
        patches,
      };
    }
    if (!source.patches?.length) {
      const dirty = await run(["git", "status", "--porcelain"], dir);
      if (dirty.out !== "")
        return {
          id: source.id,
          state: "dirty",
          detail: `${dirty.out.split("\n").length} changed paths`,
          head,
          patches,
        };
    }
  }
  if (unapplied.length > 0) {
    return {
      id: source.id,
      state: "patch-missing",
      detail: unapplied.join(", "),
      head,
      patches,
    };
  }
  return {
    id: source.id,
    state: source.pinned ? "ok" : "tracked",
    detail: head?.slice(0, 8) ?? source.version ?? "",
    head,
    patches,
  };
}

async function fetchCrate(source: Source, dir: string): Promise<void> {
  const { crate, version } = source;
  const url = `https://static.crates.io/crates/${crate}/${crate}-${version}.crate`;
  const response = await fetch(url, {
    headers: { "User-Agent": "aphrody-upstream-sources" },
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const tmp = await mkdtemp(join(tmpdir(), "aphrody-crate-"));
  try {
    const archive = join(tmp, "crate.tgz");
    await Bun.write(archive, response);
    await mkdir(dir, { recursive: true });
    const untar = await run([
      "tar",
      "xzf",
      archive,
      "--strip-components=1",
      "-C",
      dir,
    ]);
    if (untar.code !== 0) throw new Error(`tar: ${untar.err}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function cloneGit(source: Source, dir: string): Promise<void> {
  const clone = [
    "git",
    "clone",
    "--quiet",
    "--filter=blob:none",
    "--no-checkout",
    source.url!,
    dir,
  ];
  const cloned = await run(clone);
  if (cloned.code !== 0) throw new Error(`git clone: ${cloned.err}`);
  if (source.sparse?.length) {
    const sparse = await run(
      ["git", "sparse-checkout", "set", "--cone", ...source.sparse],
      dir,
    );
    if (sparse.code !== 0) throw new Error(`sparse-checkout: ${sparse.err}`);
  }
  const target = source.pinned
    ? source.commit!
    : (source.commit ?? source.ref ?? "HEAD");
  const checkout = await run(
    ["git", "checkout", "--quiet", "--detach", target],
    dir,
  );
  if (checkout.code !== 0) throw new Error(`git checkout: ${checkout.err}`);
}

async function applyPatches(
  repo: string,
  dir: string,
  source: Source,
): Promise<string[]> {
  const applied: string[] = [];
  // oxlint-disable no-await-in-loop -- patchs appliqués dans l'ordre déclaré : chacun dépend de l'état laissé par le précédent, et une erreur arrête la suite
  for (const patch of source.patches ?? []) {
    if (await patchState(dir, patch)) continue;
    const args = [
      "patch",
      `-p${patch.strip}`,
      "-s",
      "-d",
      dir,
      "-i",
      join(repo, patch.file),
    ];
    const dry = await run([...args, "--dry-run"]);
    if (dry.code !== 0)
      throw new Error(
        `patch ${patch.id} does not apply: ${dry.out || dry.err}`,
      );
    const real = await run(args);
    if (real.code !== 0)
      throw new Error(`patch ${patch.id}: ${real.out || real.err}`);
    applied.push(patch.id);
  }
  // oxlint-enable no-await-in-loop
  return applied;
}

/** Restores one source: clone/extract when missing, then apply missing patches. Never touches an existing checkout's history. */
export async function syncSource(
  repo: string,
  root: string,
  source: Source,
): Promise<string> {
  const dir = join(root, source.id);
  const actions: string[] = [];
  if (!existsSync(dir)) {
    await mkdir(root, { recursive: true });
    if (source.kind === "crate") await fetchCrate(source, dir);
    else await cloneGit(source, dir);
    actions.push(source.kind === "crate" ? "extracted" : "cloned");
  }
  const patched = await applyPatches(repo, dir, source);
  if (patched.length) actions.push(`patched ${patched.join(",")}`);
  return actions.length ? actions.join("; ") : "unchanged";
}

/** Cargo path dependencies in the root Cargo.toml must match the manifest layout. */
export function cargoProblems(
  cargoToml: string,
  repo: string,
  root: string,
  manifest: Manifest,
): string[] {
  const problems: string[] = [];
  for (const source of manifest.sources) {
    const expected = cargoPathFor(repo, root, source);
    if (expected === undefined) continue;
    if (!cargoToml.includes(`path = "${expected}"`)) {
      problems.push(
        `Cargo.toml: no path dependency "${expected}" for ${source.id}`,
      );
    }
  }
  for (const source of manifest.integrated ?? []) {
    if (!cargoToml.includes(`path = "${source.integratedPath}"`))
      problems.push(
        `Cargo.toml: no integrated path dependency "${source.integratedPath}" for ${source.id}`,
      );
  }
  if (
    /path\s*=\s*"upstream\/(mcp-server-tauri|simdutf-rio|tauri-plugin-dialog|tauri-driver|tauri-plugin-webdriver|victauri)/.test(
      cargoToml,
    )
  ) {
    problems.push(
      "Cargo.toml: path dependency still points at a moved upstream/ tree",
    );
  }
  return problems;
}

type Args = {
  repo: string;
  action: "status" | "sync" | "verify";
  apply: boolean;
  json: boolean;
  only?: string;
  sourceRoot?: string;
};

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    repo: process.cwd(),
    action: "status",
    apply: false,
    json: false,
  };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith("-")) {
    const action = rest.shift();
    if (action !== "status" && action !== "sync" && action !== "verify")
      throw new Error(`unknown action ${action}`);
    args.action = action;
  }
  while (rest.length) {
    const flag = rest.shift()!;
    if (flag === "--apply") args.apply = true;
    else if (flag === "--json") args.json = true;
    else if (flag === "--root") args.repo = resolve(rest.shift() ?? ".");
    else if (flag === "--source-root") args.sourceRoot = rest.shift();
    else if (flag === "--only") args.only = rest.shift();
    else if (flag === "--help" || flag === "-h") throw new Error("help");
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

export async function runUpstreamSources(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      "Usage: yolo ops upstream-sources [status|sync|verify] [--root <repo>] [--source-root <dir>] [--only <id>] [--apply] [--json]",
    );
    return message === "help" ? 0 : (console.error(message), 2);
  }
  const manifest = parseManifest(
    await readFile(
      join(args.repo, "tools/config/upstream-sources.json"),
      "utf8",
    ),
  );
  const root = resolveSourceRoot(args.repo, manifest, args.sourceRoot);
  // A build-tier reference (WSL build inputs) is restored only when named explicitly.
  const onDemand: Source[] = (manifest.reference ?? [])
    .filter((ref) => ref.tier === "build" && ref.id === args.only)
    .map((ref) => ({
      id: ref.id,
      kind: "git",
      role: "reference",
      pinned: false,
      url: ref.url,
      ref: ref.ref,
      commit: ref.observedCommit,
      sparse: ref.sparse,
    }));
  const sources = [...manifest.sources, ...onDemand].filter(
    (source) => !args.only || source.id === args.only,
  );
  const integrated = (manifest.integrated ?? []).filter(
    (source) => !args.only || source.id === args.only,
  );
  if (args.only && sources.length === 0 && integrated.length === 0)
    return (console.error(`unknown source ${args.only}`), 2);

  const actions: Record<string, string> = {};
  if (args.action === "sync") {
    for (const source of sources) {
      const planned = existsSync(join(root, source.id))
        ? "present"
        : source.kind === "crate"
          ? "would extract"
          : "would clone";
      actions[source.id] = args.apply
        ? // oxlint-disable-next-line no-await-in-loop -- sources synchronisées une à une : clones et extractions git partagent le même répertoire racine
          await syncSource(args.repo, root, source).catch(
            (error: Error) => `FAILED: ${error.message}`,
          )
        : planned;
    }
  }
  const rows = await Promise.all([
    ...sources.map((source) => inspect(root, source)),
    ...integrated.map(async (source) => {
      const dir = join(args.repo, source.integratedPath);
      const row = await inspect(dirname(dir), { ...source, id: basename(dir) });
      return Object.assign(row, {
        id: source.id,
        detail: `${source.integratedPath} ${row.detail}`,
      });
    }),
  ]);
  const problems =
    args.action === "status"
      ? []
      : cargoProblems(
          await readFile(join(args.repo, "Cargo.toml"), "utf8"),
          args.repo,
          root,
          manifest,
        );
  const known = new Set(manifest.sources.map((source) => source.id));
  const unmanaged = existsSync(root)
    ? (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !known.has(entry.name))
        .map((entry) => entry.name)
    : [];
  const bad = rows.filter(
    (row) => row.state !== "ok" && row.state !== "tracked",
  );
  const failed = Object.values(actions).some((value) =>
    value.startsWith("FAILED"),
  );
  if (args.json) {
    console.log(
      JSON.stringify({ root, rows, actions, problems, unmanaged }, null, 2),
    );
  } else {
    console.log(`source root: ${root}`);
    for (const row of rows)
      console.log(
        `${row.state.padEnd(13)} ${row.id.padEnd(24)} ${row.detail}${actions[row.id] ? `  [${actions[row.id]}]` : ""}`,
      );
    if (unmanaged.length)
      console.log(
        `not vital (remove with \`yolo update upstream prune --apply\`): ${unmanaged.join(", ")}`,
      );
    for (const problem of problems) console.log(`problem: ${problem}`);
    if (args.action === "sync" && !args.apply)
      console.log("plan only; pass --apply to clone, extract and patch");
  }
  if (args.action === "status") return 0;
  return bad.length > 0 || problems.length > 0 || failed ? 1 : 0;
}

if (import.meta.main)
  process.exit(await runUpstreamSources(process.argv.slice(2)));
