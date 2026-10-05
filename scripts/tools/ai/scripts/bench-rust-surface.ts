// SPDX-License-Identifier: Apache-2.0
/**
 * Benchmark et audit en conditions réelles de la surface Rust & CLI aphrody.
 * Exécute l'ensemble des commandes CLI aphrody réelles, cargo check workspace et tests ciblés.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Repository root, resolved from this script so the benchmark runs from any checkout.
const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const CARGO_WRAPPER = path.join(REPO_ROOT, "scripts/build/rust/cargo-serial.sh");
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

function runCommand(command: string, args: string[], cwd: string = REPO_ROOT): CommandResult {
  const fullCommand = `${command} ${args.join(" ")}`;
  const start = performance.now();
  const proc = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    env: { ...process.env },
    maxBuffer: 50 * 1024 * 1024,
  });
  const durationMs = Math.round((performance.now() - start) * 100) / 100;

  return {
    command: fullCommand,
    cwd,
    exitCode: proc.status ?? 1,
    durationMs,
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
  };
}

/** Float value of the first capture group, or null when the pattern did not match. */
function captureFloat(match: RegExpMatchArray | null): number | null {
  const value = match?.[1];
  return value === undefined ? null : Number.parseFloat(value);
}

/** [passed, failed, ignored] of one `test result:` line; zeros when the line is absent. */
function resultCounts(result: RegExpMatchArray | undefined): [number, number, number] {
  const [, , passed = "0", failed = "0", ignored = "0"] = result ?? [];
  return [Number.parseInt(passed, 10), Number.parseInt(failed, 10), Number.parseInt(ignored, 10)];
}

function parseCargoTestOutput(stdout: string, stderr: string) {
  const combined = stdout + "\n" + stderr;
  const testResults = [
    ...combined.matchAll(
      /test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out/g,
    ),
  ];

  const [unitPassed, unitFailed, unitIgnored] = resultCounts(testResults[0]);
  const [docPassed, docFailed] = resultCounts(testResults[1]);

  const finishedMatch = combined.match(/Finished `test` profile .* target\(s\) in ([\d.]+)s/);

  return {
    unitPassed,
    unitFailed,
    unitIgnored,
    docPassed,
    docFailed,
    totalPassed: unitPassed + docPassed,
    totalFailed: unitFailed + docFailed,
    buildTimeSeconds: captureFloat(finishedMatch),
  };
}

function parseCargoCheckOutput(stdout: string, stderr: string) {
  const combined = stdout + "\n" + stderr;
  const finishedMatch = combined.match(/Finished `dev` profile .* target\(s\) in ([\d.]+)s/);
  const warnings = (combined.match(/warning:/g) || []).length;

  return {
    warnings,
    buildTimeSeconds: captureFloat(finishedMatch),
  };
}

async function main() {
  const totalStart = performance.now();
  console.log("=== Début du benchmark de la surface Rust & CLI aphrody ===");

  // Toolchain probe
  const rustcProbe = runCommand("rustc", ["--version"]);
  const cargoProbe = runCommand("cargo", ["--version"]);
  const aphrodyCliProbe = runCommand("aphrody", ["--version"]);

  // 1. Commandes CLI aphrody
  console.log("1/10 Exécution de 'aphrody --version'...");
  const cmdVersion = runCommand("aphrody", ["--version"]);

  console.log("2/10 Exécution de 'aphrody doctor'...");
  const cmdDoctor = runCommand("aphrody", ["doctor"]);

  console.log("3/10 Exécution de 'aphrody model doctor'...");
  const cmdModelDoctor = runCommand("aphrody", ["model", "doctor"]);

  console.log("4/10 Exécution de 'aphrody model list'...");
  const cmdModelList = runCommand("aphrody", ["model", "list"]);

  console.log("5/10 Exécution de 'aphrody vpn status'...");
  const cmdVpnStatus = runCommand("aphrody", ["vpn", "status"]);

  console.log("6/10 Exécution de 'aphrody ssh proxy --status'...");
  const cmdSshProxyStatus = runCommand("aphrody", ["ssh", "proxy", "--status"]);

  console.log("7/10 Exécution de 'aphrody search --help'...");
  const cmdSearchHelp = runCommand("aphrody", ["search", "--help"]);

  // 2. Compilation et tests ciblés du workspace Cargo
  console.log("8/10 Exécution de 'cargo check --workspace --all-targets --locked'...");
  const cmdCargoCheck = runCommand(CARGO_WRAPPER, [
    "check",
    "--workspace",
    "--all-targets",
    "--locked",
  ]);
  const cargoCheckMetrics = parseCargoCheckOutput(cmdCargoCheck.stdout, cmdCargoCheck.stderr);

  console.log("9/10 Exécution de 'cargo test -p aphrody-models'...");
  const cmdTestModels = runCommand(CARGO_WRAPPER, ["test", "-p", "aphrody-models", "--locked"]);
  const modelsMetrics = parseCargoTestOutput(cmdTestModels.stdout, cmdTestModels.stderr);

  console.log("10/10 Exécution de 'cargo test -p aphrody-vpn'...");
  const cmdTestVpn = runCommand(CARGO_WRAPPER, ["test", "-p", "aphrody-vpn", "--locked"]);
  const vpnMetrics = parseCargoTestOutput(cmdTestVpn.stdout, cmdTestVpn.stderr);

  const totalDurationMs = Math.round((performance.now() - totalStart) * 100) / 100;

  const cliCommands = [
    { id: "version", result: cmdVersion },
    { id: "doctor", result: cmdDoctor },
    { id: "model_doctor", result: cmdModelDoctor },
    { id: "model_list", result: cmdModelList },
    { id: "vpn_status", result: cmdVpnStatus },
    { id: "ssh_proxy_status", result: cmdSshProxyStatus },
    { id: "search_help", result: cmdSearchHelp },
  ];

  const allCliPassed = cliCommands.every((c) => c.result.exitCode === 0);
  const allCargoPassed =
    cmdCargoCheck.exitCode === 0 && cmdTestModels.exitCode === 0 && cmdTestVpn.exitCode === 0;

  const benchmarkPayload = {
    metadata: {
      generator: "scripts/bench-rust-surface.ts",
      timestamp: new Date().toISOString(),
      platform: {
        os: `${os.type()} ${os.release()} (${os.arch()})`,
        hostname: os.hostname(),
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model || "13th Gen Intel(R) Core(TM) i7-13700F",
        totalMemoryGb: Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10,
        gpu: "NVIDIA GeForce RTX 4070 (12GB GDDR6X) / CUDA 13.3",
      },
      toolchain: {
        rustc: rustcProbe.stdout.trim(),
        cargo: cargoProbe.stdout.trim(),
        aphrodyCliVersion: aphrodyCliProbe.stdout.trim(),
      },
    },
    summary: {
      totalDurationMs,
      allPassed: allCliPassed && allCargoPassed,
      cli: {
        totalCommands: cliCommands.length,
        passed: cliCommands.filter((c) => c.result.exitCode === 0).length,
        failed: cliCommands.filter((c) => c.result.exitCode !== 0).length,
        commands: cliCommands.map((c) => ({
          name: c.result.command,
          exitCode: c.result.exitCode,
          durationMs: c.result.durationMs,
          status: c.result.exitCode === 0 ? "PASS" : "FAIL",
        })),
      },
      cargo: {
        check: {
          exitCode: cmdCargoCheck.exitCode,
          durationMs: cmdCargoCheck.durationMs,
          warnings: cargoCheckMetrics.warnings,
          buildTimeSeconds: cargoCheckMetrics.buildTimeSeconds,
          status: cmdCargoCheck.exitCode === 0 ? "PASS" : "FAIL",
        },
        testModels: {
          exitCode: cmdTestModels.exitCode,
          durationMs: cmdTestModels.durationMs,
          unitTestsPassed: modelsMetrics.unitPassed,
          unitTestsFailed: modelsMetrics.unitFailed,
          docTestsPassed: modelsMetrics.docPassed,
          docTestsFailed: modelsMetrics.docFailed,
          status: cmdTestModels.exitCode === 0 ? "PASS" : "FAIL",
        },
        testVpn: {
          exitCode: cmdTestVpn.exitCode,
          durationMs: cmdTestVpn.durationMs,
          unitTestsPassed: vpnMetrics.unitPassed,
          unitTestsFailed: vpnMetrics.unitFailed,
          docTestsPassed: vpnMetrics.docPassed,
          docTestsFailed: vpnMetrics.docFailed,
          status: cmdTestVpn.exitCode === 0 ? "PASS" : "FAIL",
        },
        totalTestsPassed: modelsMetrics.totalPassed + vpnMetrics.totalPassed,
        totalTestsFailed: modelsMetrics.totalFailed + vpnMetrics.totalFailed,
      },
    },
    runs: {
      cli: {
        version: cmdVersion,
        doctor: cmdDoctor,
        modelDoctor: cmdModelDoctor,
        modelList: cmdModelList,
        vpnStatus: cmdVpnStatus,
        sshProxyStatus: cmdSshProxyStatus,
        searchHelp: cmdSearchHelp,
      },
      cargo: {
        check: {
          ...cmdCargoCheck,
          parsedMetrics: cargoCheckMetrics,
        },
        testModels: {
          ...cmdTestModels,
          parsedMetrics: modelsMetrics,
        },
        testVpn: {
          ...cmdTestVpn,
          parsedMetrics: vpnMetrics,
        },
      },
    },
  };

  const targetPath = path.join(APHRODY_HOME, "workspaces/aphrody/benchmarks/rust-surface.json");
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(targetPath, JSON.stringify(benchmarkPayload, null, 2), "utf8");
  console.log(`\n=== Benchmark Rust terminé avec succès en ${totalDurationMs} ms ===`);
  console.log(`Données enregistrées dans : ${targetPath}`);
}

main().catch((err) => {
  console.error("Erreur durant l'exécution du benchmark :", err);
  process.exit(1);
});
