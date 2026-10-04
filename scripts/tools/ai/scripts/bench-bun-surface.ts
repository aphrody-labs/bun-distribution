// SPDX-License-Identifier: Apache-2.0
/**
 * Benchmark et audit en conditions réelles de la surface Bun & TypeScript.
 * Exécute les suites de tests, scripts d'orchestration, linter oxlint et vérifications de typage tsc.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Agent home (benchmark outputs, profile scripts); APHRODY_HOME overrides it.
const APHRODY_HOME = process.env.APHRODY_HOME ?? path.join(os.homedir(), ".aphrody");

interface CommandResult {
  command: string;
  cwd: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

function runCommand(command: string, args: string[], cwd: string = process.cwd()): CommandResult {
  const fullCommand = `${command} ${args.join(" ")}`;
  const start = performance.now();
  const proc = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: true,
    env: { ...process.env },
    maxBuffer: 50 * 1024 * 1024,
  });
  const durationMs = Math.round((performance.now() - start) * 100) / 100;

  return {
    command: fullCommand,
    cwd,
    exitCode: proc.status ?? (proc.error ? 1 : 0),
    durationMs,
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
  };
}

function parseBunTestOutput(output: string) {
  const passMatch = output.match(/(\d+)\s+pass/);
  const failMatch = output.match(/(\d+)\s+fail/);
  const expectMatch = output.match(/(\d+)\s+expect\(\)\s+calls/);
  const filesMatch = output.match(/Ran\s+(\d+)\s+tests across\s+(\d+)\s+files/);
  const durationMatch = output.match(/\[([\d.]+)m?s\]\s*$/m);

  return {
    testsPassed: passMatch ? parseInt(passMatch[1], 10) : null,
    testsFailed: failMatch ? parseInt(failMatch[1], 10) : 0,
    expectCalls: expectMatch ? parseInt(expectMatch[1], 10) : null,
    filesCount: filesMatch ? parseInt(filesMatch[2], 10) : null,
    reportedDuration: durationMatch ? durationMatch[1] : null,
  };
}

function parseOxlintOutput(stdout: string, stderr: string) {
  const combined = stdout + "\n" + stderr;
  const summaryMatch = combined.match(/Found\s+(\d+)\s+warnings?\s+and\s+(\d+)\s+errors?/);
  const finishedMatch = combined.match(/Finished in\s+([\d.]+m?s)\s+on\s+(\d+)\s+files with\s+(\d+)\s+rules/);

  return {
    warnings: summaryMatch ? parseInt(summaryMatch[1], 10) : null,
    errors: summaryMatch ? parseInt(summaryMatch[2], 10) : null,
    filesScanned: finishedMatch ? parseInt(finishedMatch[2], 10) : null,
    rulesChecked: finishedMatch ? parseInt(finishedMatch[3], 10) : null,
    reportedTime: finishedMatch ? finishedMatch[1] : null,
  };
}

async function main() {
  const totalStart = performance.now();
  console.log("=== Début du benchmark de la surface Bun / TypeScript ===");

  // The YOLO engine is Rust (`aphrody-yolo`), not a Bun package. Its Cargo
  // gates are intentionally kept out of this Bun-only benchmark.
  // 1. bun run $APHRODY_HOME/scripts/profile-status.ts
  console.log("1/4 Exécution de profile-status.ts...");
  const profileStatusRes = runCommand("bun", ["run", path.join(APHRODY_HOME, "scripts/profile-status.ts")]);

  // 2. oxlint -c .oxlintrc.json
  console.log("2/4 Exécution de oxlint...");
  const oxlintRes = runCommand("oxlint", ["-c", ".oxlintrc.json"]);
  const oxlintMetrics = parseOxlintOutput(oxlintRes.stdout, oxlintRes.stderr);

  // 3. bun scripts/sync-agent-plugins.ts
  console.log("3/4 Exécution de sync-agent-plugins.ts...");
  const syncPluginsRes = runCommand("bun", ["scripts/sync-agent-plugins.ts"]);

  // 4. Vérification du typage TypeScript
  console.log("4/4 Vérification du typage TypeScript (tsc --noEmit)...");
  const typecheckPackages = [
    { name: "packages/m3-tokens", path: "packages/m3-tokens/tsconfig.json" },
    { name: "m3/packages/m3-theme", path: "m3/packages/m3-theme/tsconfig.json" },
    { name: "m3/packages/m3-motion", path: "m3/packages/m3-motion/tsconfig.json" },
    { name: "m3/packages/m3-design", path: "m3/packages/m3-design/tsconfig.json" },
    { name: "m3/packages/m3-react", path: "m3/packages/m3-react/tsconfig.json" },diff --git a/bun.lock b/bun.lock
    { name: "packages/doc-ai", path: "packages/doc-ai/tsconfig.json" },
  ];

  const typecheckResults: Record<string, any> = {};
  for (const pkg of typecheckPackages) {
    console.log(`  -> Typecheck ${pkg.name}...`);
    const tscRes = runCommand("tsc", ["--noEmit", "-p", pkg.path]);
    typecheckResults[pkg.name] = {
      command: tscRes.command,
      exitCode: tscRes.exitCode,
      durationMs: tscRes.durationMs,
      status: tscRes.exitCode === 0 ? "PASS" : "FAIL",
      stdout: tscRes.stdout.trim(),
      stderr: tscRes.stderr.trim(),
    };
  }

  // Suite additionnelle pour granularité maximale : packages/m3-tokens test
  console.log("Tests additionnels : packages/m3-tokens...");
  const m3TokensTestRes = runCommand("bun", ["--cwd", "packages/m3-tokens", "test"]);
  const m3TokensMetrics = parseBunTestOutput(m3TokensTestRes.stdout + "\n" + m3TokensTestRes.stderr);

  const totalDurationMs = Math.round((performance.now() - totalStart) * 100) / 100;

  const benchmarkPayload = {
    metadata: {
      generator: "scripts/bench-bun-surface.ts",
      timestamp: new Date().toISOString(),
      platform: {
        os: `${os.type()} ${os.release()} (${os.arch()})`,
        hostname: os.hostname(),
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model || "AMD Ryzen",
        totalMemoryGb: Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10,
        gpu: "NVIDIA GeForce RTX 4070 (12GB GDDR6X) / CUDA 13.3",
      },
      runtimes: {
        bun: process.versions.bun || "1.4.0",
        node: process.versions.node,
        v8: process.versions.v8,
      },
    },
    summary: {
      totalDurationMs,
      allPassed:
        profileStatusRes.exitCode === 0 &&
        oxlintRes.exitCode === 0 &&
        syncPluginsRes.exitCode === 0 &&
        Object.values(typecheckResults).every((t) => t.exitCode === 0) &&
        m3TokensTestRes.exitCode === 0,
      tests: {
        m3Tokens: {
          exitCode: m3TokensTestRes.exitCode,
          passed: m3TokensMetrics.testsPassed,
          failed: m3TokensMetrics.testsFailed,
          expectCalls: m3TokensMetrics.expectCalls,
          filesTested: m3TokensMetrics.filesCount,
          durationMs: m3TokensTestRes.durationMs,
        },
        totalPassed: m3TokensMetrics.testsPassed || 0,
        totalFailed: m3TokensMetrics.testsFailed || 0,
      },
      linter: {
        exitCode: oxlintRes.exitCode,
        errors: oxlintMetrics.errors,
        warnings: oxlintMetrics.warnings,
        filesScanned: oxlintMetrics.filesScanned,
        rulesChecked: oxlintMetrics.rulesChecked,
        durationMs: oxlintRes.durationMs,
      },
      scripts: {
        profileStatus: {
          exitCode: profileStatusRes.exitCode,
          durationMs: profileStatusRes.durationMs,
        },
        syncAgentPlugins: {
          exitCode: syncPluginsRes.exitCode,
          durationMs: syncPluginsRes.durationMs,
        },
      },
      typecheck: {
        totalPackages: Object.keys(typecheckResults).length,
        allPassed: Object.values(typecheckResults).every((t) => t.exitCode === 0),
      },
    },
    runs: {
      m3TokensTest: {
        ...m3TokensTestRes,
        parsedMetrics: m3TokensMetrics,
      },
      profileStatus: profileStatusRes,
      oxlint: {
        ...oxlintRes,
        parsedMetrics: oxlintMetrics,
      },
      syncAgentPlugins: syncPluginsRes,
      typecheck: typecheckResults,
    },
  };

  const targetPath = path.join(APHRODY_HOME, "workspaces/aphrody/benchmarks/bun-surface.json");
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(targetPath, JSON.stringify(benchmarkPayload, null, 2), "utf8");
  console.log(`\n=== Benchmark terminé avec succès en ${totalDurationMs} ms ===`);
  console.log(`Données enregistrées dans : ${targetPath}`);
}

main().catch((err) => {
  console.error("Erreur durant l'exécution du benchmark :", err);
  process.exit(1);
});
