#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// forks.ts: the one tool for every submodule of this repository (`forks/*` and `packages/nie-ui`).
// `.gitmodules` is the only registry. Beyond the git-native keys (`path`, `url`, `branch`, `shallow`)
// it carries four keys this tool reads and git ignores:
//   upstream         URL of the original project the fork tracks
//   upstream-branch  branch of the original project (default: its HEAD)
//   sparse           space-separated cone paths to check out (default: everything)
//   sparse-script    a script (path relative to the repository) that owns the fork's sparse set; `sparse` and
//                    `sync` delegate to `bun <script>` and never run `sparse-checkout` themselves for that fork
//                    (a cone of a huge tree, like the 2.1M-file Material Symbols repository, hangs git)
//
//   bun scripts/forks.ts list   [--json]
//   bun scripts/forks.ts status [name..] [--remote] [--json]
//   bun scripts/forks.ts sync   <name..|all> [--strategy ff|merge|rebase] [--stage] [--push] [--apply]
//   bun scripts/forks.ts pin    <name> <ref> [--apply]
//   bun scripts/forks.ts sparse <name..|all> [path..] [--apply] [--check]
//
// Every command that changes anything is a plan unless `--apply` is given. Nothing commits, nothing
// force-pushes, nothing clones an upstream for research: `status --remote` and `pin` resolve refs with
// `git ls-remote`. `sync` fetches the upstream branch into the already initialised fork.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const REPO = resolve(dirname(import.meta.path), "..");

export interface Fork {
  name: string;
  path: string;
  url: string;
  /** Branch of the fork that mirrors upstream (git-native `branch`). */
  branch?: string;
  upstream?: string;
  upstreamBranch?: string;
  sparse: string[];
  /** Script that owns the sparse set (repository-relative); `sparse` is then empty. */
  sparseScript?: string;
  shallow: boolean;
}

/** Parse the `[submodule "<name>"]` sections of a `.gitmodules` file, in file order. */
export function parseGitmodules(text: string): Fork[] {
  const forks: Fork[] = [];
  let current: (Partial<Fork> & { name: string }) | undefined;
  const flush = () => {
    if (!current) return;
    if (!current.path || !current.url)
      throw new Error(
        `.gitmodules: submodule "${current.name}" needs path and url`,
      );
    forks.push({
      name: current.name,
      path: current.path,
      url: current.url,
      ...(current.branch ? { branch: current.branch } : {}),
      ...(current.upstream ? { upstream: current.upstream } : {}),
      ...(current.upstreamBranch
        ? { upstreamBranch: current.upstreamBranch }
        : {}),
      ...(current.sparseScript ? { sparseScript: current.sparseScript } : {}),
      sparse: current.sparse ?? [],
      shallow: current.shallow ?? false,
    });
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[submodule\s+"([^"]+)"\]$/.exec(line);
    if (section) {
      flush();
      current = { name: section[1]! };
      continue;
    }
    const pair = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/.exec(line);
    if (!pair || !current) continue;
    const key = pair[1]!.toLowerCase();
    const value = pair[2]!.trim();
    if (key === "path") current.path = value;
    else if (key === "url") current.url = value;
    else if (key === "branch") current.branch = value;
    else if (key === "upstream") current.upstream = value;
    else if (key === "upstream-branch") current.upstreamBranch = value;
    else if (key === "sparse")
      current.sparse = value.split(/\s+/).filter(Boolean);
    else if (key === "sparse-script") current.sparseScript = value;
    else if (key === "shallow") current.shallow = value === "true";
  }
  flush();
  return forks;
}

export interface GitResult {
  code: number;
  out: string;
  err: string;
}

/** Run git in `cwd`; never prompts, never throws. */
export function git(cwd: string, ...args: string[]): GitResult {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode ?? 1,
    out: proc.stdout.toString().trim(),
    err: proc.stderr.toString().trim(),
  };
}

export function loadForks(repo: string = REPO): Fork[] {
  const file = join(repo, ".gitmodules");
  if (!existsSync(file)) return [];
  return parseGitmodules(readFileSync(file, "utf8"));
}

/** The commit recorded in the superproject for `path`, or undefined. */
export function pinnedSha(repo: string, path: string): string | undefined {
  const res = git(repo, "ls-tree", "HEAD", "--", path);
  const match = /^160000 commit ([0-9a-f]{40})\t/.exec(res.out);
  return match?.[1];
}

/** Async variant of `git`, for the network calls that run in parallel. */
export async function gitAsync(
  cwd: string,
  ...args: string[]
): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
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

export interface RemoteTip {
  branch?: string;
  sha?: string;
}

/**
 * Tip of `branch` (or of the default branch) on a remote without cloning: one `git ls-remote`.
 * Without `branch` the answer names the default branch from the `HEAD` symref.
 */
export async function remoteTip(
  url: string,
  branch?: string,
  cwd: string = REPO,
): Promise<RemoteTip> {
  const res = await gitAsync(
    cwd,
    "ls-remote",
    "--symref",
    url,
    branch ? `refs/heads/${branch}` : "HEAD",
  );
  if (res.code !== 0 || !res.out) return {};
  const symref = /^ref: refs\/heads\/(\S+)\tHEAD/m.exec(res.out)?.[1];
  const sha = /^([0-9a-f]{40})\t/m.exec(res.out)?.[1];
  const resolved = branch ?? symref;
  return { ...(resolved ? { branch: resolved } : {}), ...(sha ? { sha } : {}) };
}

/** The commit a ref (branch, tag or sha) names on a remote; annotated tags resolve to their commit. */
export async function remoteSha(
  url: string,
  ref: string,
  cwd: string = REPO,
): Promise<string | undefined> {
  for (const name of [ref, `refs/heads/${ref}`, `refs/tags/${ref}`]) {
    // Resolve exact refs before branches and tags; stop at the first successful match.
    // oxlint-disable-next-line no-await-in-loop
    const res = await gitAsync(cwd, "ls-remote", url, name, `${name}^{}`);
    if (res.code !== 0 || !res.out) continue;
    const rows = res.out
      .split("\n")
      .map((l) => l.split("\t") as [string, string]);
    const row = rows.find(([, n]) => n.endsWith("^{}")) ?? rows[0];
    if (row) return row[0];
  }
  return undefined;
}

export interface ForkStatus {
  name: string;
  path: string;
  pinned: string | undefined;
  /** Initialised: `<path>/.git` exists. */
  present: boolean;
  head?: string;
  sparse: boolean;
  dirty: number;
  /** Worktree HEAD differs from the pin. */
  moved: boolean;
  remote?: {
    fork?: string;
    upstream?: string;
    pinIsForkTip?: boolean;
    forkMirrorsUpstream?: boolean;
  };
}

export async function forkStatus(
  repo: string,
  fork: Fork,
  remote = false,
): Promise<ForkStatus> {
  const dir = join(repo, fork.path);
  const pinned = pinnedSha(repo, fork.path);
  const present = existsSync(join(dir, ".git"));
  const status: ForkStatus = {
    name: fork.name,
    path: fork.path,
    pinned,
    present,
    sparse: false,
    dirty: 0,
    moved: false,
  };
  if (present) {
    status.head = git(dir, "rev-parse", "HEAD").out || undefined;
    status.sparse =
      git(dir, "config", "--get", "core.sparseCheckout").out === "true";
    // A sparse or still materialising checkout lists absent files as deleted; only count real edits.
    status.dirty = git(dir, "status", "--porcelain", "--untracked-files=no")
      .out.split("\n")
      .filter((l) => l && !l.startsWith(" D") && !l.startsWith("D ")).length;
    status.moved =
      status.head !== undefined &&
      pinned !== undefined &&
      status.head !== pinned;
  }
  if (remote) {
    const [forkTip, upstreamTip] = await Promise.all([
      remoteTip(fork.url, fork.branch, repo),
      fork.upstream
        ? remoteTip(fork.upstream, fork.upstreamBranch, repo)
        : Promise.resolve<RemoteTip>({}),
    ]);
    status.remote = {
      ...(forkTip.sha ? { fork: forkTip.sha } : {}),
      ...(upstreamTip.sha ? { upstream: upstreamTip.sha } : {}),
      ...(forkTip.sha && pinned
        ? { pinIsForkTip: forkTip.sha === pinned }
        : {}),
      ...(forkTip.sha && upstreamTip.sha
        ? { forkMirrorsUpstream: forkTip.sha === upstreamTip.sha }
        : {}),
    };
  }
  return status;
}

export type Strategy = "ff" | "merge" | "rebase";

export interface Step {
  /** Working directory of the step, relative to the repository. */
  cwd: string;
  argv: string[];
  /** Program (default `git`); `bun` runs the current Bun. */
  bin?: string;
}

const short = (sha: string | undefined) => (sha ? sha.slice(0, 10) : "-");

/** The git steps that bring `fork` to its upstream branch, in order. */
export function planSync(
  fork: Fork,
  options: {
    strategy?: Strategy;
    stage?: boolean;
    push?: boolean;
    pushBranch?: string;
    hasUpstreamRemote?: boolean;
    blobless?: boolean;
  },
): Step[] {
  if (!fork.upstream)
    throw new Error(`${fork.name}: no \`upstream\` in .gitmodules`);
  const branch = fork.upstreamBranch ?? "HEAD";
  const strategy = options.strategy ?? "ff";
  const steps: Step[] = [];
  if (!options.hasUpstreamRemote)
    steps.push({
      cwd: fork.path,
      argv: ["remote", "add", "upstream", fork.upstream],
    });
  // A partial or sparse fork never downloads blobs it does not check out: a fetch from a new remote carries no
  // filter of its own, and for the Material Symbols repository that would be every blob (~5 GB).
  const blobless =
    options.blobless ??
    (fork.sparse.length > 0 || fork.sparseScript !== undefined);
  steps.push({
    cwd: fork.path,
    argv: [
      "fetch",
      ...(fork.shallow ? ["--depth", "1"] : []),
      ...(blobless ? ["--filter=blob:none"] : []),
      "upstream",
      branch,
    ],
  });
  const target = "FETCH_HEAD";
  steps.push({
    cwd: fork.path,
    argv:
      strategy === "ff"
        ? ["merge", "--ff-only", target]
        : strategy === "merge"
          ? ["merge", "--no-edit", target]
          : ["rebase", target],
  });
  // The delegate owns the sparse set: files the new commit adds are materialised by it, not by git here.
  if (fork.sparseScript)
    steps.push({ cwd: ".", bin: "bun", argv: [fork.sparseScript] });
  if (options.push)
    steps.push({
      cwd: fork.path,
      argv: [
        "push",
        "origin",
        `HEAD:${options.pushBranch ?? fork.branch ?? "main"}`,
      ],
    });
  if (options.stage) steps.push({ cwd: ".", argv: ["add", "--", fork.path] });
  return steps;
}

/**
 * Steps to initialise `fork` (shallow, blobless) and restrict it to its sparse cone. A fork with a
 * `sparse-script` is delegated: the plan is that script and nothing else, never a cone and never
 * `sparse-checkout disable`. Such a fork is not initialised here either: a plain submodule checkout of a
 * multi-million-file tree downloads every blob.
 */
export function planSparse(
  fork: Fork,
  paths: string[],
  present: boolean,
  sparseNow = false,
): Step[] {
  if (fork.sparseScript) {
    if (paths.length > 0)
      throw new Error(
        `${fork.name}: its sparse set is owned by ${fork.sparseScript}; it takes no paths`,
      );
    if (!present) {
      throw new Error(
        `${fork.name}: not initialised, and a submodule checkout of it downloads every blob. Initialise it without checking files out ` +
          `(git clone --no-checkout --depth 1 --filter=blob:none <url> ${fork.path} && git submodule absorbgitdirs -- ${fork.path}), then run ${fork.sparseScript}`,
      );
    }
    return [{ cwd: ".", bin: "bun", argv: [fork.sparseScript] }];
  }
  const cone = paths.length > 0 ? paths : fork.sparse;
  const steps: Step[] = [];
  if (!present) {
    steps.push({
      cwd: ".",
      argv: [
        "submodule",
        "update",
        "--init",
        ...(fork.shallow || cone.length > 0 ? ["--depth", "1"] : []),
        ...(cone.length > 0 ? ["--filter=blob:none"] : []),
        "--",
        fork.path,
      ],
    });
  }
  if (cone.length > 0)
    steps.push({
      cwd: fork.path,
      argv: ["sparse-checkout", "set", "--cone", ...cone],
    });
  else if (present && sparseNow)
    steps.push({ cwd: fork.path, argv: ["sparse-checkout", "disable"] });
  return steps;
}

const render = (steps: Step[]) =>
  steps
    .map((s) => `  (${s.cwd}) ${s.bin ?? "git"} ${s.argv.join(" ")}`)
    .join("\n");

/** Run a program in `cwd`; `bun` is the running Bun. Never prompts, never throws. */
function exec(cwd: string, bin: string, args: string[]): GitResult {
  if (bin === "git") return git(cwd, ...args);
  const proc = Bun.spawnSync(
    [bin === "bun" ? process.execPath : bin, ...args],
    {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return {
    code: proc.exitCode ?? 1,
    out: proc.stdout.toString().trim(),
    err: proc.stderr.toString().trim(),
  };
}

function runSteps(repo: string, steps: Step[]): GitResult | undefined {
  for (const step of steps) {
    const res = exec(join(repo, step.cwd), step.bin ?? "git", step.argv);
    if (res.code !== 0)
      return {
        ...res,
        err: `${step.bin ?? "git"} ${step.argv.join(" ")}: ${res.err || res.out}`,
      };
  }
  return undefined;
}

/** `sparse --check`: a delegated fork is verified by its script (`--check`), a plain one by its cone. */
function checkSparse(
  repo: string,
  fork: Fork,
): { ok: boolean; message: string } {
  if (fork.sparseScript) {
    const res = exec(repo, "bun", [fork.sparseScript, "--check"]);
    return {
      ok: res.code === 0,
      message: `${fork.sparseScript} --check failed${res.err ? `: ${res.err}` : res.out ? `: ${res.out}` : ""}`,
    };
  }
  if (fork.sparse.length === 0) return { ok: true, message: "" };
  const dir = join(repo, fork.path);
  const listed = new Set(
    git(dir, "sparse-checkout", "list").out.split("\n").filter(Boolean),
  );
  const missing = fork.sparse.filter((p) => !listed.has(p));
  return {
    ok: missing.length === 0,
    message: `sparse set lacks ${missing.join(", ")}`,
  };
}

const USAGE = `forks.ts: submodule and fork management driven by .gitmodules

  list   [--json]                                         every submodule, its pin, state and upstream
  status [name..] [--remote] [--json]                     worktree vs pin; --remote compares fork and upstream tips (ls-remote)
  sync   <name..|all> [--strategy ff|merge|rebase] [--stage] [--push] [--apply]
                                                          fetch upstream into the fork and move the mirror branch
  pin    <name> <ref> [--apply]                           record <ref> (sha, tag or branch of the fork) as the superproject pin
  sparse <name..|all> [path..] [--apply] [--check]        shallow-init a fork and check out only its cone (.gitmodules \`sparse\`);
                                                          a fork with \`sparse-script\` runs that script instead; --check only verifies

Every change is a plan unless --apply is given. Nothing commits or force-pushes.`;

interface Parsed {
  command: string;
  positionals: string[];
  flags: Map<string, string | true>;
}

export function parseArgv(argv: string[]): Parsed {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "strategy") flags.set(key, rest[++i] ?? "");
    else flags.set(key, true);
  }
  return { command, positionals, flags };
}

/** A submodule by name, path or last path segment (`tailwindcss` for `packages/tailwindcss`). */
export function findFork(forks: Fork[], name: string): Fork | undefined {
  return forks.find(
    (f) => f.name === name || f.path === name || f.path.endsWith(`/${name}`),
  );
}

function select(forks: Fork[], names: string[]): Fork[] {
  if (names.length === 0 || names.includes("all")) return forks;
  return names.map((name) => {
    const fork = findFork(forks, name);
    if (!fork)
      throw new Error(
        `unknown submodule "${name}" (known: ${forks.map((f) => f.name).join(", ")})`,
      );
    return fork;
  });
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, c) =>
    Math.max(...rows.map((r) => r[c]!.length)),
  );
  return rows
    .map((r) =>
      r
        .map((cell, c) => cell.padEnd(widths[c]!))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/** Run the CLI; returns the exit code. */
export async function main(
  argv: string[],
  repo: string = REPO,
  out: (line: string) => void = console.log,
): Promise<number> {
  const { command, positionals, flags } = parseArgv(argv);
  const apply = flags.has("apply");
  const json = flags.has("json");
  const forks = loadForks(repo);
  switch (command) {
    case "list": {
      const rows = (
        await Promise.all(forks.map((f) => forkStatus(repo, f)))
      ).map((s, i) =>
        Object.assign({}, forks[i]!, {
          pinned: s.pinned,
          present: s.present,
          sparse: s.sparse,
        }),
      );
      if (json) out(JSON.stringify(rows, null, 2));
      else
        out(
          table([
            ["name", "path", "pin", "state", "upstream"],
            ...rows.map((r) => [
              r.name,
              r.path,
              short(r.pinned),
              r.present ? (r.sparse ? "sparse" : "present") : "absent",
              r.upstream ?? "-",
            ]),
          ]),
        );
      return 0;
    }
    case "status": {
      const selected = select(forks, positionals);
      const rows = await Promise.all(
        selected.map((f) => forkStatus(repo, f, flags.has("remote"))),
      );
      if (json) {
        out(JSON.stringify(rows, null, 2));
        return 0;
      }
      out(
        table([
          [
            "name",
            "pin",
            "head",
            "state",
            "dirty",
            ...(flags.has("remote")
              ? ["fork tip", "upstream tip", "mirrors"]
              : []),
          ],
          ...rows.map((s) =>
            [
              s.name,
              short(s.pinned),
              short(s.head),
              !s.present ? "absent" : s.moved ? "moved" : "pinned",
              String(s.dirty),
            ].concat(
              s.remote
                ? [
                    short(s.remote.fork),
                    short(s.remote.upstream),
                    s.remote.forkMirrorsUpstream === undefined
                      ? "?"
                      : s.remote.forkMirrorsUpstream
                        ? "yes"
                        : "no",
                  ]
                : [],
            ),
          ),
        ]),
      );
      return 0;
    }
    case "sync": {
      if (positionals.length === 0)
        throw new Error("sync: name a submodule or `all`");
      const strategy = (flags.get("strategy") as Strategy | undefined) ?? "ff";
      if (!["ff", "merge", "rebase"].includes(strategy))
        throw new Error(`--strategy must be ff, merge or rebase`);
      let code = 0;
      for (const fork of select(forks, positionals).filter(
        (f) => !positionals.includes("all") || f.upstream,
      )) {
        const dir = join(repo, fork.path);
        if (!existsSync(join(dir, ".git")))
          throw new Error(
            `${fork.name}: not initialised; run \`forks.ts sparse ${fork.name} --apply\` first`,
          );
        // Complete each fork sync and its optional push before changing the next owned Git checkout.
        const pushBranch = flags.has("push")
          ? // oxlint-disable-next-line no-await-in-loop
            (fork.branch ?? (await remoteTip(fork.url, undefined, repo)).branch)
          : undefined;
        const steps = planSync(fork, {
          strategy,
          stage: flags.has("stage"),
          push: flags.has("push"),
          ...(pushBranch ? { pushBranch } : {}),
          hasUpstreamRemote: git(dir, "remote")
            .out.split("\n")
            .includes("upstream"),
          blobless:
            fork.sparse.length > 0 ||
            fork.sparseScript !== undefined ||
            git(dir, "config", "--get", "remote.origin.promisor").out ===
              "true" ||
            git(dir, "config", "--get", "core.sparseCheckout").out === "true",
        });
        out(
          `${fork.name}: ${apply ? "sync" : "plan"} to ${fork.upstream} (${strategy})\n${render(steps)}`,
        );
        if (!apply) continue;
        const failure = runSteps(
          repo,
          steps.filter((s) => s.argv[0] !== "push" && s.argv[0] !== "add"),
        );
        if (failure) {
          out(`${fork.name}: ${failure.err}`);
          code = 1;
          continue;
        }
        if (pushBranch) {
          // The push is a fast-forward of the fork's own branch, never forced.
          git(dir, "fetch", "origin", pushBranch);
          if (
            git(dir, "merge-base", "--is-ancestor", "FETCH_HEAD", "HEAD")
              .code !== 0
          ) {
            out(
              `${fork.name}: origin/${pushBranch} is not an ancestor of HEAD; not pushing`,
            );
            code = 1;
            continue;
          }
          const pushed = git(dir, "push", "origin", `HEAD:${pushBranch}`);
          if (pushed.code !== 0) {
            out(`${fork.name}: push failed: ${pushed.err}`);
            code = 1;
            continue;
          }
        }
        if (flags.has("stage")) git(repo, "add", "--", fork.path);
        out(
          `${fork.name}: now at ${short(git(dir, "rev-parse", "HEAD").out)}${flags.has("stage") ? " (pointer staged, not committed)" : ""}`,
        );
      }
      return code;
    }
    case "pin": {
      const [name, ref] = positionals;
      if (!name || !ref) throw new Error("pin: <name> <ref>");
      const [fork] = select(forks, [name]);
      const dir = join(repo, fork!.path);
      const present = existsSync(join(dir, ".git"));
      let sha: string | undefined;
      if (/^[0-9a-f]{40}$/.test(ref)) sha = ref;
      else if (present)
        sha =
          git(dir, "rev-parse", "--verify", `${ref}^{commit}`).out || undefined;
      sha ??= await remoteSha(fork!.url, ref, repo);
      if (!sha)
        throw new Error(
          `${fork!.name}: cannot resolve "${ref}" in ${present ? "the checkout or " : ""}${fork!.url}`,
        );
      const current = pinnedSha(repo, fork!.path);
      out(
        `${fork!.name}: pin ${short(current)} -> ${short(sha)}${apply ? "" : " (plan; --apply records it)"}`,
      );
      if (!apply) return 0;
      if (present) {
        const checkout = git(dir, "checkout", "--detach", sha);
        if (checkout.code !== 0) {
          const fetched = git(dir, "fetch", "origin", sha);
          const retry =
            fetched.code === 0
              ? git(dir, "checkout", "--detach", sha)
              : fetched;
          if (retry.code !== 0)
            throw new Error(
              `${fork!.name}: cannot check out ${sha}: ${retry.err}`,
            );
        }
        const add = git(repo, "add", "--", fork!.path);
        if (add.code !== 0) throw new Error(add.err);
      } else {
        // Not initialised: write the gitlink directly, no clone needed.
        const res = git(
          repo,
          "update-index",
          "--add",
          "--cacheinfo",
          `160000,${sha},${fork!.path}`,
        );
        if (res.code !== 0) throw new Error(res.err);
      }
      out(`${fork!.name}: pin staged (not committed)`);
      return 0;
    }
    case "sparse": {
      const names = positionals.filter(
        (p) => p === "all" || findFork(forks, p),
      );
      const paths = positionals.filter((p) => !names.includes(p));
      if (names.length === 0)
        throw new Error("sparse: name a submodule or `all`");
      let code = 0;
      for (const fork of select(forks, names)) {
        const present = existsSync(join(repo, fork.path, ".git"));
        if (flags.has("check")) {
          // Read-only: runs at once. A delegated fork asks its script; a plain one compares the cone.
          const verdict = present
            ? checkSparse(repo, fork)
            : { ok: false, message: "absent" };
          out(`${fork.name}: ${verdict.ok ? "ok" : verdict.message}`);
          if (!verdict.ok) code = 1;
          continue;
        }
        let steps: Step[];
        try {
          steps = planSparse(
            fork,
            paths,
            present,
            present &&
              git(
                join(repo, fork.path),
                "config",
                "--get",
                "core.sparseCheckout",
              ).out === "true",
          );
        } catch (error) {
          out(`${fork.name}: ${(error as Error).message}`);
          code = 1;
          continue;
        }
        out(
          `${fork.name}: ${apply ? "init" : "plan"}${steps.length === 0 ? " (nothing to do)" : `\n${render(steps)}`}`,
        );
        if (!apply) continue;
        const failure = runSteps(repo, steps);
        if (failure) {
          out(`${fork.name}: ${failure.err}`);
          code = 1;
        }
      }
      return code;
    }
    case "help":
    case "--help":
    case "-h":
      out(USAGE);
      return 0;
    default:
      out(`unknown command "${command}"\n\n${USAGE}`);
      return 2;
  }
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    console.error(`forks.ts: ${(error as Error).message}`);
    process.exit(2);
  }
}
