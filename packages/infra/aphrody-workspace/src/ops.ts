#!/usr/bin/env bun
import { runInfra } from "./runtime.ts";
import { loadFleet } from "./fleet.ts";
import { runN2b } from "./n2b.ts";
import { discoverAphrodyBinaries, runAphrodyBinary } from "./binaries.ts";
import { runPackageOperation, type PackageOperation } from "./packages.ts";
import { loadAphrodyBridgeCatalog, runRustBridge } from "./bridges.ts";
import { runScriptAudit } from "./audit-scripts.ts";
import { runImportsExports } from "./imports-exports.ts";
import { runMonorepoAudit } from "./monorepo-audit.ts";
import { runBunDocs } from "./bun-docs.ts";
import { runBunWorkspace } from "./bun-workspace.ts";
import { runUiVerify } from "./ui-verify.ts";
import { runDriveUpstreamAudit } from "./drive-upstream-audit.ts";
import { runDriveDaemon } from "./drive-daemon.ts";
import { runTauri } from "./tauri.ts";
import { runBunNative } from "./bun-native.ts";
import { runUiDedupManifest } from "./ui-dedup-manifest.ts";
import { runSpaceUiIcons } from "./spaceui-icons.ts";
import { runDesktopSmoke } from "./desktop-smoke.ts";
import { runSpaceUiToM3 } from "./spaceui-to-m3.ts";
import { runDocsLinks } from "./docs-links.ts";
import { runVendorLicenseAudit } from "./vendor-license-audit.ts";
import { runWorkspaceDeps } from "./workspace-deps.ts";
import { runBunUpstreamDocs } from "./bun-upstream-docs.ts";
import { runEcosystemDeps } from "./ecosystem-deps.ts";
import { runWorkspaceLayout } from "./workspace-layout.ts";
import { runCargoBoundaries } from "./cargo-boundaries.ts";
import { runAutomationInventory } from "./automation-inventory.ts";
import { runRuntimeGate } from "./runtime-gate.ts";
import { runIecodeDoctor } from "./iecode-doctor.ts";
import { runKoharuRelease } from "./koharu-release.ts";
import { runPowerShellSyntax } from "./powershell-syntax.ts";
import { runWorkspaceClean } from "./workspace-clean.ts";
import { runAiReleaseGate } from "./ai-release-gate.ts";
import { runAgentHome } from "./agent-home.ts";
import { runAgentPluginSync } from "./agent-plugin-sync.ts";
import { runPythonQuality } from "./python-quality.ts";
import { runDocsOverlaps } from "./docs-overlaps.ts";
import { runGitignoredAudit } from "./gitignored-audit.ts";
import { runRuntimeVersions } from "./runtime-versions.ts";
import { runMonorepoGate } from "./monorepo-gate.ts";
import { runWindowsPaths } from "./windows-paths.ts";
import { runGitAttribution } from "./git-attribution.ts";
import { runRepositoryHealth } from "./repository-health.ts";
import { runWorkspaceRepair } from "./workspace-repair.ts";
import { runCargoPackageRepair } from "./cargo-package-repair.ts";
import { runConsolidation } from "./consolidation.ts";
import { runRg } from "./rg.ts";
import { runShenron } from "./shenron.ts";
import { runWebMigration } from "./web-migration.ts";

const [operation, ...rest] = process.argv.slice(2);
if (operation === "web-migration") {
  process.exit(await runWebMigration(rest));
}
if (operation === "consolidation") {
  process.exit(await runConsolidation(rest));
}
if (operation === "rg") {
  process.exit(await runRg(rest));
}
if (operation === "shenron") {
  process.exit(await runShenron(rest));
}
if (operation === "bridge") {
  const [bridgeOperation, ...bridgeArgs] = rest;
  if (!bridgeOperation || bridgeOperation === "status") {
    if (bridgeArgs.length > 0)
      throw new Error("usage: aphrody-ops bridge [status|rust <binary> [arguments...]]");
    console.log(JSON.stringify(await loadAphrodyBridgeCatalog(), null, 2));
    process.exit(0);
  }
  if (bridgeOperation !== "rust") {
    throw new Error("usage: aphrody-ops bridge [status|rust <binary> [arguments...]]");
  }
  const [binary, ...args] = bridgeArgs;
  if (!binary) throw new Error("usage: aphrody-ops bridge rust <aphrody-binary> [arguments...]");
  process.exit(await runRustBridge(binary, args, { stdout: "inherit", stderr: "inherit" }));
}
if (operation === "infra") {
  process.exit(
    await runRustBridge("aphrody-infra", rest, { stdout: "inherit", stderr: "inherit" }),
  );
}
if (operation === "orchestrate") {
  const [action = "status", ...args] = rest;
  const usesTarget = !["catalog", "health", "prewarm"].includes(action);
  const target = usesTarget && !args.includes("--target") ? ["--target", "local"] : [];
  process.exit(
    await runRustBridge("aphrody-infra", ["service", action, ...args, ...target], {
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
}
if (operation === "audit-scripts") {
  const index = rest.indexOf("--repo");
  const repo = index === -1 ? undefined : rest[index + 1];
  if (!repo || rest.length !== 2) throw new Error("usage: aphrody-ops audit-scripts --repo <name>");
  await runScriptAudit(repo);
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
  await runImportsExports(args, root);
  process.exit(0);
}
if (operation === "monorepo-gate") {
  process.exit(await runMonorepoGate(rest));
}
if (operation === "cargo-package-repair") {
  process.exit(await runCargoPackageRepair(rest));
}
if (operation === "workspace-repair") {
  process.exit(await runWorkspaceRepair(rest));
}
if (operation === "repository-health") {
  process.exit(await runRepositoryHealth(rest));
}
if (operation === "git-attribution") {
  process.exit(await runGitAttribution(rest));
}
if (operation === "windows-paths") {
  process.exit(await runWindowsPaths(rest));
}
if (operation === "runtime-versions") {
  process.exit(runRuntimeVersions(rest));
}
if (operation === "gitignored-audit") {
  process.exit(await runGitignoredAudit(rest));
}
if (operation === "docs-overlaps") {
  process.exit(runDocsOverlaps(rest));
}
if (operation === "python-quality") {
  process.exit(runPythonQuality(rest));
}
if (operation === "agent-plugin-sync") {
  process.exit(runAgentPluginSync(rest));
}
if (operation === "agent-home") {
  process.exit(runAgentHome(rest));
}
if (operation === "ai-release-gate") {
  process.exit(runAiReleaseGate(rest));
}
if (operation === "powershell-syntax") {
  process.exit(await runPowerShellSyntax(rest));
}
if (operation === "workspace-clean") {
  process.exit(await runWorkspaceClean(rest));
}
if (operation === "koharu-release") {
  process.exit(await runKoharuRelease(rest));
}
if (operation === "iecode-doctor") {
  process.exit(await runIecodeDoctor(rest));
}
if (operation === "runtime-gate") {
  process.exit(await runRuntimeGate(rest));
}
if (operation === "automation-inventory") {
  process.exit(await runAutomationInventory(rest));
}
if (operation === "cargo-boundaries") {
  process.exit(await runCargoBoundaries(rest));
}
if (operation === "workspace-layout") {
  process.exit(await runWorkspaceLayout(rest));
}
if (operation === "ecosystem-deps") {
  process.exit(await runEcosystemDeps(rest));
}
if (operation === "bun-upstream-docs") {
  process.exit(await runBunUpstreamDocs(rest));
}
if (operation === "workspace-deps") {
  process.exit(await runWorkspaceDeps(rest));
}
if (operation === "vendor-license-audit") {
  process.exit(await runVendorLicenseAudit(rest));
}
if (operation === "docs-links") {
  process.exit(await runDocsLinks(rest));
}
if (operation === "spaceui-to-m3") {
  process.exit(await runSpaceUiToM3(rest));
}
if (operation === "desktop-smoke") {
  process.exit(await runDesktopSmoke(rest));
}
if (operation === "spaceui-icons") {
  process.exit(await runSpaceUiIcons(rest));
}
if (operation === "ui-dedup-manifest") {
  process.exit(await runUiDedupManifest(rest));
}
if (operation === "bun-native") {
  process.exit(await runBunNative(rest));
}
if (operation === "tauri") {
  process.exit(await runTauri(rest));
}
if (operation === "drive-daemon") {
  process.exit(await runDriveDaemon(rest));
}
if (operation === "drive-upstream-audit") {
  process.exit(await runDriveUpstreamAudit(rest));
}
if (operation === "ui-verify") {
  process.exit(await runUiVerify(rest));
}
if (operation === "bun-workspace") {
  process.exit(await runBunWorkspace(rest));
}
if (operation === "bun-docs") {
  const [action = "fetch", ...args] = rest;
  if (action === "fetch") process.exit(await runBunDocs(args));
  if (action === "check") process.exit(await runBunDocs(["--check", ...args]));
  throw new Error("usage: aphrody-ops bun-docs [fetch|check]");
}
if (operation === "monorepo-audit") {
  process.exit(await runMonorepoAudit(rest));
}
if (operation === "fleet") {
  console.log(JSON.stringify(await loadFleet(), null, 2));
  process.exit(0);
}
if (operation === "n2b") process.exit(await runN2b(rest));
if (operation === "binaries") {
  console.log(JSON.stringify(await discoverAphrodyBinaries(), null, 2));
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
  process.exit(await runPackageOperation(packageOperation as PackageOperation, { repository }));
}
if (operation === "binary") {
  const [binary, ...args] = rest;
  if (!binary) throw new Error("usage: aphrody-ops binary <aphrody-binary> [arguments...]");
  process.exit(await runAphrodyBinary(binary, args));
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
const result = await runInfra({ args, stdout: "inherit", stderr: "inherit" });
process.exit(result.exitCode);
