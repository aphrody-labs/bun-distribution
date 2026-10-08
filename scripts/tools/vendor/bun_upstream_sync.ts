/**
 * Upstream sync engine for the Aphrody Bun fork (aphrody-labs/bun).
 *
 * One branch: `main` carries the Aphrody patches on top of upstream oven-sh/bun `main`.
 * The checkout is `--checkout <dir>`, else `APHRODY_BUN_CHECKOUT`, else `C:\bun` on Windows when it
 * exists, else `vendor/bun` of this repository.
 * - Analysis (default, or --dry-run) compares the fork branch with `upstream/main` from local refs.
 * - --apply fetches upstream and merges `upstream/main` into `main` (never rebases, never force-pushes)
 *   through the fork's canonical tool `scripts/aphrody/sync-upstream.ts` (rename-aware merge plus the
 *   `scripts/aphrody/scope.ts` @aphrody rewrite) when the checkout has it, verifies the fork additions
 *   and pushes `origin main`.
 * - --qualify also runs the fork tests with the debug build (`bun bd test test/js/first_party/`).
 * - --auto-fix (only without the fork tool) resolves lockfile and completions conflicts with the upstream
 *   side; --reapply-patches re-applies `patches/bun/*.patch` when the fork checks fail after a merge.
 */

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Repository root: this script lives in scripts/tools/vendor/.
const repositoryRoot = resolve(import.meta.dir, "../../..");

/** The fork's single branch, and the upstream ref it follows. */
export const FORK_BRANCH = "main";
export const UPSTREAM_REF = "upstream/main";

export interface SyncOptions {
  readonly dryRun?: boolean;
  readonly apply?: boolean;
  readonly autoFix?: boolean;
  readonly reapplyPatches?: boolean;
  readonly qualify?: boolean;
}

/** Files only the fork carries; a checkout missing one is not aphrody-labs/bun `main`. */
export const FORK_MARKERS = [
  "src/js/thirdparty/dotenv.ts",
  "src/js/internal/dotenv.ts",
  "test/js/first_party",
  "scripts/aphrody/sync-upstream.ts",
  "scripts/aphrody/scope.ts",
] as const;

/** The fork's own upstream merge tool, relative to the checkout. */
export const FORK_SYNC_TOOL = "scripts/aphrody/sync-upstream.ts";

/** Explicit directory, then `APHRODY_BUN_CHECKOUT`, then `C:\bun` (Windows), then `vendor/bun`. */
export function resolveBunCheckout(
  explicit?: string,
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): string {
  if (explicit) return resolve(explicit);
  if (env.APHRODY_BUN_CHECKOUT) return resolve(env.APHRODY_BUN_CHECKOUT);
  if (platform === "win32" && existsSync("C:\\bun\\.git")) return "C:\\bun";
  return resolve(repositoryRoot, "vendor/bun");
}

/** Fork markers absent from a checkout. */
export function missingForkMarkers(bunDir: string): string[] {
  return FORK_MARKERS.filter((marker) => !existsSync(resolve(bunDir, marker)));
}

export interface DriftReport {
  readonly upstreamCommit: string;
  readonly forkCommit: string;
  readonly commitsBehindUpstream: number;
  readonly commitsAheadUpstream: number;
  readonly hasUncommittedChanges: boolean;
  readonly status: "in_sync" | "drift_detected" | "diverged";
}

export interface SyncResult {
  readonly success: boolean;
  readonly previousCommit: string;
  readonly currentCommit: string;
  readonly message: string;
  readonly drift: DriftReport;
  readonly timestamp: string;
}

/** Drift status from the two commit distances. */
export function driftStatus(behind: number, ahead: number): DriftReport["status"] {
  if (behind > 0 && ahead > 0) return "diverged";
  return behind > 0 ? "drift_detected" : "in_sync";
}

export class BunUpstreamSyncEngine {
  private readonly bunDir: string;
  private readonly patchesDir: string;

  public constructor(bunDir: string = resolveBunCheckout()) {
    this.bunDir = bunDir;
    this.patchesDir = resolve(repositoryRoot, "patches/bun");
  }

  /** Runs one git command in the Bun checkout. */
  private async runGit(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    const proc = Bun.spawn(["git", ...args], {
      cwd: this.bunDir,
      env: { ...process.env, PAGER: "cat" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), code };
  }

  /** The local fork branch, else its remote-tracking ref (shallow checkouts often lack the local one). */
  private async forkRef(): Promise<string> {
    const local = await this.runGit(["rev-parse", "--verify", "--quiet", FORK_BRANCH]);
    return local.code === 0 ? FORK_BRANCH : `origin/${FORK_BRANCH}`;
  }

  /** Ensures both origin and upstream remotes exist. */
  public async ensureRemotes(): Promise<void> {
    const remotes = (await this.runGit(["remote"])).stdout.split("\n");
    if (!remotes.includes("upstream")) {
      console.log("Adding upstream remote (https://github.com/oven-sh/bun.git)...");
      await this.runGit(["remote", "add", "upstream", "https://github.com/oven-sh/bun.git"]);
    }
    if (!remotes.includes("origin")) {
      console.log("Adding origin remote (git@github-dev:aphrody-labs/bun.git)...");
      await this.runGit(["remote", "add", "origin", "git@github-dev:aphrody-labs/bun.git"]);
    }
  }

  /** Read-only: distance between the fork branch and upstream/main. Fetching is an explicit action. */
  public async analyzeDrift(): Promise<DriftReport> {
    const fork = await this.forkRef();
    const upstream = await this.runGit(["rev-parse", UPSTREAM_REF]);
    const head = await this.runGit(["rev-parse", fork]);
    if (upstream.code !== 0 || head.code !== 0) {
      throw new Error(
        `Missing ${UPSTREAM_REF} or ${fork}: fetch them (--apply does) or measure drift with ` +
          '`aphrody git api "/repos/oven-sh/bun/compare/main...aphrody-labs:bun:main"`.',
      );
    }
    const status = await this.runGit(["status", "--porcelain", "--untracked-files=no"]);
    const behind = await this.runGit(["rev-list", "--count", `${fork}..${UPSTREAM_REF}`]);
    const ahead = await this.runGit(["rev-list", "--count", `${UPSTREAM_REF}..${fork}`]);
    const commitsBehind = Number.parseInt(behind.stdout || "0", 10);
    const commitsAhead = Number.parseInt(ahead.stdout || "0", 10);
    return {
      upstreamCommit: upstream.stdout.slice(0, 9),
      forkCommit: head.stdout.slice(0, 9),
      commitsBehindUpstream: commitsBehind,
      commitsAheadUpstream: commitsAhead,
      hasUncommittedChanges: status.stdout.length > 0,
      status: driftStatus(commitsBehind, commitsAhead),
    };
  }

  /** Merges upstream/main into the fork branch, verifies the fork additions and pushes it. */
  public async syncForkBranch(options: SyncOptions = {}): Promise<boolean> {
    console.log(`[Sync] Switching to ${FORK_BRANCH}...`);
    const checkout = await this.runGit(["checkout", FORK_BRANCH]);
    if (checkout.code !== 0) {
      console.error(`[Sync Error] Failed to checkout ${FORK_BRANCH}:`, checkout.stderr);
      return false;
    }
    if (existsSync(resolve(this.bunDir, FORK_SYNC_TOOL))) {
      if (options.autoFix === true) {
        console.warn(
          "[Sync] --auto-fix is ignored: the fork tool resolves only @aphrody rename conflicts.",
        );
      }
      console.log(`[Sync] Merging ${UPSTREAM_REF} with the fork tool ${FORK_SYNC_TOOL}...`);
      const code = await this.runTool(["bun", FORK_SYNC_TOOL, "--root", this.bunDir, "--no-fetch"]);
      if (code !== 0) {
        console.error(
          `[Sync Error] ${FORK_SYNC_TOOL} exited ${code} (2 = conflicts beyond the rename; merge aborted).`,
        );
        return false;
      }
    } else if (!(await this.legacyMerge(options))) {
      return false;
    }

    if (!(await this.verifyForkIntegrity(options))) {
      console.warn("[Sync Warning] Fork integrity checks failed.");
      if (!options.reapplyPatches) return false;
      const applied = await this.reapplyPatches();
      if (!applied || !(await this.verifyForkIntegrity(options))) return false;
    }

    console.log(`[Sync] Pushing ${FORK_BRANCH} to origin (fast-forward only)...`);
    const push = await this.runGit(["push", "origin", FORK_BRANCH]);
    return push.code === 0;
  }

  /** Runs a command in the checkout with inherited output and returns its exit code. */
  private async runTool(cmd: string[]): Promise<number> {
    const proc = Bun.spawn(cmd, {
      cwd: this.bunDir,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    return await proc.exited;
  }

  /** Plain merge for a checkout without the fork tool. */
  private async legacyMerge(options: SyncOptions): Promise<boolean> {
    console.log(`[Sync] Merging ${UPSTREAM_REF} into ${FORK_BRANCH}...`);
    const merge = await this.runGit([
      "merge",
      "--no-edit",
      UPSTREAM_REF,
      "-m",
      "Merge upstream oven-sh/bun main",
    ]);
    if (merge.code === 0) {
      console.log("[Sync] Merged cleanly.");
    } else if (options.autoFix === true && (await this.autoFixMergeConflicts())) {
      console.log("[Sync] Conflicts resolved by the auto-fix rules.");
    } else {
      console.error("[Sync Error] Merge conflicts need a manual resolution; merge aborted.");
      await this.runGit(["merge", "--abort"]);
      return false;
    }
    return true;
  }

  /** Resolves conflicts on generated files (lockfiles, completions) with the upstream side. */
  private async autoFixMergeConflicts(): Promise<boolean> {
    const status = await this.runGit(["status", "--porcelain"]);
    let unresolved = 0;
    for (const line of status.stdout.split("\n")) {
      const code = line.slice(0, 2);
      const filePath = line.slice(3).trim();
      if (!filePath || !["UU", "AA"].includes(code)) continue;
      const generated =
        filePath.endsWith("bun.lock") ||
        filePath.endsWith("Cargo.lock") ||
        filePath.startsWith("completions/");
      if (!generated) {
        unresolved += 1;
        continue;
      }
      console.log(`[Auto-Fix] Taking upstream for ${filePath}`);
      await this.runGit(["checkout", "--theirs", filePath]);
      await this.runGit(["add", filePath]);
    }
    if (unresolved > 0) return false;
    const commit = await this.runGit(["commit", "--no-edit"]);
    return commit.code === 0;
  }

  /** Re-applies the versioned Aphrody patches on a clean tree. */
  public async reapplyPatches(): Promise<boolean> {
    const status = await this.runGit(["status", "--porcelain", "--untracked-files=no"]);
    if (status.code !== 0 || status.stdout) {
      console.error("[Patch Reapply] Working tree must be clean.");
      return false;
    }
    if (!existsSync(this.patchesDir)) {
      console.warn("[Patch Reapply] Patches directory not found:", this.patchesDir);
      return false;
    }
    const patches = readdirSync(this.patchesDir)
      .filter((file) => file.endsWith(".patch"))
      .toSorted();
    for (const patch of patches) {
      console.log(`[Patch Reapply] Applying ${patch}`);
      const applied = await this.runGit(["apply", "--index", resolve(this.patchesDir, patch)]);
      if (applied.code !== 0) {
        console.error(`[Patch Error] Failed to apply ${patch}:`, applied.stderr);
        return false;
      }
    }
    const commit = await this.runGit(["commit", "-m", "Reapply Aphrody fork modifications"]);
    return commit.code === 0;
  }

  /**
   * Fork markers present and the @aphrody rename complete (`scope.ts --check`); with `qualify`, the
   * fork tests through the debug build. A system `bun test` never contains native changes.
   */
  public async verifyForkIntegrity(options: SyncOptions = {}): Promise<boolean> {
    const missing = missingForkMarkers(this.bunDir);
    if (missing.length > 0) {
      console.error(`[Integrity] ${this.bunDir} lacks fork files: ${missing.join(", ")}`);
      return false;
    }
    if ((await this.runTool(["bun", "scripts/aphrody/scope.ts", "--check"])) !== 0) {
      console.error("[Integrity] scripts/aphrody/scope.ts --check found upstream package names.");
      return false;
    }
    if (options.qualify === true) {
      return (await this.runTool(["bun", "bd", "test", "test/js/first_party/"])) === 0;
    }
    return true;
  }

  /** Analyses drift; with --apply, fetches, merges upstream into the fork branch and pushes it. */
  public async execute(options: SyncOptions = {}): Promise<SyncResult> {
    const apply = options.apply === true && options.dryRun !== true;
    if (apply) {
      await this.ensureRemotes();
      const fetched = await Promise.all([
        this.runGit(["fetch", "--filter=blob:none", "upstream", "main"]),
        this.runGit(["fetch", "--filter=blob:none", "origin", FORK_BRANCH]),
      ]);
      if (fetched.some((result) => result.code !== 0)) {
        throw new Error("Bun upstream fetch failed; no branch was switched or pushed.");
      }
    }
    const before = await this.analyzeDrift();
    console.log("─────────────────────────────────────────────────────────────");
    console.log(" Aphrody Bun Upstream Synchronization Engine");
    console.log("─────────────────────────────────────────────────────────────");
    console.log(` Checkout                      : ${this.bunDir}`);
    console.log(` Upstream (oven-sh/bun:main)   : ${before.upstreamCommit}`);
    console.log(` Fork (aphrody-labs/bun:main)  : ${before.forkCommit}`);
    console.log(` Commits behind upstream       : ${before.commitsBehindUpstream}`);
    console.log(` Commits ahead (fork patches)  : ${before.commitsAheadUpstream}`);
    console.log(` Drift status                  : ${before.status}`);
    console.log("─────────────────────────────────────────────────────────────");

    const result = (success: boolean, message: string, drift = before): SyncResult => ({
      success,
      previousCommit: before.forkCommit,
      currentCommit: drift.forkCommit,
      message,
      drift,
      timestamp: new Date().toISOString(),
    });
    if (!apply) {
      return result(true, "Read-only analysis. Pass --apply to fetch, merge and push.");
    }
    if (before.hasUncommittedChanges) {
      return result(false, `${this.bunDir} has uncommitted changes; commit or resolve them first.`);
    }
    if (before.commitsBehindUpstream === 0) {
      return result(true, "The fork already contains upstream main.");
    }
    const synced = await this.syncForkBranch(options);
    const after = await this.analyzeDrift();
    return result(
      synced,
      synced ? "Fork merged with upstream main and pushed." : "Fork synchronization failed.",
      after,
    );
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const checkoutIndex = argv.indexOf("--checkout");
  const checkout = checkoutIndex >= 0 ? argv[checkoutIndex + 1] : undefined;
  if (checkoutIndex >= 0 && (!checkout || checkout.startsWith("--"))) {
    console.error("--checkout requires a directory");
    process.exit(2);
  }
  const args = new Set(argv);
  const engine = new BunUpstreamSyncEngine(resolveBunCheckout(checkout));
  try {
    const res = await engine.execute({
      dryRun: args.has("--dry-run"),
      apply: args.has("--apply"),
      autoFix: args.has("--auto-fix"),
      reapplyPatches: args.has("--reapply-patches"),
      qualify: args.has("--qualify"),
    });
    console.log(`\nSync finished. Success: ${res.success}. Message: ${res.message}`);
    process.exitCode = res.success ? 0 : 1;
  } catch (error) {
    console.error("Fatal error during upstream sync:", error);
    process.exitCode = 1;
  }
}
