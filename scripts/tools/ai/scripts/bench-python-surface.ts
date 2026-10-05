// SPDX-License-Identifier: Apache-2.0
/**
 * Benchmark et audit en conditions réelles de la surface Python & FFI Maturin.
 * Exécute les vérifications d'environnement, validation C-ABI Rust/Maturin, suite pytest et ruff.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Repository root, resolved from this script so the benchmark runs from any checkout.
const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
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

function runCommand(
  command: string,
  args: string[],
  cwd: string = path.join(REPO_ROOT, "py"),
): CommandResult {
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

function parsePytestOutput(stdout: string, stderr: string) {
  const combined = stdout + "\n" + stderr;
  const match = combined.match(
    /(\d+)\s+passed(?:,\s+(\d+)\s+skipped)?(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+error[s]?)?\s+in\s+([\d.]+)s/,
  );

  let passed = 0;
  let skipped = 0;
  let failed = 0;
  let errors = 0;
  let durationSeconds: number | null = null;

  if (match) {
    // Optional groups (skipped, failed, errors) are absent from the summary when zero.
    const [, passedText = "0", skippedText = "0", failedText = "0", errorsText = "0", seconds] =
      match;
    passed = Number.parseInt(passedText, 10) || 0;
    skipped = Number.parseInt(skippedText, 10);
    failed = Number.parseInt(failedText, 10);
    errors = Number.parseInt(errorsText, 10);
    durationSeconds = seconds === undefined ? null : Number.parseFloat(seconds);
  }

  // Parse coverage if present
  const [, totalText, missedText, percentText] =
    combined.match(/TOTAL\s+(\d+)\s+(\d+)\s+(\d+)%/) ?? [];
  const coverage =
    totalText !== undefined && missedText !== undefined && percentText !== undefined
      ? {
          totalStatements: Number.parseInt(totalText, 10),
          missedStatements: Number.parseInt(missedText, 10),
          coveragePercent: Number.parseFloat(percentText),
        }
      : null;

  return {
    passed,
    skipped,
    failed,
    errors,
    totalTests: passed + skipped + failed + errors,
    durationSeconds,
    coverage,
  };
}

async function main() {
  const totalStart = performance.now();
  console.log("=== Début du benchmark de la surface Python (uv & maturin FFI) ===");

  const pyDir = path.join(REPO_ROOT, "py");

  // 1. Toolchain probes
  console.log("1/6 Sonde de la chaîne de compilation Python & uv...");
  const pyVersionCmd = runCommand("uv", ["run", "python", "--version"], pyDir);
  const uvVersionCmd = runCommand("uv", ["--version"], pyDir);
  const cargoVersionCmd = runCommand("cargo", ["--version"], pyDir);

  // 2. Package inventory
  console.log("2/6 Inventaire des dépendances uv...");
  const pipListCmd = runCommand("uv", ["pip", "list", "--format=json"], pyDir);
  let packages: Array<{ name: string; version: string }> = [];
  try {
    packages = JSON.parse(pipListCmd.stdout);
  } catch {
    packages = [];
  }

  // 3. Module aphrody import check
  console.log("3/6 Vérification de l'import du package aphrody...");
  const importCheckCmd = runCommand(
    "uv",
    [
      "run",
      "python",
      "-c",
      "\"import aphrody; print('aphrody python module loaded, version:', getattr(aphrody, '__version__', 'ok'))\"",
    ],
    pyDir,
  );

  // 4. Native Rust C-ABI extension check
  console.log(
    "4/6 Vérification de l'extension native aphrody_rust (crates/ai/rag-python, FFI SIMD)...",
  );
  const ffiCheckCmd = runCommand(
    "uv",
    [
      "run",
      "python",
      "-c",
      "\"from aphrody.rag.math import HAS_RUST, cosine_similarity, top_k_cosine_similarity, reciprocal_rank_fusion; print('HAS_RUST:', HAS_RUST); assert HAS_RUST; print('FFI symbols verified')\"",
    ],
    pyDir,
  );

  // 5. Pytest suite
  console.log("5/6 Exécution de la suite pytest complète...");
  const pytestCmd = runCommand("uv", ["run", "pytest"], pyDir);
  const pytestMetrics = parsePytestOutput(pytestCmd.stdout, pytestCmd.stderr);

  // 6. Ruff linter and formatter check
  console.log("6/6 Exécution de ruff (check & format)...");
  const ruffCheckCmd = runCommand("uv", ["run", "ruff", "check"], pyDir);
  const ruffFormatCmd = runCommand("uv", ["run", "ruff", "format", "--check"], pyDir);

  const totalDurationMs = Math.round((performance.now() - totalStart) * 100) / 100;

  // The extension is the crates/ai/rag-python crate, built into the package by maturin.
  const sdkDir = path.join(pyDir, "packages/aphrody/src/aphrody");
  const extension = fs.existsSync(sdkDir)
    ? fs.readdirSync(sdkDir).find((name) => /^aphrody_rust\..*\.(so|pyd)$/.test(name))
    : undefined;
  const pydPath = path.join(sdkDir, extension ?? "aphrody_rust.abi3.so");
  const pydExists = extension !== undefined;

  const benchmarkPayload = {
    timestamp: new Date().toISOString(),
    environment: {
      python_version: pyVersionCmd.stdout.trim(),
      uv_version: uvVersionCmd.stdout.trim(),
      cargo_version: cargoVersionCmd.stdout.trim(),
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      workspace_root: pyDir,
      python_path: path.join(pyDir, "aphrody"),
      packages_count: packages.length,
      packages,
    },
    maturin_build_and_dependencies: {
      module_name: "aphrody",
      version: "0.1.0",
      import_verification_command: importCheckCmd.command,
      import_verification_output: importCheckCmd.stdout.trim(),
      import_verification_exit_code: importCheckCmd.exitCode,
      native_extension: {
        crate_name: "aphrody-rust",
        pyd_path: pydPath.replace(/\\/g, "/"),
        pyd_exists: pydExists,
        has_rust:
          ffiCheckCmd.stdout.includes("HAS_RUST: True") ||
          ffiCheckCmd.stdout.includes("HAS_RUST: true"),
        ffi_check_exit_code: ffiCheckCmd.exitCode,
        symbols: ["cosine_similarity", "reciprocal_rank_fusion", "top_k_cosine_similarity"],
      },
    },
    pytest_execution: {
      command: pytestCmd.command,
      working_directory: pyDir,
      exit_code: pytestCmd.exitCode,
      duration_seconds: pytestMetrics.durationSeconds,
      metrics: {
        total_tests: pytestMetrics.totalTests,
        passed: pytestMetrics.passed,
        skipped: pytestMetrics.skipped,
        failed: pytestMetrics.failed,
        errors: pytestMetrics.errors,
      },
      coverage: pytestMetrics.coverage,
      raw_summary:
        pytestCmd.stdout
          .split("\n")
          .filter((l) => l.includes("passed"))
          .slice(-1)[0] || "",
    },
    linters: {
      ruff_check: {
        exit_code: ruffCheckCmd.exitCode,
        output: ruffCheckCmd.stdout.trim() || ruffCheckCmd.stderr.trim(),
      },
      ruff_format: {
        exit_code: ruffFormatCmd.exitCode,
        output: ruffFormatCmd.stdout.trim() || ruffFormatCmd.stderr.trim(),
      },
    },
    total_duration_ms: totalDurationMs,
  };

  const targetPath = path.join(APHRODY_HOME, "workspaces/aphrody/benchmarks/python-surface.json");
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(targetPath, JSON.stringify(benchmarkPayload, null, 2), "utf8");
  console.log(`\n=== Benchmark Python terminé avec succès en ${totalDurationMs} ms ===`);
  console.log(`Données enregistrées dans : ${targetPath}`);
}

main().catch((err) => {
  console.error("Erreur durant l'exécution du benchmark Python :", err);
  process.exit(1);
});
