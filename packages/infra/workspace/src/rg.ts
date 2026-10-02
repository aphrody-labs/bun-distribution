import { existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { infraRoot } from "./runtime.ts";
import { runRustBridge } from "./bridges.ts";
import { scanImportsExports } from "./imports-exports.ts";
import { runDocsLinks } from "./docs-links.ts";

const RG_DOC_CATEGORIES = [
  "apis",
  "architecture",
  "decisions",
  "guides",
  "operations",
  "plans",
  "products",
  "reference",
  "research",
] as const;
import { buildDependencies, dependencyBuildPlan } from "./bun-dependency-builds.ts";

// This module is a CLI surface; console output is its documented interface.
// oxlint-disable no-console

const CHECKS = ["format", "lint", "typecheck", "test", "build"] as const;
type Check = (typeof CHECKS)[number];
const ROOTS = ["apps/rg", "packages/rg"] as const;
const SCRIPT_NAMES: Record<Check, string[]> = {
  format: ["format:check"],
  lint: ["lint"],
  typecheck: ["type-check", "typecheck"],
  test: ["test"],
  build: ["build"],
};
interface PackageInfo {
  name: string;
  path: string;
  scripts: Record<string, string>;
  tsconfigPath: string | null;
  hasSource: boolean;
  hasTests: boolean;
}

export interface RgDetailedPackage {
  name: string;
  subDomain: "achillea" | "azalee" | "rg-app" | "rg-patreon" | "rg-shared";
  version: string;
  private: boolean;
  description: string;
  path: string;
  absolutePath: string;
  type: string;
  main?: string;
  module?: string;
  types?: string;
  exports?: unknown;
  bin?: unknown;
  engines?: Record<string, string>;
  scripts: Record<string, string>;
  internalDependencies: Record<string, string>;
  externalDependencies: Record<string, { spec: string; resolved: string | null }>;
  devDependencies: Record<string, { spec: string; resolved: string | null }>;
  peerDependencies: Record<string, string>;
}

export interface RgInventorySummary {
  module: "rg";
  generatedAt: string;
  monorepoRoot: string;
  totalPackages: number;
  bySubDomain: Record<string, number>;
  packages: RgDetailedPackage[];
}

interface RootManifest {
  workspaces?: string[] | { packages?: string[] };
  catalog?: Record<string, string>;
}

export function rgRoots(root = infraRoot()): string[] {
  return ROOTS.map((path) => join(root, path));
}

export function isRootWorkspaceMember(root: string, path: string, patterns: string[]): boolean {
  const packagePath = relative(root, path).split("\\").join("/");
  if (!packagePath || packagePath === ".." || packagePath.startsWith("../")) return false;
  let included = false;
  for (const entry of patterns) {
    const negated = entry.startsWith("!");
    const pattern = (negated ? entry.slice(1) : entry).replace(/\/$/, "");
    if (new Bun.Glob(pattern).match(packagePath)) included = !negated;
  }
  return included;
}

async function manifests(root = infraRoot()): Promise<PackageInfo[]> {
  const rootManifest = (await Bun.file(join(root, "package.json")).json()) as RootManifest;
  const workspacePatterns = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : (rootManifest.workspaces?.packages ?? []);
  const found: PackageInfo[] = [];
  for (const workspace of rgRoots(root)) {
    // Preserve deterministic traversal while Bun's async Glob yields paths.
    // oxlint-disable-next-line no-await-in-loop
    for await (const manifestPath of new Bun.Glob("**/package.json").scan({
      cwd: workspace,
      absolute: true,
      onlyFiles: true,
    })) {
      const path = manifestPath.slice(0, -"/package.json".length);
      if (!isRootWorkspaceMember(root, path, workspacePatterns)) continue;
      const manifest = (await Bun.file(manifestPath).json()) as {
        name?: string;
        scripts?: Record<string, string>;
      };
      const tsconfigs = await Array.fromAsync(
        new Bun.Glob("tsconfig*.json").scan({ cwd: path, onlyFiles: true }),
      );
      const sourceFiles = await Array.fromAsync(
        new Bun.Glob("src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}").scan({
          cwd: path,
          onlyFiles: true,
        }),
      );
      const testFiles = await Array.fromAsync(
        new Bun.Glob("**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}").scan({
          cwd: path,
          onlyFiles: true,
        }),
      );
      found.push({
        name: manifest.name ?? relative(root, path),
        path,
        scripts: manifest.scripts ?? {},
        tsconfigPath: tsconfigs.includes("tsconfig.json")
          ? join(path, "tsconfig.json")
          : tsconfigs[0]
            ? join(path, tsconfigs[0])
            : null,
        hasSource: sourceFiles.length > 0,
        hasTests: testFiles.length > 0,
      });
    }
  }
  return found.toSorted((a, b) => a.name.localeCompare(b.name));
}

function display(packages: PackageInfo[]) {
  return packages.map(({ name, path, scripts, tsconfigPath, hasSource, hasTests }) => ({
    name,
    path,
    coverage: {
      format: Boolean(scripts["format:check"]) || hasSource,
      lint: Boolean(scripts.lint) || hasSource,
      typecheck: Boolean(scripts["type-check"] || scripts.typecheck) || Boolean(tsconfigPath),
      test: Boolean(scripts.test) || hasTests,
      build: Boolean(scripts.build),
    },
    scripts: Object.keys(scripts).toSorted(),
  }));
}

function checkCoverage(packages: PackageInfo[]) {
  return Object.fromEntries(
    CHECKS.map((check) => {
      const configured = packages
        .filter(
          (item) =>
            SCRIPT_NAMES[check].some((script) => item.scripts[script]) ||
            (check === "typecheck" && item.tsconfigPath) ||
            ((check === "format" || check === "lint") && item.hasSource) ||
            (check === "test" && item.hasTests),
        )
        .map(({ name }) => name);
      return [
        check,
        { configured: configured.length, total: packages.length, packages: configured },
      ];
    }),
  );
}

async function runCheck(
  check: Check,
  selected: PackageInfo[],
  root: string,
  dependenciesPrepared = false,
): Promise<number> {
  if (!dependenciesPrepared && ["typecheck", "test", "build"].includes(check)) {
    const code = await buildDependencies(
      root,
      selected.map((item) => item.name),
    );
    if (code !== 0) return code;
  }
  let status = 0;
  // Run package gates serially to avoid overloading the shared build host.
  // oxlint-disable-next-line no-await-in-loop
  for (const item of selected) {
    const script = SCRIPT_NAMES[check].find((candidate) => item.scripts[candidate]);
    if (!script) {
      if (check === "typecheck" && item.tsconfigPath) {
        console.error(`RG typecheck: ${item.name} (TypeScript CLI fallback)`);
        const child = Bun.spawn(
          [join(root, "node_modules/.bin/tsc"), "--noEmit", "--project", item.tsconfigPath],
          {
            cwd: item.path,
            stdout: "inherit",
            stderr: "inherit",
          },
        );
        // oxlint-disable-next-line no-await-in-loop
        const code = await child.exited;
        if (code !== 0 && status === 0) status = code;
      } else if (check === "format" && item.hasSource) {
        const child = Bun.spawn(
          [
            join(root, "node_modules/.bin/oxfmt"),
            "--check",
            "--config",
            join(root, "config/rg/oxfmt.json"),
            item.path,
          ],
          { cwd: root, stdout: "inherit", stderr: "inherit" },
        );
        // oxlint-disable-next-line no-await-in-loop
        const code = await child.exited;
        if (code !== 0 && status === 0) status = code;
      } else if (check === "lint" && item.hasSource) {
        const child = Bun.spawn(
          [
            join(root, "node_modules/.bin/oxlint"),
            "--config",
            join(root, "packages/rg/config/oxlintrc.json"),
            item.path,
          ],
          { cwd: root, stdout: "inherit", stderr: "inherit" },
        );
        // oxlint-disable-next-line no-await-in-loop
        const code = await child.exited;
        if (code !== 0 && status === 0) status = code;
      } else if (check === "test" && item.hasTests) {
        const child = Bun.spawn([process.execPath, "test", item.path], {
          cwd: root,
          stdout: "inherit",
          stderr: "inherit",
        });
        // oxlint-disable-next-line no-await-in-loop
        const code = await child.exited;
        if (code !== 0 && status === 0) status = code;
      } else if (
        check !== "build" &&
        status === 0 &&
        (check === "format" || check === "lint"
          ? item.hasSource
          : check === "test" && item.hasTests)
      ) {
        console.error(`RG ${check} gate missing: ${item.name}`);
        status = 1;
      }
      continue;
    }
    console.error(`RG ${check}: ${item.name} (${script})`);
    const child = Bun.spawn([process.execPath, "run", script], {
      cwd: item.path,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    // oxlint-disable-next-line no-await-in-loop
    const code = await child.exited;
    if (code !== 0 && status === 0) status = code;
  }
  return status;
}

async function n2bAudit(root: string): Promise<number> {
  const binary = process.env.N2B_BIN ?? Bun.which("n2b");
  if (!binary) {
    console.error("N2B unavailable; audit skipped on this runner.");
    return 0;
  }
  let errors = 0;
  for (const scope of ["apps/rg", "packages/rg"]) {
    const child = Bun.spawn(
      [
        binary,
        scope,
        "--report",
        "json",
        "--quiet",
        "--ignore",
        ".env",
        "--ignore",
        "**/.env*",
        "--ignore",
        "**/.npmrc",
      ],
      { cwd: root, stdout: "pipe", stderr: "ignore" },
    );
    // oxlint-disable-next-line no-await-in-loop
    const output = await new Response(child.stdout).text();
    // oxlint-disable-next-line no-await-in-loop
    const exitCode = await child.exited;
    let report: {
      files_scanned?: number;
      findings_total?: number;
      files?: Array<{ findings?: Array<{ severity?: string }> }>;
    };
    try {
      report = JSON.parse(output);
    } catch {
      console.error(`N2B returned an invalid report for ${scope} (exit ${exitCode}).`);
      errors++;
      continue;
    }
    const severities = { error: 0, warn: 0, info: 0 };
    for (const finding of report.files?.flatMap((file) => file.findings ?? []) ?? []) {
      if (finding.severity === "error") severities.error++;
      else if (finding.severity === "warn") severities.warn++;
      else if (finding.severity === "info") severities.info++;
    }
    errors += severities.error;
    console.log(
      JSON.stringify({
        audit: "n2b",
        scope,
        filesScanned: report.files_scanned ?? 0,
        findings: report.findings_total ?? 0,
        severities,
      }),
    );
  }
  return errors > 0 ? 1 : 0;
}

async function pipeline(root: string, dryRun: boolean): Promise<number> {
  const packages = await manifests(root);
  const tasks: Array<{ name: string; run: () => Promise<number> }> = [
    {
      name: "Bun frozen workspace install",
      run: async () =>
        (
          await Bun.spawn([process.execPath, "install", "--frozen-lockfile"], {
            cwd: root,
            stdout: "inherit",
            stderr: "inherit",
          })
        ).exited,
    },
    {
      name: "RG workspace dependency builds",
      run: () =>
        buildDependencies(
          root,
          packages.map((item) => item.name),
        ),
    },
    {
      name: "N2B Bun migration audit",
      run: () => n2bAudit(root),
    },
    {
      name: "RG import/export and dependency audit",
      run: async () => {
        const summary = await scanImportsExports(root);
        const rg = summary.packages.filter(
          (item) => item.path.startsWith("apps/rg/") || item.path.startsWith("packages/rg/"),
        );
        const findings = rg.flatMap((item) =>
          [...item.sourceUnmatchedDependencies, ...item.unlistedExternalImports].map(
            (message) => `${item.name}: ${message}`,
          ),
        );
        console.log(
          JSON.stringify(
            {
              packages: rg.length,
              sourceFiles: rg.reduce((n, item) => n + item.sourceFiles, 0),
              findings,
            },
            null,
            2,
          ),
        );
        return findings.length ? 1 : 0;
      },
    },
    ...CHECKS.map((check) => ({ name: check, run: () => runCheck(check, packages, root, true) })),
    {
      name: "RG documentation links",
      run: async () => {
        // RG documentation lives under docs/<category>/rg (CLAUDE.md layout).
        let status = 0;
        for (const category of RG_DOC_CATEGORIES) {
          const docs = join("docs", category, "rg");
          if (!existsSync(join(root, docs))) continue;
          // oxlint-disable-next-line no-await-in-loop -- Keep each category report contiguous.
          const result = await runDocsLinks(["--root", root, "--docs", docs, "--scope", "docs"]);
          status ||= result;
        }
        return status;
      },
    },
  ];
  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          module: "rg",
          packages: display(packages),
          coverage: checkCoverage(packages),
          stages: tasks.map(({ name }) => name),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  let status = 0;
  const results: Array<{
    stage: string;
    status: "passed" | "failed" | "skipped";
    exitCode?: number;
  }> = [];
  // Run stages in dependency order; later gates require the install stage.
  // oxlint-disable-next-line no-await-in-loop
  for (const task of tasks) {
    console.error(`\n=== RG pipeline: ${task.name} ===`);
    if (
      (task.name !== "Bun frozen workspace install" && results[0]?.status === "failed") ||
      (["typecheck", "test", "build"].includes(task.name) &&
        results.some(
          (result) =>
            result.stage === "RG workspace dependency builds" && result.status === "failed",
        ))
    ) {
      results.push({ stage: task.name, status: "skipped" });
      console.error("Skipped because a required workspace preparation stage failed.");
      continue;
    }
    try {
      // oxlint-disable-next-line no-await-in-loop
      const code = await task.run();
      results.push({ stage: task.name, status: code === 0 ? "passed" : "failed", exitCode: code });
      if (code !== 0 && status === 0) status = code;
    } catch (error) {
      console.error(error);
      results.push({ stage: task.name, status: "failed", exitCode: 1 });
      if (status === 0) status = 1;
    }
  }
  console.log(
    JSON.stringify(
      {
        module: "rg",
        status: status === 0 ? "passed" : "failed",
        packageCount: packages.length,
        coverage: checkCoverage(packages),
        results,
      },
      null,
      2,
    ),
  );
  return status;
}

export async function exportDetailedInventory(root = infraRoot()): Promise<RgInventorySummary> {
  const rootManifest = (await Bun.file(join(root, "package.json")).json()) as RootManifest;
  const workspacePatterns = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : (rootManifest.workspaces?.packages ?? []);
  const catalog = rootManifest.catalog ?? {};

  const packages: RgDetailedPackage[] = [];

  for (const workspace of rgRoots(root)) {
    // oxlint-disable-next-line no-await-in-loop
    for await (const manifestPath of new Bun.Glob("**/package.json").scan({
      cwd: workspace,
      absolute: true,
      onlyFiles: true,
    })) {
      const path = manifestPath.slice(0, -"/package.json".length);
      if (!isRootWorkspaceMember(root, path, workspacePatterns)) continue;
      // oxlint-disable-next-line no-await-in-loop
      const pkg = (await Bun.file(manifestPath).json()) as Record<string, any>;
      const relPath = relative(root, path);

      const internalDeps: Record<string, string> = {};
      const externalDeps: Record<string, { spec: string; resolved: string | null }> = {};
      const devDeps: Record<string, { spec: string; resolved: string | null }> = {};
      const peerDeps: Record<string, string> = {};

      for (const [dep, spec] of Object.entries(pkg.dependencies ?? {})) {
        const specStr = String(spec);
        if (specStr.startsWith("workspace:") || specStr.startsWith("file:")) {
          internalDeps[dep] = specStr;
        } else if (specStr.startsWith("catalog:")) {
          const catKey = specStr.slice("catalog:".length);
          externalDeps[dep] = { spec: specStr, resolved: catalog[catKey] ?? null };
        } else {
          externalDeps[dep] = { spec: specStr, resolved: specStr };
        }
      }

      for (const [dep, spec] of Object.entries(pkg.devDependencies ?? {})) {
        const specStr = String(spec);
        if (specStr.startsWith("workspace:") || specStr.startsWith("file:")) {
          internalDeps[dep] = specStr;
        } else if (specStr.startsWith("catalog:")) {
          const catKey = specStr.slice("catalog:".length);
          devDeps[dep] = { spec: specStr, resolved: catalog[catKey] ?? null };
        } else {
          devDeps[dep] = { spec: specStr, resolved: specStr };
        }
      }

      for (const [dep, spec] of Object.entries(pkg.peerDependencies ?? {})) {
        peerDeps[dep] = String(spec);
      }

      let subDomain: "achillea" | "azalee" | "rg-app" | "rg-patreon" | "rg-shared" = "rg-shared";
      if (pkg.name?.includes("achillea") || relPath.includes("achillea")) {
        subDomain = "achillea";
      } else if (pkg.name?.includes("azalee") || relPath.includes("azalee")) {
        subDomain = "azalee";
      } else if (relPath.startsWith("apps/rg/")) {
        subDomain = "rg-app";
      } else if (pkg.name?.includes("patreon") || relPath.includes("patreon")) {
        subDomain = "rg-patreon";
      }

      packages.push({
        name: pkg.name ?? relPath,
        subDomain,
        version: pkg.version ?? "0.0.0",
        private: pkg.private ?? false,
        description: pkg.description ?? "",
        path: relPath,
        absolutePath: path,
        type: pkg.type ?? "commonjs",
        main: pkg.main,
        module: pkg.module,
        types: pkg.types ?? pkg.typings,
        exports: pkg.exports,
        bin: pkg.bin,
        engines: pkg.engines,
        scripts: pkg.scripts ?? {},
        internalDependencies: internalDeps,
        externalDependencies: externalDeps,
        devDependencies: devDeps,
        peerDependencies: peerDeps,
      });
    }
  }

  packages.sort((a, b) => a.name.localeCompare(b.name));

  const bySubDomain = packages.reduce(
    (acc, p) => {
      acc[p.subDomain] = (acc[p.subDomain] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return {
    module: "rg",
    generatedAt: new Date().toISOString(),
    monorepoRoot: root,
    totalPackages: packages.length,
    bySubDomain,
    packages,
  };
}

/** RG command facade: validation is explicit and releases are delegated to Aphrody Infra. */
export async function runRg(args: string[], root = infraRoot()): Promise<number> {
  const [action = "status", ...rest] = args;
  if (action === "status") {
    const packages = await manifests(root);
    console.log(
      JSON.stringify(
        {
          module: "rg",
          roots: rgRoots(root),
          packageCount: packages.length,
          packages: display(packages),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (action === "inventory") {
    const summary = await exportDetailedInventory(root);
    const outIndex = rest.indexOf("--out");
    const outPath = outIndex === -1 ? undefined : rest[outIndex + 1];
    if (outPath) {
      const targetPath = resolve(root, outPath);
      await Bun.write(targetPath, JSON.stringify(summary, null, 2) + "\n");
      console.log(`Inventory of ${summary.totalPackages} packages written to ${targetPath}`);
    } else {
      console.log(JSON.stringify(summary, null, 2));
    }
    return 0;
  }
  if (action === "prepare") {
    if (rest.some((arg) => arg !== "--dry-run"))
      throw new Error("usage: aphrody-ops rg prepare [--dry-run]");
    const packages = await manifests(root);
    const consumers = packages.map((item) => item.name);
    if (rest.includes("--dry-run")) {
      console.log(JSON.stringify(await dependencyBuildPlan(resolve(root), consumers), null, 2));
      return 0;
    }
    return buildDependencies(resolve(root), consumers);
  }
  if (action === "pipeline") {
    if (rest.some((arg) => arg !== "--dry-run"))
      throw new Error("usage: aphrody-ops rg pipeline [--dry-run]");
    return pipeline(resolve(root), rest.includes("--dry-run"));
  }
  if (action === "check") {
    const [check, ...options] = rest;
    const packages = await manifests(root);
    if (check === "all") {
      if (options.length) throw new Error("usage: aphrody-ops rg check all");
      const preparationCode = await buildDependencies(
        resolve(root),
        packages.map((item) => item.name),
      );
      if (preparationCode !== 0) return preparationCode;
      let status = 0;
      // oxlint-disable-next-line no-await-in-loop
      for (const item of CHECKS) {
        // oxlint-disable-next-line no-await-in-loop
        const code = await runCheck(item, packages, resolve(root), true);
        if (code !== 0 && status === 0) status = code;
      }
      return status;
    }
    if (!CHECKS.includes(check as Check))
      throw new Error(`usage: aphrody-ops rg check <all|${CHECKS.join("|")}> [--package <name>]`);
    let selected = packages;
    const packageIndex = options.indexOf("--package");
    if (packageIndex !== -1) {
      const name = options[packageIndex + 1];
      if (!name || options.length !== 2)
        throw new Error("usage: aphrody-ops rg check <check> [--package <name>]");
      selected = selected.filter((item) => item.name === name || item.name.endsWith(`/${name}`));
      if (!selected.length) throw new Error(`unknown RG package: ${name}`);
    } else if (options.length)
      throw new Error("usage: aphrody-ops rg check <check> [--package <name>]");
    return runCheck(check as Check, selected, resolve(root));
  }
  if (action === "deploy") {
    const targetIndex = rest.indexOf("--target");
    const target = targetIndex < 0 ? undefined : rest[targetIndex + 1];
    const apply = rest.includes("--apply");
    if (
      !target ||
      rest.some((arg, index) =>
        arg === "--target" ? index !== targetIndex : index !== targetIndex + 1 && arg !== "--apply",
      )
    )
      throw new Error("usage: aphrody-ops rg deploy --target <infra-target> [--apply]");
    return runRustBridge(
      "aphrody-infra",
      ["deploy", "--stack", "rg", "--target", target, ...(apply ? ["--apply"] : [])],
      { stdout: "inherit", stderr: "inherit" },
    );
  }
  if (action === "migrate") {
    const [operation = "inventory", ...options] = rest;
    const map: Record<string, string> = {
      inventory: "inventory",
      scripts: "scripts-import",
      docs: "docs-import",
      infra: "infra-scripts-import",
    };
    const targetRoot = resolve(root);
    const sourceRoot = resolve(targetRoot, ".");
    if (!map[operation])
      throw new Error("usage: aphrody-ops rg migrate <inventory|scripts|docs|infra>");
    if (options.length)
      throw new Error("RG migration paths are resolved from the Aphrody workspace configuration");
    const command = join(targetRoot, "packages/infra/workspace/src/ops.ts");
    return (
      await Bun.spawn(
        [
          process.execPath,
          command,
          "consolidation",
          map[operation]!,
          "--source-root",
          sourceRoot,
          "--aphrody-root",
          targetRoot,
        ],
        { cwd: targetRoot, stdout: "inherit", stderr: "inherit", stdin: "inherit" },
      )
    ).exited;
  }
  throw new Error(
    "usage: aphrody-ops rg <status|inventory|prepare|pipeline|check|deploy|migrate> ...",
  );
}
