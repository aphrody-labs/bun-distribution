// SPDX-License-Identifier: Apache-2.0
/** Safe, repeatable source sync for first-party Git workspaces. */
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

type Result = { code: number; stdout: string; stderr: string };
type Row = Record<string, unknown> & { repo: string; status: string; action: string };
type Remote = { owner: string; repository: string };

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const push = args.includes("--push");
const watch = args.includes("--watch");
const json = args.includes("--json");
const intervalArg = args.indexOf("--interval");
const interval = intervalArg < 0 ? 60 : Number(args[intervalArg + 1]);
const requestedRepos = args.flatMap((arg, index) => arg === "--repo" ? [args[index + 1] ?? ""] : []);
const consumed = new Set<number>();
if (intervalArg >= 0) consumed.add(intervalArg + 1);
for (let index = 0; index < args.length; index += 1) if (args[index] === "--repo") consumed.add(index + 1);
if (args.some((arg, index) => !consumed.has(index) && !["--apply", "--push", "--watch", "--json", "--interval", "--repo"].includes(arg)) ||
  requestedRepos.some((name) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) ||
  (watch && (!Number.isInteger(interval) || interval < 30 || interval > 3600)) || (push && !apply)) {
  throw new Error("Usage: bun scripts/source-sync.ts [--apply] [--push] [--watch] [--interval 60] [--repo NAME] [--json]; --push requires --apply; watch interval is 30..3600s");
}

const infra = resolve(import.meta.dir, "..");
const workspace = resolve(infra, "..");
const identity = { name: "aphrody-code", email: "contact@aphrody.com" };
const owners = new Set(["aphrody-code", "aphrody-labs"]);
const stateRoot = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "aphrody", "source-sync");
const lockPath = join(stateRoot, "source-sync.lock");

function run(repo: string, ...command: string[]): Result {
  const proc = Bun.spawnSync(command, { cwd: repo, stdout: "pipe", stderr: "pipe", env: process.env });
  const decoder = new TextDecoder();
  return { code: proc.exitCode ?? 2, stdout: decoder.decode(proc.stdout).trim(), stderr: decoder.decode(proc.stderr).trim() };
}
function git(repo: string, ...gitArgs: string[]): Result { return run(repo, "git", ...gitArgs); }
function must(result: Result, label: string): string {
  if (result.code !== 0) throw new Error(`${label} failed (exit ${result.code})`);
  return result.stdout;
}
function remote(repo: string, name: string): Remote | undefined {
  const result = git(repo, "remote", "get-url", name);
  if (result.code !== 0) return undefined;
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/u.exec(result.stdout);
  if (!match || !owners.has(match[1])) return undefined;
  return { owner: match[1], repository: match[2] };
}
function isDirty(repo: string): boolean {
  const state = git(repo, "status", "--porcelain=v1", "--untracked-files=normal", "--ignore-submodules=none");
  return state.code !== 0 || state.stdout.length > 0;
}
function gitOperation(repo: string): string | undefined {
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
    const path = git(repo, "rev-parse", "--git-path", marker);
    if (path.code === 0 && existsSync(path.stdout)) return marker;
  }
  return undefined;
}
function discoverCandidates(): string[] {
  const entries = readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(workspace, entry.name, ".git")))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (requestedRepos.length === 0) return entries;
  const known = new Set(entries);
  return [...new Set(requestedRepos)].sort().map((name) => {
    if (!known.has(name)) throw new Error(`--repo ${name} is not a Git worktree under ${workspace}`);
    return name;
  });
}
function syncOne(name: string): Row {
  const repo = join(workspace, name);
  try {
    if (!existsSync(repo) || !existsSync(join(repo, ".git"))) return { repo: name, status: "absent", action: "skipped" };
    const branch = must(git(repo, "branch", "--show-current"), `${name}: branch`);
    if (!branch) return { repo: name, status: "detached", action: "fetch-skipped" };
    const origin = remote(repo, "origin");
    if (!origin) return { repo: name, status: "unowned-remote", action: "skipped" };
    const initialDirty = isDirty(repo);
    const operation = gitOperation(repo);
    const current = must(git(repo, "rev-parse", "HEAD"), `${name}: HEAD`);
    const upstreamRef = git(repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
    const row: Row = {
      repo: name, branch, origin: `${origin.owner}/${origin.repository}`, dirty: initialDirty,
      head: current, status: initialDirty ? "dirty" : "clean", action: "current",
    };
    if (operation) return { ...row, status: "operation-in-progress", action: "preserved", operation };
    if (upstreamRef.code !== 0) return { ...row, status: initialDirty ? "dirty" : "no-upstream", action: "fetch-skipped" };

    const upstream = upstreamRef.stdout;
    const remoteName = git(repo, "config", `branch.${branch}.remote`);
    const trackingRemote = remoteName.code === 0 ? remoteName.stdout : "";
    if (apply) {
      const fetched = trackingRemote ? git(repo, "fetch", "--prune", "--no-tags", trackingRemote) : { code: 2 } as Result;
      if (fetched.code !== 0) return { ...row, status: initialDirty ? "dirty" : "fetch-error", action: "fetch-failed", exitCode: fetched.code };
    }
    const counts = must(git(repo, "rev-list", "--left-right", "--count", `HEAD...${upstream}`), `${name}: ahead/behind`)
      .split(/\s+/u).map(Number);
    const ahead = counts[0] ?? 0;
    const behind = counts[1] ?? 0;
    Object.assign(row, { upstream, ahead, behind });
    if (!apply || initialDirty) {
      row.action = initialDirty ? "fetched; local changes preserved" : "planned";
      return row;
    }
    if (ahead > 0 && behind > 0) return { ...row, status: "diverged", action: "fetched; divergent history left untouched" };
    if (behind > 0 && ahead === 0) {
      const merged = git(repo, "merge", "--ff-only", upstream);
      if (merged.code !== 0) return { ...row, status: "merge-error", action: "fast-forward-failed", exitCode: merged.code };
      row.action = "fast-forwarded";
      row.head = must(git(repo, "rev-parse", "HEAD"), `${name}: updated HEAD`);
      row.behind = 0;
    }
    if (push && ahead > 0 && behind === 0) {
      const pushRemote = trackingRemote;
      const pushTarget = pushRemote ? remote(repo, pushRemote) : undefined;
      const identityConfig = git(repo, "config", "--local", "user.name").stdout === identity.name &&
        git(repo, "config", "--local", "user.email").stdout === identity.email;
      const authors = must(git(repo, "log", `${upstream}..HEAD`, "--format=%an <%ae>"), `${name}: commit authors`)
        .split("\n").filter(Boolean);
      if (!pushTarget || !identityConfig || authors.some((author) => author !== `${identity.name} <${identity.email}>`)) {
        row.action = "ahead; push skipped (identity or owned remote not verified)";
        return row;
      }
      const pushed = git(repo, "push", pushRemote, `HEAD:refs/heads/${branch}`);
      row.action = pushed.code === 0 ? "pushed Aphrody-authored commits" : "push-failed";
      if (pushed.code !== 0) { row.status = "push-error"; row.exitCode = pushed.code; }
    }
    return row;
  } catch (error) {
    return { repo: name, status: "inspection-error", action: "preserved", error: error instanceof Error ? error.message : "unknown error" };
  }
}
function writeReport(report: Record<string, unknown>): void {
  const reportDir = stateRoot;
  mkdirSync(reportDir, { recursive: true });
  const destination = join(reportDir, "source-sync.json");
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, destination);
}
function tick(): Row[] {
  const started = performance.now();
  const rows = discoverCandidates().map((name) => {
    const rowStarted = performance.now();
    const row = syncOne(name);
    row.durationMs = Math.round(performance.now() - rowStarted);
    return row;
  });
  const summary = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, {});
  const report = { schemaVersion: 2, at: new Date().toISOString(), workspace, mode: apply ? "apply" : "plan", push, selectedRepos: requestedRepos, durationMs: Math.round(performance.now() - started), summary, rows };
  writeReport(report);
  if (json) console.log(JSON.stringify(report, null, 2));
  else for (const row of rows) console.log(`${String(row.status).padEnd(22)} ${String(row.repo).padEnd(24)} ${row.action}${row.behind ? ` (behind ${row.behind})` : ""}${row.ahead ? ` (ahead ${row.ahead})` : ""}`);
  return rows;
}
function acquireLock(): void {
  mkdirSync(stateRoot, { recursive: true });
  try {
    const descriptor = openSync(lockPath, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  } catch (error) {
    if (!(error instanceof Error) || !existsSync(lockPath)) throw error;
    let owner: { pid?: number } = {};
    try { owner = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number }; } catch { /* stale or malformed lock is handled below */ }
    if (owner.pid && owner.pid !== process.pid) {
      try {
        process.kill(owner.pid, 0);
      } catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code === "ESRCH") {
          rmSync(lockPath, { force: true });
          return acquireLock();
        }
      }
    }
    throw new Error(`source sync is already running (${lockPath})`);
  }
}
function releaseLock(): void { rmSync(lockPath, { force: true }); }

async function main() {
  acquireLock();
  try {
    do {
      tick();
      if (watch) await Bun.sleep(interval * 1000);
    } while (watch);
  } finally {
    releaseLock();
  }
}
await main();
