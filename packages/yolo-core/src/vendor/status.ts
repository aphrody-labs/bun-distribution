/**
 * Monorepo submodules, vendor.lock tracking, and Cargo workspace status inspector.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { yoloHome } from "../vfs/home";
import { readWorkspaceCargo, type WorkspaceCargoSummary } from "./cargo";

export interface SubmoduleStatus {
  readonly name: string;
  readonly path: string;
  readonly exists: boolean;
  readonly headCommit?: string | undefined;
  readonly filesCount?: number | undefined;
  readonly hash?: string | undefined;
}

export interface VendorSourceStatus {
  readonly name: string;
  readonly lockedSha: string;
  readonly headSha: string | undefined;
  readonly inSync: boolean;
}

export interface StatusReport {
  readonly schema: "yolo.status/1";
  readonly timestamp: string;
  readonly root: string;
  readonly packages: readonly SubmoduleStatus[];
  readonly vendor: {
    crates: number;
    sources: readonly VendorSourceStatus[];
  } | null;
  readonly cargo: WorkspaceCargoSummary | null;
}

/** The git directory of a checkout: `.git` is a directory, or a `gitdir:` file for a submodule. */
export async function resolveGitDir(worktree: string): Promise<string> {
  const dotGit = resolve(worktree, ".git");
  if (!existsSync(dotGit)) return dotGit;
  if (!statSync(dotGit).isFile()) return dotGit;
  const pointer = (await Bun.file(dotGit).text()).trim().replace(/^gitdir:\s*/, "");
  return resolve(worktree, pointer);
}

/** Git object id (SHA-1 or SHA-256), lower-cased; undefined for any other text. */
const oid = (text: string): string | undefined =>
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(text) ? text.toLowerCase() : undefined;

/** Resolve full HEAD through loose/packed refs and the common directory of a linked worktree. */
export async function readGitHead(worktree: string): Promise<string | undefined> {
  const gitDir = await resolveGitDir(worktree);
  const commonFile = Bun.file(join(gitDir, "commondir"));
  const commonDir = (await commonFile.exists()) ? resolve(gitDir, (await commonFile.text()).trim()) : gitDir;
  const resolveRef = async (value: string, depth: number): Promise<string | undefined> => {
    const direct = oid(value);
    if (direct) return direct;
    if (depth > 8 || !value.startsWith("ref:")) return undefined;
    const ref = value.slice(4).trim();
    if (
      !ref.startsWith("refs/") ||
      ref.includes("\\") ||
      ref.split("/").some(part => !part || part === "." || part === "..")
    )
      return undefined;
    // Candidate locations are read concurrently, then consulted in precedence order (gitDir, then commonDir).
    const looseTexts = await Promise.all(
      [...new Set([gitDir, commonDir])].map(async dir => {
        const loose = Bun.file(join(dir, ref));
        return (await loose.exists()) ? loose.text() : undefined;
      }),
    );
    const looseText = looseTexts.find(text => text !== undefined);
    if (looseText !== undefined) return resolveRef(looseText.trim(), depth + 1);
    const packedTexts = await Promise.all(
      [...new Set([commonDir, gitDir])].map(async dir => {
        const packed = Bun.file(join(dir, "packed-refs"));
        return (await packed.exists()) ? packed.text() : undefined;
      }),
    );
    for (const packedText of packedTexts) {
      if (packedText === undefined) continue;
      for (const line of packedText.split("\n")) {
        const split = line.trim().split(/\s+/);
        if (split[1] === ref && split[0]) return oid(split[0]);
      }
    }
    return undefined;
  };
  const head = Bun.file(join(gitDir, "HEAD"));
  return (await head.exists()) ? resolveRef((await head.text()).trim(), 0) : undefined;
}

/**
 * Regular files below `dir`, dot entries skipped, counted until `limit` is exceeded (the result is then `limit + 1`).
 * Replaces a recursive `Bun.Glob` scan that took 55 ms on `vendor/next` to find the first 250 files. Throws when `dir`
 * itself cannot be read; unreadable subdirectories are skipped.
 */
function countFiles(dir: string, limit: number): number {
  let count = 0;
  const stack = [dir];
  let root = true;
  while (stack.length > 0 && count <= limit) {
    const current = stack.pop() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      if (root) throw error;
      continue;
    }
    root = false;
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) stack.push(join(current, entry.name));
      else if (entry.isFile() && ++count > limit) break;
    }
  }
  return count;
}

/**
 * Inspect monorepo submodules and forks using Bun file I/O & wyhash checksums.
 */
export async function inspectPackages(vendorDir?: string): Promise<readonly SubmoduleStatus[]> {
  const vDir = vendorDir ?? resolve(yoloHome(), "vendor");
  const catalog = Bun.file(resolve(vDir, "../tools/config/vendor.json"));
  const pkgs: string[] = (await catalog.exists())
    ? ((await catalog.json()) as { sources: { name: string }[] }).sources.map(source => source.name)
    : existsSync(vDir)
      ? readdirSync(vDir, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
          .map(entry => entry.name)
          .toSorted()
      : [];
  // Each package is independent local I/O; results keep the catalog order of Promise.all.
  return Promise.all(
    pkgs.map(async (name): Promise<SubmoduleStatus> => {
      const pkgPath = resolve(vDir, name);
      if (!existsSync(pkgPath)) return { name, path: pkgPath, exists: false };

      let headCommit: string | undefined;
      try {
        headCommit = await readGitHead(pkgPath);
      } catch {
        // Fallback if git dir is not reachable
      }

      let filesCount: number | undefined;
      try {
        filesCount = countFiles(pkgPath, 250);
      } catch {
        // Ignore counting failure
      }

      return {
        name,
        path: pkgPath,
        exists: true,
        headCommit,
        filesCount,
      };
    }),
  );
}

/** Compares `vendor.lock` with the current HEAD of each vendored submodule. */
export async function readVendorStatus(
  rootDir: string = yoloHome(),
  inspected?: readonly SubmoduleStatus[],
): Promise<{
  crates: number;
  sources: readonly VendorSourceStatus[];
} | null> {
  const lockFile = Bun.file(resolve(rootDir, "vendor.lock"));
  if (!(await lockFile.exists())) return null;
  const lock = (await lockFile.json()) as {
    sources: { name: string; sha: string }[];
    crates: unknown[];
  };
  const pkgs = inspected ?? (await inspectPackages(resolve(rootDir, "vendor")));
  return {
    crates: lock.crates.length,
    sources: lock.sources.map(source => {
      const headSha = pkgs.find(p => p.name === source.name)?.headCommit;
      return {
        name: source.name,
        lockedSha: source.sha,
        headSha,
        inSync: headSha !== undefined && source.sha.toLowerCase() === headSha,
      };
    }),
  };
}

export async function collectStatusReport(rootDir: string = yoloHome()): Promise<StatusReport> {
  // Inspect the submodules once: the vendor comparison reuses the result instead of scanning them a second time.
  const packages = await inspectPackages(resolve(rootDir, "vendor"));
  const [vendor, cargo] = await Promise.all([readVendorStatus(rootDir, packages), readWorkspaceCargo(rootDir)]);
  return {
    schema: "yolo.status/1",
    timestamp: new Date().toISOString(),
    root: rootDir,
    packages,
    vendor,
    cargo,
  };
}

export function renderStatusMarkdown(report: StatusReport): string {
  const lines = [
    `# yolo status`,
    "",
    `**Root:** \`${report.root}\``,
    "",
    "## Submodule Forks (`vendor/`)",
    "",
    "| Submodule | Status | Commit | Files |",
    "| :--- | :--- | :--- | ---: |",
  ];

  for (const p of report.packages) {
    const status = p.exists ? "✔ loaded" : "✘ missing";
    const commit = p.headCommit ? `\`${p.headCommit}\`` : "-";
    const count = p.filesCount !== undefined ? `~${p.filesCount}+` : "-";
    lines.push(`| \`vendor/${p.name}\` | ${status} | ${commit} | ${count} |`);
  }

  if (report.vendor) {
    lines.push(
      "",
      "## Vendored Crates (`vendor.lock`)",
      "",
      `- **Total Crates:** ${report.vendor.crates} imported into \`crates/aphrody-*\``,
      "",
      "| Source | Locked SHA | Status |",
      "| :--- | :--- | :--- |",
    );
    for (const s of report.vendor.sources) {
      const syncStatus = s.inSync ? "✔ in sync" : "⚠ drift";
      lines.push(`| \`${s.name}\` | \`${s.lockedSha.slice(0, 10)}\` | ${syncStatus} |`);
    }
  }

  if (report.cargo) {
    lines.push(
      "",
      "## Cargo Workspace Config",
      "",
      `- **Resolver:** v${report.cargo.resolver}`,
      `- **Members:** ${report.cargo.members.join(", ")}`,
      `- **Default Members:** ${report.cargo.defaultMembers?.join(", ") ?? "Cargo implicit selection"}`,
      `- **Release Profile:** opt-level=${String(report.cargo.releaseProfile["opt-level"] ?? "z")}, strip=${String(report.cargo.releaseProfile["strip"] ?? true)}`,
    );
  }

  return lines.join("\n");
}
