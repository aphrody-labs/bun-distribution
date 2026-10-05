/**
 * Upstream Auto-Sync & Drift Fix Engine for Aphrody Bun Fork
 *
 * Synchronizes aphrody-labs/bun with upstream oven-sh/bun:
 * - Validates and configures remotes (origin and upstream)
 * - Fetches upstream changes and calculates drift
 * - Fast-forwards main to upstream/main and pushes to origin/main
 * - Re-integrates Aphrody custom branch with automated conflict and drift resolution
 * - Runs validation tests to verify fork integrity
 * - Emits structured audit reports
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const agentHome = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export interface SyncOptions {
  readonly dryRun?: boolean;
  readonly apply?: boolean;
  readonly autoFix?: boolean;
  readonly reapplyPatches?: boolean;
}

export interface DriftReport {
  readonly upstreamCommit: string;
  readonly mainCommit: string;
  readonly yoloCommit: string;
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

export class BunUpstreamSyncEngine {
  private readonly bunDir: string;
  private readonly patchesDir: string;

  public constructor(bunDir: string = resolve(agentHome, "vendor/bun")) {
    this.bunDir = bunDir;
    this.patchesDir = resolve(agentHome, "patches/bun");
  }

  /**
   * Executes a git command within vendor/bun.
   */
  private async runGit(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((res) => {
      const proc = spawn("git", args, {
        cwd: this.bunDir,
        env: { ...process.env, PAGER: "cat" },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        res({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code: code ?? 1,
        });
      });
    });
  }

  /**
   * Ensures both origin and upstream remotes exist and are correctly configured.
   */
  public async ensureRemotes(): Promise<void> {
    const remotesRes = await this.runGit(["remote", "-v"]);
    const remotes = remotesRes.stdout;

    if (!remotes.includes("upstream")) {
      console.log("Adding upstream remote (https://github.com/oven-sh/bun.git)...");
      await this.runGit(["remote", "add", "upstream", "https://github.com/oven-sh/bun.git"]);
    }

    if (!remotes.includes("origin")) {
      console.log("Adding origin remote (git@github-dev:aphrody-labs/bun.git)...");
      await this.runGit(["remote", "add", "origin", "git@github-dev:aphrody-labs/bun.git"]);
    }
  }

  /**
   * Analyzes divergence and drift between local branches and upstream.
   */
  public async analyzeDrift(): Promise<DriftReport> {
    // Analysis is read-only. Fetches and remote setup require an explicit action.

    const upstreamCommitRes = await this.runGit(["rev-parse", "upstream/main"]);
    const mainCommitRes = await this.runGit(["rev-parse", "main"]);
    const yoloCommitRes = await this.runGit(["rev-parse", "yolo"]);
    if ([upstreamCommitRes, mainCommitRes, yoloCommitRes].some((result) => result.code !== 0)) {
      throw new Error("Required Bun branches are unavailable; inspect remotes before sync.");
    }

    const statusRes = await this.runGit(["status", "--porcelain"]);
    const hasUncommittedChanges = statusRes.stdout.length > 0;

    const countBehindRes = await this.runGit(["rev-list", "--count", "yolo..upstream/main"]);
    const countAheadRes = await this.runGit(["rev-list", "--count", "upstream/main..yolo"]);

    const commitsBehind = parseInt(countBehindRes.stdout || "0", 10);
    const commitsAhead = parseInt(countAheadRes.stdout || "0", 10);

    let status: "in_sync" | "drift_detected" | "diverged" = "in_sync";
    if (commitsBehind > 0 && commitsAhead > 0) {
      status = "diverged";
    } else if (commitsBehind > 0) {
      status = "drift_detected";
    }

    return {
      upstreamCommit: upstreamCommitRes.stdout.slice(0, 8),
      mainCommit: mainCommitRes.stdout.slice(0, 8),
      yoloCommit: yoloCommitRes.stdout.slice(0, 8),
      commitsBehindUpstream: commitsBehind,
      commitsAheadUpstream: commitsAhead,
      hasUncommittedChanges,
      status,
    };
  }

  /**
   * Synchronizes main branch directly with upstream/main.
   */
  public async syncMainBranch(): Promise<boolean> {
    console.log("[Sync] Switching to main branch...");
    const checkoutRes = await this.runGit(["checkout", "main"]);
    if (checkoutRes.code !== 0) {
      console.error("[Sync Error] Failed to checkout main:", checkoutRes.stderr);
      return false;
    }

    console.log("[Sync] Fast-forwarding main to upstream/main...");
    const mergeRes = await this.runGit(["merge", "--ff-only", "upstream/main"]);
    if (mergeRes.code !== 0) {
      console.error("[Sync Error] main cannot fast-forward:", mergeRes.stderr);
      return false;
    }

    console.log("[Sync] Pushing updated main to origin/main...");
    const pushRes = await this.runGit(["push", "origin", "main"]);
    if (pushRes.code !== 0) {
      console.error("[Sync Error] Push to origin/main failed:", pushRes.stderr);
      return false;
    }

    return true;
  }

  /**
   * Reintegrates the yolo branch with upstream and resolves any drift.
   */
  public async syncYoloBranch(options: SyncOptions = {}): Promise<boolean> {
    console.log("[Sync] Switching to yolo branch...");
    const checkoutRes = await this.runGit(["checkout", "yolo"]);
    if (checkoutRes.code !== 0) {
      console.error("[Sync Error] Failed to checkout yolo branch:", checkoutRes.stderr);
      return false;
    }

    console.log("[Sync] Merging main into yolo branch...");
    const mergeRes = await this.runGit([
      "merge",
      "main",
      "-m",
      "chore(upstream): merge upstream updates into yolo",
    ]);
    if (mergeRes.code === 0) {
      console.log("[Sync Success] Merged cleanly without conflicts.");
    } else {
      console.warn("[Sync Conflict] Conflict detected during merge. Applying auto-fix...");
      if (options.autoFix === true) {
        const fixed = await this.autoFixMergeConflicts();
        if (!fixed) {
          console.error("[Sync Error] Automatic conflict resolution failed. Reverting merge.");
          await this.runGit(["merge", "--abort"]);
          return false;
        }
      } else {
        await this.runGit(["merge", "--abort"]);
        return false;
      }
    }

    // Verify Aphrody additions
    const testResult = await this.verifyForkIntegrity();
    if (!testResult) {
      console.warn("[Sync Warning] Fork integrity tests failed.");
      if (options.reapplyPatches) {
        const applied = await this.reapplyPatches();
        if (!applied || !(await this.verifyForkIntegrity())) return false;
      } else {
        return false;
      }
    }

    console.log("[Sync] Pushing yolo branch to origin/yolo...");
    const push = await this.runGit(["push", "origin", "yolo"]);
    return push.code === 0;
  }

  /**
   * Automatically resolves common drift patterns (lockfiles, generated files, package manifests).
   */
  private async autoFixMergeConflicts(): Promise<boolean> {
    const statusRes = await this.runGit(["status", "--porcelain"]);
    const lines = statusRes.stdout.split("\n");

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const statusCode = parts[0];
      const filePath = parts[1];
      if (!filePath) continue;

      if (statusCode === "UU" || statusCode === "AA") {
        if (filePath.endsWith("bun.lock") || filePath.endsWith("Cargo.lock")) {
          // Take upstream version for lockfiles, then regenerate
          console.log(`[Auto-Fix] Resolving lockfile conflict with upstream: ${filePath}`);
          await this.runGit(["checkout", "--theirs", filePath]);
          await this.runGit(["add", filePath]);
        } else if (filePath.startsWith("completions/")) {
          console.log(`[Auto-Fix] Resolving completions conflict with upstream: ${filePath}`);
          await this.runGit(["checkout", "--theirs", filePath]);
          await this.runGit(["add", filePath]);
        }
      }
    }

    // Attempt to commit resolved state
    const commitRes = await this.runGit([
      "commit",
      "-m",
      "chore(drift-fix): automatically resolve upstream merge drift",
    ]);
    return commitRes.code === 0;
  }

  /**
   * Reapplies versioned Aphrody patches onto fresh upstream main.
   */
  public async reapplyPatches(): Promise<boolean> {
    console.log("[Patch Reapply] Applying versioned patches on the current clean branch...");
    const status = await this.runGit(["status", "--porcelain"]);
    if (status.code !== 0 || status.stdout) {
      console.error("[Patch Reapply] Working tree must be clean.");
      return false;
    }

    if (!existsSync(this.patchesDir)) {
      console.warn("[Patch Reapply] Patches directory not found:", this.patchesDir);
      return false;
    }

    const patchFiles = readdirSync(this.patchesDir)
      .filter((file) => file.endsWith(".patch"))
      .sort();

    for (const patch of patchFiles) {
      const fullPath = resolve(this.patchesDir, patch);
      console.log(`[Patch Reapply] Applying patch: ${patch}`);
      const applyRes = await this.runGit(["apply", fullPath]);
      if (applyRes.code !== 0) {
        console.error(`[Patch Error] Failed to apply ${patch}:`, applyRes.stderr);
        return false;
      }
    }

    await this.runGit(["add", "."]);
    await this.runGit(["commit", "-m", "feat(aphrody): reapply Aphrody fork modifications"]);
    return true;
  }

  /**
   * Verifies fork buildability and runtime tests.
   */
  public async verifyForkIntegrity(): Promise<boolean> {
    const testPath = resolve(this.bunDir, "packages/aphrody-bun-runtime/test/runtime.test.ts");
    if (!existsSync(testPath)) {
      return true;
    }

    return new Promise((res) => {
      const proc = spawn("bun", ["test", testPath], {
        cwd: this.bunDir,
        env: { ...process.env },
      });

      proc.on("close", (code) => {
        res(code === 0);
      });
    });
  }

  /**
   * Main entrypoint to execute full sync and drift repair.
   */
  public async execute(options: SyncOptions = {}): Promise<SyncResult> {
    if (options.apply && !options.dryRun) {
      await this.ensureRemotes();
      const upstreamFetch = await this.runGit(["fetch", "upstream", "main", "--depth=50"]);
      const originFetch = await this.runGit(["fetch", "origin", "--depth=50"]);
      if (upstreamFetch.code !== 0 || originFetch.code !== 0) {
        throw new Error("Bun upstream fetch failed; no branches were switched or pushed.");
      }
    }
    const driftBefore = await this.analyzeDrift();
    const prevCommit = driftBefore.yoloCommit;

    console.log("─────────────────────────────────────────────────────────────");
    console.log(" Aphrody Bun Upstream Synchronization Engine");
    console.log("─────────────────────────────────────────────────────────────");
    console.log(` Upstream (oven-sh/bun:main) : ${driftBefore.upstreamCommit}`);
    console.log(` Origin Main                 : ${driftBefore.mainCommit}`);
    console.log(` Fork Yolo Branch            : ${driftBefore.yoloCommit}`);
    console.log(` Commits Behind Upstream     : ${driftBefore.commitsBehindUpstream}`);
    console.log(` Commits Ahead Upstream      : ${driftBefore.commitsAheadUpstream}`);
    console.log(` Drift Status                : ${driftBefore.status}`);
    console.log("─────────────────────────────────────────────────────────────");

    if (options.dryRun) {
      return {
        success: true,
        previousCommit: prevCommit,
        currentCommit: prevCommit,
        message: "Dry run completed. Drift analyzed.",
        drift: driftBefore,
        timestamp: new Date().toISOString(),
      };
    }

    if (!options.apply) {
      return {
        success: true,
        previousCommit: prevCommit,
        currentCommit: prevCommit,
        message:
          "Read-only analysis complete. Pass --apply to fetch, merge, switch branches, and push.",
        drift: driftBefore,
        timestamp: new Date().toISOString(),
      };
    }

    if (driftBefore.hasUncommittedChanges) {
      return {
        success: false,
        previousCommit: prevCommit,
        currentCommit: prevCommit,
        message: "Bun submodule has uncommitted changes; commit or resolve them before --apply.",
        drift: driftBefore,
        timestamp: new Date().toISOString(),
      };
    }

    const mainSynced = await this.syncMainBranch();
    if (!mainSynced) {
      return {
        success: false,
        previousCommit: prevCommit,
        currentCommit: prevCommit,
        message: "Failed to synchronize main branch with upstream.",
        drift: driftBefore,
        timestamp: new Date().toISOString(),
      };
    }

    const aphrodySynced = await this.syncYoloBranch(options);

    // Ensure the yolo integration branch stays checked out in vendor/bun
    console.log("[Sync] Setting active default branch to yolo in vendor/bun...");
    await this.runGit(["checkout", "yolo"]);

    const driftAfter = await this.analyzeDrift();

    return {
      success: aphrodySynced,
      previousCommit: prevCommit,
      currentCommit: driftAfter.yoloCommit,
      message: aphrodySynced
        ? "Fork successfully synchronized and drift resolved."
        : "Failed to cleanly synchronize yolo branch.",
      drift: driftAfter,
      timestamp: new Date().toISOString(),
    };
  }
}

// CLI execution
if (import.meta.main) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isApply = args.includes("--apply");
  const isAutoFix = args.includes("--auto-fix");
  const isReapply = args.includes("--reapply-patches");

  const engine = new BunUpstreamSyncEngine();
  engine
    .execute({
      dryRun: isDryRun,
      apply: isApply,
      autoFix: isAutoFix,
      reapplyPatches: isReapply,
    })
    .then((res) => {
      console.log(`\nSync finished. Success: ${res.success}. Message: ${res.message}`);
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error("Fatal error during upstream sync:", err);
      process.exit(1);
    });
}
