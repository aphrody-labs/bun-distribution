#!/usr/bin/env bun
// Load only the selected operation so unrelated products do not own its dependencies.
import type { PackageOperation } from "./packages.ts";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [operation, ...rest] = process.argv.slice(2);
if (operation === "jan-absorption") {
  process.exit(await (await import("./jan-absorption.ts")).runJanAbsorption(rest));
}
if (operation === "optimize") {
  process.exit(await (await import("./optimize.ts")).runOptimize(rest));
}
if (operation === "path-audit") {
  process.exit(await (await import("./path-audit.ts")).runPathAudit(rest));
}
if (operation === "plugins" || operation === "agent-plugins") {
  process.exit(await (await import("./agent-plugins.ts")).runAgentPlugins(rest));
}
if (operation === "build-factory") {
  process.exit(await (await import("./build-factory.ts")).runBuildFactory(rest));
}
if (operation === "cli-help") {
  process.exit(await (await import("./cli-help.ts")).runCliHelp(rest));
}
if (operation === "docs") {
  process.exit(await (await import("./documentation.ts")).runDocumentation(rest));
}
if (operation === "discord") {
  process.exit(await (await import("./discord.ts")).runDiscord(rest));
}
if (operation === "agent-sync") {
  process.exit(await (await import("./agent-sync.ts")).runAgentSync(rest));
}
if (operation === "agent-live") {
  process.exit(await (await import("./agent-live.ts")).runAgentLive(rest));
}
if (operation === "agent-home-drive-sync" || operation === "drive-sync") {
  const task = Bun.spawn(
    [process.execPath, join(import.meta.dir, "agent-home-drive-sync.ts"), ...rest],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  process.exit(await task.exited);
}
if (operation === "web-migration") {
  process.exit(await (await import("./web-migration.ts")).runWebMigration(rest));
}
if (operation === "consolidation") {
  process.exit(await (await import("./consolidation.ts")).runConsolidation(rest));
}
if (operation === "rg") {
  process.exit(await (await import("./rg.ts")).runRg(rest));
}
if (operation === "shenron") {
  process.exit(await (await import("./shenron.ts")).runShenron(rest));
}
if (operation === "bridge") {
  const [bridgeOperation, ...bridgeArgs] = rest;
  if (!bridgeOperation || bridgeOperation === "status") {
    if (bridgeArgs.length > 0)
      throw new Error("usage: aphrody-ops bridge [status|rust <binary> [arguments...]]");
    console.log(
      JSON.stringify(await (await import("./bridges.ts")).loadAphrodyBridgeCatalog(), null, 2),
    );
    process.exit(0);
  }
  if (bridgeOperation !== "rust") {
    throw new Error("usage: aphrody-ops bridge [status|rust <binary> [arguments...]]");
  }
  const [binary, ...args] = bridgeArgs;
  if (!binary) throw new Error("usage: aphrody-ops bridge rust <aphrody-binary> [arguments...]");
  process.exit(
    await (
      await import("./bridges.ts")
    ).runRustBridge(binary, args, { stdout: "inherit", stderr: "inherit" }),
  );
}
if (operation === "iecode-sync") {
  const entry = new URL("../../../../scripts/nie/sync-main.ts", import.meta.url);
  const child = Bun.spawn([process.execPath, fileURLToPath(entry), ...rest], {
    cwd: process.cwd(),
    env: { ...process.env, IECODE_REPO_ROOT: process.env.IECODE_REPO_ROOT ?? process.cwd() },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await child.exited);
}
if (operation === "infra") {
  process.exit(
    await (
      await import("./bridges.ts")
    ).runRustBridge("aphrody-infra", rest, { stdout: "inherit", stderr: "inherit" }),
  );
}
if (operation === "infra-audit")
  process.exit(await (await import("./infra-audit.ts")).runInfraAudit(rest));
if (operation === "orchestrate") {
  const [action = "status", ...args] = rest;
  const usesTarget = action !== "catalog";
  const target = usesTarget && !args.includes("--target") ? ["--target", "local"] : [];
  process.exit(
    await (
      await import("./bridges.ts")
    ).runRustBridge("aphrody-infra", ["service", action, ...args, ...target], {
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
}
if (operation === "audit-scripts") {
  const index = rest.indexOf("--repo");
  const repo = index === -1 ? undefined : rest[index + 1];
  if (!repo || rest.length !== 2) throw new Error("usage: aphrody-ops audit-scripts --repo <name>");
  await (await import("./audit-scripts.ts")).runScriptAudit(repo);
  process.exit(0);
}
if (operation === "imports-exports") {
  const rootIndex = rest.indexOf("--root");
  const root = rootIndex === -1 ? process.cwd() : rest[rootIndex + 1];
  if (!root || root.startsWith("--"))
    throw new Error(
      "usage: aphrody-ops imports-exports [--root <repository>] [--workspace <name-or-path>] [--json]",
    );
  const args =
    rootIndex === -1
      ? rest
      : rest.filter((_, index) => index !== rootIndex && index !== rootIndex + 1);
  await (await import("./imports-exports.ts")).runImportsExports(args, root);
  process.exit(0);
}
if (operation === "monorepo-gate") {
  process.exit(await (await import("./monorepo-gate.ts")).runMonorepoGate(rest));
}
if (operation === "cargo-package-repair") {
  process.exit(await (await import("./cargo-package-repair.ts")).runCargoPackageRepair(rest));
}
if (operation === "cargo-release-audit") {
  process.exit(await (await import("./cargo-release-audit.ts")).runCargoReleaseAudit(rest));
}
if (operation === "workspace-repair") {
  process.exit(await (await import("./workspace-repair.ts")).runWorkspaceRepair(rest));
}
if (operation === "repository-health") {
  process.exit(await (await import("./repository-health.ts")).runRepositoryHealth(rest));
}
if (operation === "git-attribution") {
  process.exit(await (await import("./git-attribution.ts")).runGitAttribution(rest));
}
if (operation === "clean-public-ai") {
  process.exit(await (await import("./clean-public-ai.ts")).runCleanPublicAi(rest));
}
if (operation === "windows-paths") {
  process.exit(await (await import("./windows-paths.ts")).runWindowsPaths(rest));
}
if (operation === "runtime-versions") {
  process.exit((await import("./runtime-versions.ts")).runRuntimeVersions(rest));
}
if (operation === "gitignored-audit") {
  process.exit(await (await import("./gitignored-audit.ts")).runGitignoredAudit(rest));
}
if (operation === "docs-overlaps") {
  process.exit((await import("./docs-overlaps.ts")).runDocsOverlaps(rest));
}
if (operation === "docs-consolidate") {
  process.exit(await (await import("./docs-consolidation.ts")).runDocsConsolidation(rest));
}
if (operation === "python-quality") {
  process.exit((await import("./python-quality.ts")).runPythonQuality(rest));
}
if (operation === "agent-plugin-sync") {
  process.exit(await (await import("./agent-plugin-sync.ts")).runAgentPluginSync(rest));
}
if (operation === "agent-home") {
  process.exit((await import("./agent-home.ts")).runAgentHome(rest));
}
if (operation === "ai-release-gate") {
  process.exit((await import("./ai-release-gate.ts")).runAiReleaseGate(rest));
}
if (operation === "powershell-syntax") {
  process.exit(await (await import("./powershell-syntax.ts")).runPowerShellSyntax(rest));
}
if (operation === "workspace-clean") {
  process.exit(await (await import("./workspace-clean.ts")).runWorkspaceClean(rest));
}
if (operation === "pipeline-catalog") {
  process.exit(await (await import("./pipeline-catalog.ts")).runPipelineCatalog(rest));
}
if (operation === "repository-state") {
  process.exit(await (await import("./repository-state.ts")).runRepositoryState(rest));
}
if (operation === "koharu-release") {
  process.exit(await (await import("./koharu-release.ts")).runKoharuRelease(rest));
}
if (operation === "iecode-doctor") {
  process.exit(await (await import("./iecode-doctor.ts")).runIecodeDoctor(rest));
}
if (operation === "runtime-gate") {
  process.exit(await (await import("./runtime-gate.ts")).runRuntimeGate(rest));
}
if (operation === "automation-inventory") {
  process.exit(await (await import("./automation-inventory.ts")).runAutomationInventory(rest));
}
if (operation === "aphrody-packages") {
  process.exit(await (await import("./aphrody-packages.ts")).runAphrodyPackages(rest));
}
if (operation === "system-packages") {
  process.exit(await (await import("./system-packages.ts")).runSystemPackages(rest));
}
if (operation === "workspace-subsystem") {
  process.exit(await (await import("./workspace-subsystem.ts")).runWorkspaceSubsystem(rest));
}
if (operation === "cargo-boundaries") {
  process.exit(await (await import("./cargo-boundaries.ts")).runCargoBoundaries(rest));
}
if (operation === "docs-gen") {
  process.exit(await (await import("./documentation.ts")).runDocumentation(["generate", ...rest]));
}
if (operation === "workspace-layout") {
  process.exit(await (await import("./workspace-layout.ts")).runWorkspaceLayout(rest));
}
if (operation === "ecosystem-deps") {
  process.exit(await (await import("./ecosystem-deps.ts")).runEcosystemDeps(rest));
}
if (operation === "bun-upstream-docs") {
  process.exit(await (await import("./bun-upstream-docs.ts")).runBunUpstreamDocs(rest));
}
if (operation === "workspace-deps") {
  process.exit(await (await import("./workspace-deps.ts")).runWorkspaceDeps(rest));
}
if (operation === "vendor-license-audit") {
  process.exit(await (await import("./vendor-license-audit.ts")).runVendorLicenseAudit(rest));
}
if (operation === "docs-links") {
  process.exit(await (await import("./docs-links.ts")).runDocsLinks(rest));
}
if (operation === "spaceui-to-m3") {
  process.exit(await (await import("./spaceui-to-m3.ts")).runSpaceUiToM3(rest));
}
if (operation === "desktop-smoke") {
  process.exit(await (await import("./desktop-smoke.ts")).runDesktopSmoke(rest));
}
if (operation === "spaceui-icons") {
  process.exit(await (await import("./spaceui-icons.ts")).runSpaceUiIcons(rest));
}
if (operation === "ui-dedup-manifest") {
  process.exit(await (await import("./ui-dedup-manifest.ts")).runUiDedupManifest(rest));
}
if (operation === "bun-native") {
  process.exit(await (await import("./bun-native.ts")).runBunNative(rest));
}
if (operation === "tauri") {
  process.exit(await (await import("./tauri.ts")).runTauri(rest));
}
if (operation === "tauri-apps") {
  process.exit(await (await import("../../update/src/tauri/apps.ts")).runTauriApps(rest));
}
if (operation === "tauri-sync") {
  process.exit(await (await import("../../update/src/tauri/sync.ts")).runTauriSync(rest));
}
if (operation === "upstream-sources") {
  process.exit(
    await (await import("../../update/src/sources/restore.ts")).runUpstreamSources(rest),
  );
}
if (operation === "deps-sync") {
  process.exit(await (await import("../../update/src/deps/sync.ts")).runDepsSync(rest));
}
if (operation === "update") {
  process.exit(await (await import("../../update/src/cli.ts")).runUpdate(rest));
}
if (operation === "stack-dedup") {
  process.exit(await (await import("./stack-dedup.ts")).runStackDedup(rest));
}
// UI scaffolding CLIs: one process each, arguments passed through.
const UI_CLIS: Record<string, string> = {
  "web-to-tauri": "../../../ui/web-to-tauri/src/cli.ts",
  scaffold: "../../../ui/scaffold/src/cli.ts",
};
if (operation !== undefined && operation in UI_CLIS) {
  const entry = new URL(UI_CLIS[operation]!, import.meta.url);
  const child = Bun.spawn([process.execPath, fileURLToPath(entry), ...rest], {
    cwd: process.cwd(),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await child.exited);
}
if (operation === "drive-daemon") {
  process.exit(await (await import("./drive-daemon.ts")).runDriveDaemon(rest));
}
if (operation === "drive-upstream-audit") {
  process.exit(await (await import("./drive-upstream-audit.ts")).runDriveUpstreamAudit(rest));
}
if (operation === "ui-verify") {
  process.exit(await (await import("./ui-verify.ts")).runUiVerify(rest));
}
if (operation === "bun-workspace") {
  process.exit(await (await import("./bun-workspace.ts")).runBunWorkspace(rest));
}
if (operation === "bun-docs") {
  const [action = "fetch", ...args] = rest;
  if (action === "fetch") process.exit(await (await import("./bun-docs.ts")).runBunDocs(args));
  if (action === "check")
    process.exit(await (await import("./bun-docs.ts")).runBunDocs(["--check", ...args]));
  throw new Error("usage: aphrody-ops bun-docs [fetch|check]");
}
if (operation === "monorepo-audit") {
  process.exit(await (await import("./monorepo-audit.ts")).runMonorepoAudit(rest));
}
if (operation === "fleet") {
  console.log(JSON.stringify(await (await import("./fleet.ts")).loadFleet(), null, 2));
  process.exit(0);
}
if (operation === "n2b") process.exit(await (await import("./n2b.ts")).runN2b(rest));
if (operation === "binaries") {
  console.log(
    JSON.stringify(await (await import("./binaries.ts")).discoverAphrodyBinaries(), null, 2),
  );
  process.exit(0);
}
if (operation === "packages") {
  const [packageOperation, ...packageArgs] = rest;
  if (!packageOperation || !["status", "install", "outdated", "audit"].includes(packageOperation)) {
    throw new Error("usage: aphrody-ops packages <status|install|outdated|audit> [--repo <name>]");
  }
  const repoIndex = packageArgs.indexOf("--repo");
  const repository = repoIndex === -1 ? undefined : packageArgs[repoIndex + 1];
  if (repoIndex !== -1 && (!repository || packageArgs.length !== 2)) {
    throw new Error("usage: aphrody-ops packages <operation> [--repo <name>]");
  }
  if (repoIndex === -1 && packageArgs.length > 0)
    throw new Error("usage: aphrody-ops packages <operation> [--repo <name>]");
  process.exit(
    await (
      await import("./packages.ts")
    ).runPackageOperation(packageOperation as PackageOperation, { repository }),
  );
}
if (operation === "binary") {
  const [binary, ...args] = rest;
  if (!binary) throw new Error("usage: aphrody-ops binary <aphrody-binary> [arguments...]");
  process.exit(await (await import("./binaries.ts")).runAphrodyBinary(binary, args));
}
const aliases: Record<string, string[]> = {
  doctor: ["doctor", "--strict", "--json"],
  status: ["status", "--json"],
  inventory: ["inventory", "--json"],
  pipeline: ["pipeline", "--stage"],
  "github-audit": ["workspace-git-audit", "--json"],
};
const args =
  operation && aliases[operation]
    ? [
        ...aliases[operation],
        ...(operation === "pipeline" ? [rest.shift() ?? "plan", ...rest] : rest),
      ]
    : process.argv.slice(2);
const result = await (
  await import("./runtime.ts")
).runInfra({ args, stdout: "inherit", stderr: "inherit" });
process.exit(result.exitCode);
