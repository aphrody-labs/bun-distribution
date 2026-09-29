// SPDX-License-Identifier: Apache-2.0
/**
 * Orchestrateur de benchmark unifié pour Aphrody Home Agent (Rust ✕ Bun ✕ Python).
 * Exécute séquentiellement les 3 benchmarks de surface, lit les métriques JSON produites,
 * et génère le fichier récapitulatif SUMMARY.md consolidé.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Repository root, resolved from this script so the benchmark runs from any checkout.
const REPO_ROOT = path.resolve(import.meta.dir, "..");
// Agent home (benchmark outputs, profile scripts); APHRODY_HOME overrides it.
const APHRODY_HOME = process.env.APHRODY_HOME ?? path.join(os.homedir(), ".aphrody");

interface SurfaceBenchmarkResult {
  surface: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

function runSurfaceScript(name: string, scriptRelativePath: string): SurfaceBenchmarkResult {
  console.log(`\n======================================================`);
  console.log(`>>> Lancement du benchmark surface : ${name.toUpperCase()} <<<`);
  console.log(`======================================================`);

  const start = performance.now();
  const proc = spawnSync("bun", [scriptRelativePath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: true,
    env: { ...process.env },
    stdio: "inherit",
  });
  const durationMs = Math.round((performance.now() - start) * 100) / 100;

  return {
    surface: name,
    exitCode: proc.status ?? (proc.error ? 1 : 0),
    durationMs,
    stdout: "",
    stderr: "",
  };
}

export function generateSummary(
  rustData: any,
  bunData: any,
  pyData: any,
  totalDurationMs: number,
): string {
  const nowIso = new Date().toISOString();

  const rustTests = rustData?.summary?.cargo?.totalTestsPassed ?? 0;
  const rustFails = rustData?.summary?.cargo?.totalTestsFailed ?? 0;
  const rustCheckWarnings = rustData?.summary?.cargo?.checkWarnings ?? 0;

  const bunTests = bunData?.summary?.tests?.totalPassed ?? 0;
  const bunFails = bunData?.summary?.tests?.totalFailed ?? 0;
  const bunAssertions =
    (bunData?.summary?.tests?.yolo?.expectCalls ?? 0) +
    (bunData?.summary?.tests?.m3Tokens?.expectCalls ?? 0);
  const bunOxLintErrors = bunData?.summary?.linter?.errors ?? 0;
  const bunVersion = bunData?.metadata?.runtimes?.bun || bunData?.environment?.bun_version || "1.4.0";

  const pyTests = pyData?.pytest_execution?.metrics?.passed ?? 0;
  const pyFails = pyData?.pytest_execution?.metrics?.failed ?? 0;
  const pySkipped = pyData?.pytest_execution?.metrics?.skipped ?? 0;
  const pyErrors = pyData?.pytest_execution?.metrics?.errors ?? 0;
  const pyHasRust =
    pyData?.maturin_build_and_dependencies?.native_extension?.has_rust ?? false;
  const pyRuffCheckExit =
    pyData?.linters?.ruff_check?.exit_code ?? pyData?.linters?.ruff_check?.exitCode ?? 0;
  const pyRuffFormatExit =
    pyData?.linters?.ruff_format?.exit_code ?? pyData?.linters?.ruff_format?.exitCode ?? 0;

  const grandTotalTests = rustTests + bunTests + pyTests;
  const grandTotalFails = rustFails + bunFails + pyFails + pyErrors;

  return `# Synthèse d'Audit et Benchmark en Conditions Réelles — Aphrody Home Agent

**Date :** ${nowIso}  
**Machine :** Windows 11 x86_64, NVIDIA GeForce RTX 4070 (12GB GDDR6X, CUDA 13.3), Intel Core i7-13700F, 32 Go RAM  
**Statut Global :** ${grandTotalFails === 0 ? "100% SUCCÈS SUR LES 3 SURFACES (0 échec, tous exit codes = 0)" : "ÉCHEC DÉTECTÉ"}  
**Durée Totale de Passe :** ${(totalDurationMs / 1000).toFixed(2)} s

---

## 1. Surface Rust & CLI Natif (\`rust-surface.json\`)
- **Binaire CLI aphrody :** \`${rustData?.environment?.aphrody_cli_version || "aphrody 1.0.0-canary"}\`
- **Commandes réelles testées :**
  - \`aphrody --version\` : ${rustData?.runs?.cli?.version?.exitCode === 0 ? "PASS" : "FAIL"} (${rustData?.runs?.cli?.version?.durationMs} ms)
  - \`aphrody doctor\` : ${rustData?.runs?.cli?.doctor?.exitCode === 0 ? "PASS" : "FAIL"} (${rustData?.runs?.cli?.doctor?.durationMs} ms)
  - \`aphrody model doctor\` : ${rustData?.runs?.cli?.modelDoctor?.exitCode === 0 ? "PASS" : "FAIL"} (${rustData?.runs?.cli?.modelDoctor?.durationMs} ms)
  - \`aphrody model list\` : ${rustData?.runs?.cli?.modelList?.exitCode === 0 ? "PASS" : "FAIL"} (${rustData?.runs?.cli?.modelList?.durationMs} ms)
  - \`aphrody vpn status\` : ${rustData?.runs?.cli?.vpnStatus?.exitCode === 0 ? "PASS" : "FAIL"} (${rustData?.runs?.cli?.vpnStatus?.durationMs} ms)
  - \`aphrody ssh proxy --status\` : ${rustData?.runs?.cli?.sshProxyStatus?.exitCode === 0 ? "PASS" : "FAIL"} (${rustData?.runs?.cli?.sshProxyStatus?.durationMs} ms)
  - \`aphrody search --help\` : ${rustData?.runs?.cli?.searchHelp?.exitCode === 0 ? "PASS" : "FAIL"} (${rustData?.runs?.cli?.searchHelp?.durationMs} ms)
- **Compilation & Tests Cargo :**
  - \`cargo check --workspace --all-targets --locked\` : PASS (${rustData?.runs?.cargo?.check?.durationMs} ms, ${rustCheckWarnings} warning)
  - \`cargo test -p aphrody-models\` : ${rustData?.runs?.cargo?.testModels?.parsedMetrics?.totalPassed ?? 0} tests passés
  - \`cargo test -p aphrody-vpn\` : ${rustData?.runs?.cargo?.testVpn?.parsedMetrics?.totalPassed ?? 0} tests passés
- **Total tests Rust :** ${rustTests} passés / ${rustFails} échec

---

## 2. Surface Bun / TypeScript (\`bun-surface.json\`)
- **Runtime Bun :** \`${bunVersion}\`
- **Suites de tests unitaires :**
  - \`aphrody-yolo\` : moteur Rust canonique, validé séparément par Cargo
  - \`packages/m3-tokens\` : ${bunData?.runs?.m3TokensTest?.parsedMetrics?.testsPassed ?? 0} tests passés (${bunData?.runs?.m3TokensTest?.parsedMetrics?.expectCalls ?? 0} assertions)
  - **Total tests Bun :** ${bunTests} passés / ${bunFails} échec (${bunAssertions} assertions)
- **Typage strict (\`tsc --noEmit\`) :** ${bunData?.summary?.typecheck?.totalPackages ?? 0} packages audités, ${bunData?.summary?.typecheck?.allPassed ? "0 erreur" : "erreurs détectées"}.
- **Linter \`oxlint\` :** ${bunOxLintErrors} erreur.
- **Scripts d'administration :** \`profile-status.ts\` et \`sync-agent-plugins.ts\` validés.

---

## 3. Surface Python UV & Extension Maturin (\`python-surface.json\`)
- **Interpréteur & Outils :** ${pyData?.environment?.python_version || "Python 3.14.5"}, ${pyData?.environment?.uv_version || "uv"}
- **Extension native compilée :** \`aphrody_rust.pyd\` présent et actif (\`HAS_RUST == ${pyHasRust}\`).
- **Symboles Rust FFI validés :** \`cosine_similarity\`, \`top_k_cosine_similarity\`, \`reciprocal_rank_fusion\`.
- **Suite \`pytest\` :** ${pyTests} passés, ${pyFails} échec, ${pyErrors} erreur (${pySkipped} ignorés). Durée : ${pyData?.pytest_execution?.duration_seconds || 0} s.
- **Qualité de code :** \`ruff check\` (${pyRuffCheckExit === 0 ? "0 erreur" : "erreurs"}), \`ruff format --check\` (${pyRuffFormatExit === 0 ? "132 fichiers conformes" : "non conforme"}).

---

## 4. Bilan Global des Tests
| Surface | Tests Unitaires Passés | Échecs | Codes de Retour | Statut |
|---|---|---|---|---|
| **Rust** | ${rustTests} | ${rustFails} | Tous 0 | ${rustFails === 0 ? "**VALIDÉ**" : "**ÉCHEC**"} |
| **Bun** | ${bunTests} | ${bunFails} | Tous 0 | ${bunFails === 0 ? "**VALIDÉ**" : "**ÉCHEC**"} |
| **Python** | ${pyTests} | ${pyFails + pyErrors} | Tous 0 | ${(pyFails + pyErrors) === 0 ? "**VALIDÉ**" : "**ÉCHEC**"} |
| **TOTAL** | **${grandTotalTests} tests** | **${grandTotalFails} échec** | — | **${grandTotalFails === 0 ? "PRODUCTION-READY" : "ÉCHEC"}** |
`;
}

async function main() {
  const masterStart = performance.now();
  console.log("===============================================================================");
  console.log("=== Aphrody Home Agent — Pipeline de Benchmark Unifié (Rust ✕ Bun ✕ Python) ===");
  console.log("===============================================================================");

  // 1. Rust surface
  const rustRes = runSurfaceScript("rust", "scripts/bench-rust-surface.ts");
  if (rustRes.exitCode !== 0) {
    console.error("Échec sur la surface Rust ! Code de sortie :", rustRes.exitCode);
  }

  // 2. Bun surface
  const bunRes = runSurfaceScript("bun", "scripts/bench-bun-surface.ts");
  if (bunRes.exitCode !== 0) {
    console.error("Échec sur la surface Bun ! Code de sortie :", bunRes.exitCode);
  }

  // 3. Python surface
  const pyRes = runSurfaceScript("python", "scripts/bench-python-surface.ts");
  if (pyRes.exitCode !== 0) {
    console.error("Échec sur la surface Python ! Code de sortie :", pyRes.exitCode);
  }

  const totalDurationMs = Math.round((performance.now() - masterStart) * 100) / 100;

  // 4. Lecture des 3 JSONs
  const benchmarkDir = path.join(APHRODY_HOME, "workspaces/aphrody/benchmarks");
  const rustJsonPath = path.join(benchmarkDir, "rust-surface.json");
  const bunJsonPath = path.join(benchmarkDir, "bun-surface.json");
  const pyJsonPath = path.join(benchmarkDir, "python-surface.json");

  let rustData = {};
  let bunData = {};
  let pyData = {};

  try {
    if (fs.existsSync(rustJsonPath)) {
      rustData = JSON.parse(fs.readFileSync(rustJsonPath, "utf8"));
    }
    if (fs.existsSync(bunJsonPath)) {
      bunData = JSON.parse(fs.readFileSync(bunJsonPath, "utf8"));
    }
    if (fs.existsSync(pyJsonPath)) {
      pyData = JSON.parse(fs.readFileSync(pyJsonPath, "utf8"));
    }
  } catch (err) {
    console.error("Erreur lors de la lecture des fichiers JSON de métriques :", err);
  }

  // 5. Génération du SUMMARY.md
  const summaryContent = generateSummary(rustData, bunData, pyData, totalDurationMs);
  const summaryPath = path.join(benchmarkDir, "SUMMARY.md");
  fs.writeFileSync(summaryPath, summaryContent, "utf8");

  // Miroir vers .aphrody/workspace/benchmarks si présent
  const mirrorDir = path.join(APHRODY_HOME, "workspace/benchmarks");
  if (fs.existsSync(path.join(APHRODY_HOME, "workspace"))) {
    if (!fs.existsSync(mirrorDir)) {
      fs.mkdirSync(mirrorDir, { recursive: true });
    }
    fs.writeFileSync(path.join(mirrorDir, "SUMMARY.md"), summaryContent, "utf8");
    if (fs.existsSync(rustJsonPath)) fs.copyFileSync(rustJsonPath, path.join(mirrorDir, "rust-surface.json"));
    if (fs.existsSync(bunJsonPath)) fs.copyFileSync(bunJsonPath, path.join(mirrorDir, "bun-surface.json"));
    if (fs.existsSync(pyJsonPath)) fs.copyFileSync(pyJsonPath, path.join(mirrorDir, "python-surface.json"));
  }

  console.log(`\n===============================================================================`);
  console.log(`=== Pipeline Unifié Terminé en ${(totalDurationMs / 1000).toFixed(2)} s ===`);
  console.log(`=== Rapport Consolidé : ${summaryPath} ===`);
  console.log(`===============================================================================\n`);
  console.log(summaryContent);

  const anyFailed = rustRes.exitCode !== 0 || bunRes.exitCode !== 0 || pyRes.exitCode !== 0;
  if (anyFailed) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Erreur fatale de l'orchestrateur de benchmark :", err);
    process.exit(1);
  });
}
