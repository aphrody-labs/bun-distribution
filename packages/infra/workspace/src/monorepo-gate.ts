// SPDX-License-Identifier: Apache-2.0
import { realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { firstPartyManifests } from "./bun-workspace.ts";

export type WorkspacePackage = {
  name: string;
  path: string;
  scripts: Record<string, string>;
};
export type GateCheck = {
  name: string;
  command: string[];
  cwd: string;
  script?: string;
};
export type GateGap = { path: string; check: string; reason: string };
export type MonorepoGatePlan = {
  root: string;
  packages: WorkspacePackage[];
  checks: GateCheck[];
  gaps: GateGap[];
};
export type GateResult = {
  name: string;
  command: string[];
  cwd: string;
  status: "passed" | "failed";
  exitCode: number | null;
  durationMs: number;
  error?: string;
};
export type GateRunner = (check: GateCheck) => Promise<number>;

const PACKAGE_CHECKS = {
  typecheck: ["typecheck", "type-check"],
  lint: ["lint"],
  format: ["format:check"],
  test: ["test"],
  build: ["build"],
} as const;

/** Plan every declared member, independently of root scripts that may only check a wrapper. */
export function buildMonorepoGatePlan(input: {
  root: string;
  packages: WorkspacePackage[];
  rootScripts: Record<string, string>;
  hasCargoManifest: boolean;
  hasCargoLock: boolean;
  hasBunLock: boolean;
  docsScript?: string;
  gaps?: GateGap[];
}): MonorepoGatePlan {
  const root = resolve(input.root);
  const gaps = [...(input.gaps ?? [])];
  const checks: GateCheck[] = [];
  const add = (name: string, command: string[]) => checks.push({ name, command, cwd: root });
  if (!input.hasCargoManifest)
    gaps.push({ path: "Cargo.toml", check: "rust", reason: "Rust workspace manifest missing" });
  else {
    if (!input.hasCargoLock)
      gaps.push({ path: "Cargo.lock", check: "lockfile", reason: "Rust lockfile missing" });
    add("Rust formatting", ["cargo", "fmt", "--all", "--check"]);
    add("Rust all-target check", ["cargo", "check", "--workspace", "--all-targets", "--locked"]);
    add("Rust Clippy", [
      "cargo",
      "clippy",
      "--workspace",
      "--all-targets",
      "--locked",
      "--",
      "-D",
      "warnings",
    ]);
    add("Rust all-target tests", ["cargo", "test", "--workspace", "--all-targets", "--locked"]);
    add("Rust documentation tests", ["cargo", "test", "--workspace", "--doc", "--locked"]);
    add("Rust release build", [
      "cargo",
      "build",
      "--workspace",
      "--all-targets",
      "--release",
      "--locked",
    ]);
  }
  if (!input.hasBunLock)
    gaps.push({ path: "bun.lock", check: "lockfile", reason: "Bun lockfile missing" });
  // Install first so package scripts run against the actual frozen root dependency graph.
  checks.unshift({
    name: "Frozen Bun install",
    command: ["bun", "install", "--frozen-lockfile"],
    cwd: root,
  });
  if (!input.packages.length)
    gaps.push({
      path: "package.json",
      check: "workspace",
      reason: "No declared Bun workspace members discovered",
    });
  const names = new Set<string>();
  for (const pkg of input.packages.toSorted((a, b) => a.path.localeCompare(b.path))) {
    if (names.has(pkg.name))
      gaps.push({
        path: pkg.path,
        check: "workspace",
        reason: `Duplicate package name ${pkg.name}`,
      });
    names.add(pkg.name);
    for (const [kind, aliases] of Object.entries(PACKAGE_CHECKS)) {
      const script = aliases.find((name) => pkg.scripts[name]?.trim());
      if (!script) {
        gaps.push({
          path: pkg.path,
          check: kind,
          reason: `Missing package script: ${aliases.join(" or ")}`,
        });
        continue;
      }
      const body = pkg.scripts[script]!.trim();
      if (/^(?:echo\b[^;&|]*|true|exit\s+0)\s*;?$/.test(body)) {
        gaps.push({
          path: pkg.path,
          check: kind,
          reason: `Package script ${script} is a placeholder: ${body}`,
        });
        continue;
      }
      checks.push({
        name: `${pkg.name}: ${kind}`,
        command: ["bun", "run", script],
        cwd: resolve(root, pkg.path),
        script: body,
      });
    }
  }
  const docsScript =
    input.docsScript ?? ["docs:check", "docs:check-links"].find((name) => input.rootScripts[name]);
  if (!docsScript || !input.rootScripts[docsScript]?.trim())
    gaps.push({
      path: "package.json",
      check: "documentation",
      reason: docsScript
        ? `Missing root script: ${docsScript}`
        : "Missing root docs:check or docs:check-links script",
    });
  else if (/^(?:echo\b[^;&|]*|true|exit\s+0)\s*;?$/.test(input.rootScripts[docsScript]!.trim()))
    gaps.push({
      path: "package.json",
      check: "documentation",
      reason: `Root script ${docsScript} is a placeholder`,
    });
  else
    checks.push({
      name: "Documentation links",
      command: ["bun", "run", docsScript],
      cwd: root,
      script: input.rootScripts[docsScript],
    });
  return { root, packages: input.packages, checks, gaps };
}

export async function discoverMonorepoGatePlan(
  rootPath: string,
  docsScript?: string,
): Promise<MonorepoGatePlan> {
  const root = await realpath(resolve(rootPath));
  const manifest = (await Bun.file(join(root, "package.json")).json()) as {
    scripts?: Record<string, string>;
    workspaces?: string[] | { packages?: string[] };
  };
  const patterns = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : (manifest.workspaces?.packages ?? []);
  const safePatterns = patterns.filter((entry) => {
    const pattern = entry.replace(/^!/, "");
    return !/^(?:[a-zA-Z]:|[/\\])/.test(pattern) && !pattern.split(/[\\/]/).includes("..");
  });
  const selectedManifests = new Set(await firstPartyManifests(root, safePatterns));
  const excludedPatterns = patterns
    .filter((entry) => entry.startsWith("!"))
    .map((entry) => new Bun.Glob(`${entry.slice(1).replace(/\/$/, "")}/package.json`));
  const packages: WorkspacePackage[] = [];
  const gaps: GateGap[] = [];
  const discovered = new Set<string>();
  for (const pattern of patterns.filter((entry) => !entry.startsWith("!"))) {
    if (!safePatterns.includes(pattern)) {
      gaps.push({
        path: pattern,
        check: "workspace",
        reason: "Workspace pattern escapes repository",
      });
      continue;
    }
    let matches = 0;
    for await (const path of new Bun.Glob(`${pattern.replace(/\/$/, "")}/package.json`).scan({
      cwd: root,
      onlyFiles: true,
      followSymlinks: false,
    })) {
      const directory = dirname(path);
      matches++;
      if (!selectedManifests.has(path)) {
        if (!excludedPatterns.some((excluded) => excluded.match(path)))
          gaps.push({
            path,
            check: "workspace",
            reason: "Declared upstream member requires its own qualified gate",
          });
        continue;
      }
      if (discovered.has(path)) continue;
      discovered.add(path);
      const resolvedManifest = await realpath(join(root, path));
      const destination = relative(root, resolvedManifest);
      if (
        destination === ".." ||
        destination.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
      ) {
        gaps.push({
          path,
          check: "workspace",
          reason: "Workspace manifest resolves outside repository",
        });
        continue;
      }
      const pkg = (await Bun.file(resolvedManifest).json()) as {
        name?: string;
        scripts?: Record<string, string>;
      };
      if (!pkg.name) gaps.push({ path, check: "workspace", reason: "Package name missing" });
      packages.push({
        name: pkg.name ?? directory,
        path: directory.replaceAll("\\", "/"),
        scripts: pkg.scripts ?? {},
      });
    }
    if (!matches)
      gaps.push({
        path: pattern,
        check: "workspace",
        reason: "Declared workspace pattern has no package manifests",
      });
  }
  return buildMonorepoGatePlan({
    root,
    packages,
    rootScripts: manifest.scripts ?? {},
    docsScript,
    gaps,
    hasCargoManifest: await Bun.file(join(root, "Cargo.toml")).exists(),
    hasCargoLock: await Bun.file(join(root, "Cargo.lock")).exists(),
    hasBunLock: await Bun.file(join(root, "bun.lock")).exists(),
  });
}

/** Collect every command failure; missing coverage can never produce a successful gate. */
export async function executeMonorepoGate(
  plan: MonorepoGatePlan,
  runner: GateRunner,
): Promise<{ passed: boolean; results: GateResult[] }> {
  const results: GateResult[] = [];
  for (const check of plan.checks) {
    const started = performance.now();
    try {
      const exitCode = await runner(check);
      results.push({
        name: check.name,
        command: check.command,
        cwd: check.cwd,
        status: exitCode === 0 ? "passed" : "failed",
        exitCode,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      results.push({
        name: check.name,
        command: check.command,
        cwd: check.cwd,
        status: "failed",
        exitCode: null,
        durationMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    passed: !plan.gaps.length && results.every((result) => result.status === "passed"),
    results,
  };
}

export async function runMonorepoGate(args: string[]): Promise<number> {
  let root = process.cwd();
  let docsScript: string | undefined;
  let planOnly = false;
  let json = false;
  let timeoutSeconds = 1200;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root" || arg === "--docs-script" || arg === "--timeout-seconds") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--root") root = value;
      else if (arg === "--docs-script") docsScript = value;
      else timeoutSeconds = Number(value);
    } else if (arg === "--plan") planOnly = true;
    else if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: aphrody-ops monorepo-gate [--root <repository>] [--docs-script <bun-script>] [--plan] [--json] [--timeout-seconds <positive integer>]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1)
    throw new Error("--timeout-seconds must be a positive integer");
  const plan = await discoverMonorepoGatePlan(root, docsScript);
  if (planOnly) {
    console.log(JSON.stringify({ status: "planned", executed: false, ...plan }, null, 2));
    return plan.gaps.length ? 1 : 0;
  }
  const report = await executeMonorepoGate(plan, async (check) => {
    console.error(`Checking ${check.name}`);
    const child = Bun.spawn(check.command, {
      cwd: check.cwd,
      stdin: "ignore",
      stdout: json ? "pipe" : "inherit",
      stderr: "inherit",
      timeout: timeoutSeconds * 1000,
      killSignal: "SIGKILL",
    });
    if (json && child.stdout) {
      const [exitCode] = await Promise.all([
        child.exited,
        (async () => {
          const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              await new Promise<void>((resolveWrite, rejectWrite) => {
                process.stderr.write(value, (error) =>
                  error ? rejectWrite(error) : resolveWrite(),
                );
              });
            }
          } finally {
            reader.releaseLock();
          }
        })(),
      ]);
      return exitCode;
    }
    return await child.exited;
  });
  if (json) console.log(JSON.stringify({ ...plan, executed: true, ...report }, null, 2));
  else {
    for (const gap of plan.gaps) console.error(`GAP ${gap.path}: ${gap.check}: ${gap.reason}`);
    for (const result of report.results)
      console.log(
        `${result.status.toUpperCase()} ${result.name}${result.error ? `: ${result.error}` : ""}`,
      );
    console.log(`Monorepo quality gate: ${report.passed ? "PASS" : "FAILED"}`);
  }
  return report.passed ? 0 : 1;
}

if (import.meta.main) process.exit(await runMonorepoGate(process.argv.slice(2)));
