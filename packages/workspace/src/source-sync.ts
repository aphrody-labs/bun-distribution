// SPDX-License-Identifier: Apache-2.0
/** Canonical committed-history synchronization; never stage, commit or rewrite source. */
/* oxlint-disable no-await-in-loop -- Git mutations and watcher lifecycle remain deliberately serialized. */
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface SyncRepository {
  id: string;
  repositoryName?: string;
  path: string;
  remote: string;
  sourceBranch: string;
  destinationBranch: string;
  fastForward?: boolean;
  buildCommand?: string[];
  buildEnabled?: boolean;
}
export interface SourceSyncConfig {
  schemaVersion: 1;
  owners: string[];
  repositories: SyncRepository[];
  pollIntervalMs: number;
  debounceMs: number;
  commandTimeoutMs: number;
}
export interface SyncOptions {
  apply?: boolean;
  push?: boolean;
  signal?: AbortSignal;
  /** Explicit embedding policy; the CLI always verifies configured private owner remotes. */
  remoteValidator?: (url: string, repository: SyncRepository) => boolean;
}
export interface SyncRow {
  repo: string;
  sourceBranch: string;
  destinationBranch: string;
  remote: string;
  sourceHead?: string;
  destinationHead?: string;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  status: string;
  action: string;
}
export interface SyncReport {
  schemaVersion: 3;
  at: string;
  mode: "plan" | "apply";
  rows: SyncRow[];
}
type GitResult = { code: number; stdout: string };
const sourceRoot = resolve(import.meta.dir, "../../../docs/aphrody");

async function git(
  repo: string,
  args: string[],
  timeout: number,
  signal?: AbortSignal,
): Promise<GitResult> {
  if (signal?.aborted) throw new Error("Source synchronization aborted");
  const ownsGroup = process.platform !== "win32";
  const child = Bun.spawn(["git", ...args], {
    windowsHide: true,
    cwd: repo,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    detached: ownsGroup,
  });
  const terminate = (kind: "SIGTERM" | "SIGKILL") => {
    try {
      if (ownsGroup) process.kill(-child.pid, kind);
      else child.kill(kind);
    } catch {
      /* The owned group or direct Windows child may already have exited. */
    }
  };
  let cancellation: Promise<void> | undefined;
  const abort = () => {
    if (cancellation) return;
    terminate("SIGTERM");
    cancellation = new Promise<void>((resolveCancellation) => {
      setTimeout(() => {
        terminate("SIGKILL");
        resolveCancellation();
      }, 1000);
    });
  };
  const timer = setTimeout(abort, timeout);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const [stdout, code] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    return { code, stdout: stdout.trim() };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    // The same group owns Git helpers; wait through escalation even if the leader exits first.
    await cancellation;
  }
}
function must(result: GitResult, label: string): string {
  if (result.code !== 0)
    throw new Error(`${label} failed (exit ${result.code})`);
  return result.stdout;
}
function ownerRemote(
  url: string,
  owners: string[],
  repository: SyncRepository,
): boolean {
  const match =
    /^(?:https:\/\/github\.com\/|git@(?:github\.com|github-dev):)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/u.exec(
      url,
    );
  return (
    !!match &&
    owners.includes(match[1]!) &&
    match[2] === (repository.repositoryName ?? repository.id)
  );
}
export async function loadSourceSyncConfig(
  root = sourceRoot,
): Promise<SourceSyncConfig> {
  const config: SourceSyncConfig = await Bun.file(
    join(root, "tools/config/commit-sync.json"),
  ).json();
  if (
    config.schemaVersion !== 1 ||
    !Array.isArray(config.owners) ||
    !config.owners.length ||
    !Array.isArray(config.repositories) ||
    !config.repositories.length ||
    !Number.isInteger(config.pollIntervalMs) ||
    config.pollIntervalMs < 1000 ||
    config.pollIntervalMs > 3600000 ||
    !Number.isInteger(config.debounceMs) ||
    config.debounceMs < 25 ||
    config.debounceMs > 5000 ||
    !Number.isInteger(config.commandTimeoutMs) ||
    config.commandTimeoutMs < 1000 ||
    config.commandTimeoutMs > 300000
  )
    throw new Error("Invalid commit-sync configuration");
  const ids = new Set<string>();
  for (const repository of config.repositories) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(repository.id) ||
      ids.has(repository.id) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(repository.remote) ||
      repository.remote === "legacy-aphrody" ||
      !repository.path ||
      !repository.sourceBranch ||
      !repository.destinationBranch
    )
      throw new Error("Invalid or duplicate commit-sync repository");
    ids.add(repository.id);
    if (
      repository.repositoryName !== undefined &&
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(repository.repositoryName)
    )
      throw new Error("Invalid source repository name");
    if (
      repository.buildEnabled !== undefined &&
      typeof repository.buildEnabled !== "boolean"
    )
      throw new Error("Invalid factory build activation policy");
    if (
      repository.buildCommand !== undefined &&
      (!Array.isArray(repository.buildCommand) ||
        !repository.buildCommand.length ||
        repository.buildCommand.some(
          (value) =>
            typeof value !== "string" || !value || value.includes("\0"),
        ))
    )
      throw new Error("Invalid declared factory build command");
    repository.path = resolve(root, repository.path);
  }
  return config;
}

/** Fetch the existing remote, verify ancestry, then push the captured source SHA normally. */
export async function syncRepository(
  repository: SyncRepository,
  config: SourceSyncConfig,
  options: SyncOptions = {},
): Promise<SyncRow> {
  const row: SyncRow = {
    repo: repository.id,
    remote: repository.remote,
    sourceBranch: repository.sourceBranch,
    destinationBranch: repository.destinationBranch,
    status: "inspection-error",
    action: "preserved",
  };
  const run = (args: string[]) =>
    git(repository.path, args, config.commandTimeoutMs, options.signal);
  try {
    if (!existsSync(repository.path)) return { ...row, status: "absent" };
    const root = must(
      await run(["rev-parse", "--show-toplevel"]),
      "Repository root",
    );
    if (resolve(root) !== resolve(repository.path))
      return { ...row, status: "not-repository-root" };
    for (const branch of [
      repository.sourceBranch,
      repository.destinationBranch,
    ])
      if ((await run(["check-ref-format", `refs/heads/${branch}`])).code !== 0)
        return { ...row, status: "invalid-branch" };
    const trusted =
      options.remoteValidator ??
      ((url: string) => ownerRemote(url, config.owners, repository));
    const fetchUrls = await run([
      "remote",
      "get-url",
      "--all",
      repository.remote,
    ]);
    const pushUrls = await run([
      "remote",
      "get-url",
      "--push",
      "--all",
      repository.remote,
    ]);
    if (
      repository.remote === "legacy-aphrody" ||
      fetchUrls.code !== 0 ||
      pushUrls.code !== 0 ||
      [...fetchUrls.stdout.split("\n"), ...pushUrls.stdout.split("\n")].some(
        (url) => !trusted(url, repository),
      )
    )
      return { ...row, status: "unowned-remote" };
    for (const marker of [
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "rebase-merge",
      "rebase-apply",
    ]) {
      const path = must(
        await run([
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          marker,
        ]),
        "Git operation",
      );
      if (existsSync(path)) return { ...row, status: "operation-in-progress" };
    }
    const source = `refs/heads/${repository.sourceBranch}`;
    const destination = `refs/remotes/${repository.remote}/${repository.destinationBranch}`;
    row.sourceHead = must(
      await run(["rev-parse", "--verify", source]),
      "Source branch",
    );
    row.dirty = !!must(
      await run([
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
        "--ignore-submodules=none",
      ]),
      "Source worktree",
    );
    if (options.apply) {
      // --no-prune/--no-tags avoids unrelated refs. A missing destination is not created implicitly.
      const fetched = await run([
        "fetch",
        "--no-prune",
        "--no-tags",
        repository.remote,
        `+refs/heads/${repository.destinationBranch}:${destination}`,
      ]);
      if (fetched.code !== 0)
        return { ...row, status: "fetch-error", action: "fetch-failed" };
    }
    const remoteHead = await run(["rev-parse", "--verify", destination]);
    if (remoteHead.code !== 0)
      return { ...row, status: "no-destination", action: "preserved" };
    row.destinationHead = remoteHead.stdout;
    const counts = must(
      await run([
        "rev-list",
        "--left-right",
        "--count",
        `${row.sourceHead}...${row.destinationHead}`,
      ]),
      "History comparison",
    )
      .split(/\s+/u)
      .map(Number);
    row.ahead = counts[0] ?? 0;
    row.behind = counts[1] ?? 0;
    row.status =
      row.ahead && row.behind
        ? "diverged"
        : row.ahead
          ? "ahead"
          : row.behind
            ? "behind"
            : "current";
    row.action = options.apply ? "current" : "planned";
    if (!options.apply || row.status === "diverged" || row.status === "current")
      return row;
    if (row.status === "behind") {
      if (
        !repository.fastForward ||
        repository.sourceBranch !== repository.destinationBranch ||
        row.dirty ||
        must(await run(["branch", "--show-current"]), "Current branch") !==
          repository.sourceBranch
      )
        return { ...row, action: "local-worktree-preserved" };
      // Recheck immediately before the only worktree-changing operation.
      if (
        must(await run(["rev-parse", source]), "Source revision") !==
          row.sourceHead ||
        must(
          await run([
            "status",
            "--porcelain=v1",
            "--untracked-files=normal",
            "--ignore-submodules=none",
          ]),
          "Source worktree",
        )
      )
        return { ...row, action: "concurrent-work-preserved" };
      if (
        (
          await run([
            "merge-base",
            "--is-ancestor",
            row.sourceHead,
            row.destinationHead,
          ])
        ).code !== 0
      )
        return { ...row, status: "diverged", action: "preserved" };
      const merged = await run(["merge", "--ff-only", row.destinationHead]);
      return {
        ...row,
        status: merged.code === 0 ? "current" : "merge-error",
        action: merged.code === 0 ? "fast-forwarded" : "preserved",
        sourceHead: merged.code === 0 ? row.destinationHead : row.sourceHead,
        behind: merged.code === 0 ? 0 : row.behind,
      };
    }
    if (
      (
        await run([
          "merge-base",
          "--is-ancestor",
          row.destinationHead,
          row.sourceHead,
        ])
      ).code !== 0
    )
      return { ...row, status: "diverged", action: "preserved" };
    if (options.push === false)
      return { ...row, action: "fetched; push not selected" };
    if (
      must(await run(["rev-parse", source]), "Source revision") !==
      row.sourceHead
    )
      return { ...row, status: "changed", action: "concurrent-work-preserved" };
    const pushed = await run([
      "push",
      repository.remote,
      `${row.sourceHead}:refs/heads/${repository.destinationBranch}`,
    ]);
    return {
      ...row,
      status: pushed.code === 0 ? "current" : "push-error",
      action: pushed.code === 0 ? "pushed" : "normal-push-refused",
      ahead: pushed.code === 0 ? 0 : row.ahead,
      destinationHead: pushed.code === 0 ? row.sourceHead : row.destinationHead,
    };
  } catch {
    return {
      ...row,
      status: options.signal?.aborted ? "aborted" : "inspection-error",
      action: "preserved",
    };
  }
}
export async function syncSources(
  config: SourceSyncConfig,
  options: SyncOptions = {},
): Promise<SyncReport> {
  const rows: SyncRow[] = [];
  for (const repository of config.repositories) {
    if (options.signal?.aborted) break;
    rows.push(await syncRepository(repository, config, options));
  }
  return {
    schemaVersion: 3,
    at: new Date().toISOString(),
    mode: options.apply ? "apply" : "plan",
    rows,
  };
}

/** Coalesce source-ref changes and serialize cycles; fallback detects missed filesystem events. */
export async function watchSources(
  config: SourceSyncConfig,
  options: SyncOptions & {
    signal: AbortSignal;
    onReport: (report: SyncReport) => void | Promise<void>;
  },
): Promise<void> {
  const watchers: FSWatcher[] = [];
  let pending = true;
  let forced = true;
  let wake: (() => void) | undefined;
  let lastSignature = "";
  const request = (force: boolean) => {
    pending = true;
    forced ||= force;
    wake?.();
  };
  const abort = () => wake?.();
  options.signal.addEventListener("abort", abort, { once: true });
  const fallback = setInterval(() => request(true), config.pollIntervalMs);
  try {
    for (const repository of config.repositories) {
      const gitDir = await git(
        repository.path,
        ["rev-parse", "--absolute-git-dir"],
        config.commandTimeoutMs,
        options.signal,
      );
      if (gitDir.code !== 0) continue;
      const common = await git(
        repository.path,
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        config.commandTimeoutMs,
        options.signal,
      );
      const refs = common.code === 0 ? common.stdout : gitDir.stdout;
      const directories = new Map<string, Set<string>>();
      for (const path of [
        join(gitDir.stdout, "HEAD"),
        join(refs, "packed-refs"),
        join(refs, "refs/heads", repository.sourceBranch),
      ]) {
        const parent = dirname(path);
        const names = directories.get(parent) ?? new Set<string>();
        names.add(path.slice(parent.length + 1));
        directories.set(parent, names);
      }
      for (const [directory, names] of directories) {
        if (!existsSync(directory)) continue;
        try {
          const watcher = watch(directory, (_event, filename) => {
            if (!filename || names.has(String(filename))) request(false);
          });
          watcher.on("error", () => {
            watcher.close();
            request(true);
          });
          watchers.push(watcher);
        } catch {
          /* Fallback reconciliation retains coverage when filesystem watching is unavailable. */
        }
      }
    }
    while (!options.signal.aborted) {
      if (!pending)
        await new Promise<void>((resolveWake) => {
          wake = resolveWake;
        });
      wake = undefined;
      if (options.signal.aborted) break;
      await new Promise<void>((resolveDebounce) => {
        const done = () => {
          clearTimeout(timer);
          options.signal.removeEventListener("abort", done);
          resolveDebounce();
        };
        const timer = setTimeout(done, config.debounceMs);
        options.signal.addEventListener("abort", done, { once: true });
      });
      if (options.signal.aborted) break;
      const force = forced;
      pending = false;
      forced = false;
      const heads: string[] = [];
      for (const repository of config.repositories) {
        const head = await git(
          repository.path,
          ["rev-parse", `refs/heads/${repository.sourceBranch}`],
          config.commandTimeoutMs,
          options.signal,
        );
        heads.push(`${repository.id}:${head.code}:${head.stdout}`);
      }
      const signature = heads.join("\n");
      if (!force && signature === lastSignature) continue;
      const report = await syncSources(config, options);
      lastSignature = signature;
      await options.onReport(report);
    }
  } finally {
    clearInterval(fallback);
    options.signal.removeEventListener("abort", abort);
    for (const watcher of watchers) watcher.close();
  }
}

export function sourceSyncStateRoot(): string {
  return join(
    process.env.APHRODY_HOME ?? join(homedir(), ".aphrody"),
    "state",
    "commit-sync",
  );
}
export function acquireSourceSyncLock(root: string): () => void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, "owner.lock");
  const token = `${process.pid}:${crypto.randomUUID()}`;
  let descriptor: number;
  try {
    descriptor = openSync(path, "wx", 0o600);
  } catch {
    const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
    let stale = false;
    try {
      const owner: { pid?: number } = JSON.parse(previous);
      if (Number.isSafeInteger(owner.pid) && owner.pid! > 0) {
        try {
          process.kill(owner.pid!, 0);
        } catch (error) {
          stale = (error as NodeJS.ErrnoException).code === "ESRCH";
        }
      }
    } catch {
      /* An unverified owner record remains protected. */
    }
    if (!stale || readFileSync(path, "utf8") !== previous)
      throw new Error(
        "Commit synchronization already has an owner; inspect protected owner.lock before retrying",
      );
    rmSync(path);
    descriptor = openSync(path, "wx", 0o600);
  }
  try {
    writeFileSync(
      descriptor,
      JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() }),
    );
  } finally {
    closeSync(descriptor);
  }
  return () => {
    if (
      existsSync(path) &&
      JSON.parse(readFileSync(path, "utf8")).token === token
    )
      rmSync(path);
  };
}
function persistReport(root: string, report: SyncReport): void {
  const data = `${JSON.stringify(report)}\n`;
  const temporary = join(root, `latest.${process.pid}.tmp`);
  writeFileSync(temporary, data, { mode: 0o600 });
  renameSync(temporary, join(root, "latest.json"));
  const log = join(root, "events.jsonl");
  if (existsSync(log) && statSync(log).size > 2 * 1024 * 1024)
    renameSync(log, `${log}.previous`);
  appendFileSync(log, data, { mode: 0o600 });
}
const usage =
  "Usage: yolo ops repo-sync <plan|once|watch> [--apply] [--repo NAME] [--json]\n       bun scripts/tools/workspace/source-sync.ts [--apply --push] [--watch] [--interval SECONDS] [--repo NAME] [--json]";
export interface SourceSyncCallbacks {
  onReport?: (
    report: SyncReport,
    config: SourceSyncConfig,
  ) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
}
export async function runSourceSync(
  args: string[],
  root = sourceRoot,
  callbacks: SourceSyncCallbacks = {},
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage);
    return 0;
  }
  try {
    const explicitAction = !!args[0] && !args[0].startsWith("-");
    const action =
      args[0] && !args[0].startsWith("-")
        ? args.shift()!
        : args.includes("--watch")
          ? "watch"
          : args.includes("--apply")
            ? "once"
            : "plan";
    if (!["plan", "once", "watch"].includes(action)) throw new Error(usage);
    const apply = args.includes("--apply");
    if (action === "plan" && apply)
      throw new Error("plan cannot apply; use once or watch --apply");
    const selected: string[] = [];
    let interval: number | undefined;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (["--apply", "--push", "--watch", "--json"].includes(arg!)) continue;
      if (arg === "--repo") {
        const id = args[++i];
        if (!id) throw new Error(usage);
        selected.push(id);
      } else if (arg === "--interval") interval = Number(args[++i]) * 1000;
      else throw new Error(usage);
    }
    if (args.includes("--push") && !apply)
      throw new Error("--push requires --apply");
    const config = await loadSourceSyncConfig(root);
    if (selected.length) {
      if (
        selected.some(
          (id) =>
            !config.repositories.some((repository) => repository.id === id),
        )
      )
        throw new Error("Unknown source-sync repository");
      config.repositories = config.repositories.filter((repository) =>
        selected.includes(repository.id),
      );
    }
    if (interval !== undefined) {
      if (!Number.isInteger(interval) || interval < 1000 || interval > 3600000)
        throw new Error("interval must be 1..3600 seconds");
      config.pollIntervalMs = interval;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    const emit = (report: SyncReport) => {
      console.log(JSON.stringify(report));
    };
    if (action === "plan") {
      const report = await syncSources(config);
      emit(report);
      await callbacks.onReport?.(report, config);
      return 0;
    }
    const state = sourceSyncStateRoot();
    const release = acquireSourceSyncLock(state);
    process.on("SIGINT", abort);
    process.on("SIGTERM", abort);
    try {
      const options = {
        apply,
        push: explicitAction || args.includes("--push"),
        signal: controller.signal,
      };
      const onReport = async (report: SyncReport) => {
        persistReport(state, report);
        emit(report);
        await callbacks.onReport?.(report, config);
      };
      if (action === "watch") {
        try {
          await watchSources(config, { ...options, onReport });
        } catch (error) {
          if (!controller.signal.aborted) throw error;
        }
      } else {
        const report = await syncSources(config, options);
        await onReport(report);
        return report.rows.some((row) =>
          [
            "inspection-error",
            "fetch-error",
            "push-error",
            "merge-error",
            "diverged",
            "unowned-remote",
            "aborted",
          ].includes(row.status),
        )
          ? 1
          : 0;
      }
      return 0;
    } finally {
      try {
        await callbacks.onStop?.();
      } finally {
        process.removeListener("SIGINT", abort);
        process.removeListener("SIGTERM", abort);
        release();
      }
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Source synchronization failed",
    );
    return 2;
  }
}
if (import.meta.main) process.exit(await runSourceSync(process.argv.slice(2)));
