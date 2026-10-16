/**
 * Environment diagnostics and stack maturation toolchain verification.
 */
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { hostTarget, loadArtifact, runtimeHome } from "@aphrody/runtime-sdk/src/artifact.ts";
import { list } from "@aphrody/runtime-sdk/src/release.ts";
import { isCompiled, yoloHome, yoloVersion } from "../vfs/home";
import { templatesRoot } from "../scaffold/create";

export interface DoctorComponent {
  readonly label: string;
  readonly path: string;
  readonly exists: boolean;
  readonly required: boolean;
}

export interface DoctorReport {
  readonly schema: "yolo.doctor/1";
  readonly timestamp: string;
  readonly home: string;
  readonly yoloVersion: string;
  readonly hostTarget: string;
  readonly bunVersion: string;
  readonly tools: readonly { name: string; found: boolean }[];
  readonly codeIntel: readonly { name: string; found: boolean }[];
  readonly components: readonly DoctorComponent[];
  readonly stack: {
    readonly bun: { version: string; ok: boolean };
    readonly rust: {
      found: boolean;
      cargo?: string | undefined;
      rustc?: string | undefined;
    };
    readonly cCompiler: { found: boolean; bin?: string | undefined };
    readonly python: {
      found: boolean;
      uv?: string | undefined;
      python?: string | undefined;
      maturin?: string | undefined;
    };
  };
  readonly runtime: {
    readonly installed: boolean;
    readonly active?: string | undefined;
    readonly abi?: string | undefined;
    readonly version?: string | undefined;
    readonly capabilities?: readonly string[] | undefined;
    readonly panicRecovery?: boolean | undefined;
    readonly error?: string | undefined;
  };
  readonly rollbackAvailable?: string | undefined;
  readonly binOnPath: boolean;
  readonly ghFound: boolean;
  readonly ok: boolean;
}

export function aphrodyTools(): { name: string; found: boolean }[] {
  return ["aphrody-infra"].map(name => ({
    name,
    found: Boolean(Bun.which(name)),
  }));
}

/** Language servers and context-reduction tools (yolo `infra/config/host/toolchain.json` codeIntel). */
export function codeIntelTools(): { name: string; found: boolean }[] {
  return ["rust-analyzer", "tsc", "rtk", "context-mode"].map(name => ({
    name,
    found: Boolean(Bun.which(name)),
  }));
}

export function collectDoctorReport(): DoctorReport {
  const home = yoloHome();
  const sourceInstallation = !isCompiled();
  let okStatus = true;

  const tools = aphrodyTools();

  const components: DoctorComponent[] = [];
  for (const [path, label, required] of [
    [join(templatesRoot(home), "stack.toml"), "templates (yolo create)", true],
    ["packages/engine/runtime/package.json", "runtime SDK", true],
    ["packages/engine/python/pyproject.toml", "Python package (uv / maturin)", sourceInstallation],
    [join(templatesRoot(home), "desktop/src-tauri/icons"), "desktop scaffold icons (templates)", false],
  ] as const) {
    const exists = existsSync(resolve(home, path));
    if (!exists && required) okStatus = false;
    components.push({ label, path, exists, required });
  }

  // Stack maturation toolchain probe
  const cargoBin = Bun.which("cargo");
  const rustcBin = Bun.which("rustc");
  const cBin = Bun.which("clang") ?? Bun.which("gcc");
  const uvBin = Bun.which("uv");
  const pyBin = Bun.which("python3") ?? Bun.which("python");
  const maturinBin = Bun.which("maturin");

  const stack = {
    bun: { version: Bun.version, ok: true },
    rust: {
      found: Boolean(cargoBin && rustcBin),
      cargo: cargoBin ?? undefined,
      rustc: rustcBin ?? undefined,
    },
    cCompiler: {
      found: Boolean(cBin),
      bin: cBin ?? undefined,
    },
    python: {
      found: Boolean(uvBin || pyBin),
      uv: uvBin ?? undefined,
      python: pyBin ?? undefined,
      maturin: maturinBin ?? undefined,
    },
  };

  let runtimeInfo: DoctorReport["runtime"] = { installed: false };
  const active = list().find(e => e.current);
  if (active === undefined) {
    // A source checkout runs without the native artifact; only a compiled install requires it.
    if (!sourceInstallation) okStatus = false;
    runtimeInfo = { installed: false, error: "no runtime artifact installed" };
  } else {
    try {
      using runtime = loadArtifact(join(runtimeHome(), hostTarget(), active.name));
      const info = runtime.buildInfo();
      runtimeInfo = {
        installed: true,
        active: active.name,
        abi: info.abi,
        version: info.version,
        capabilities: runtime.capabilities(),
        panicRecovery: info.panic_recovery,
      };
    } catch (err) {
      okStatus = false;
      runtimeInfo = {
        installed: true,
        active: active.name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const previous = list().find(e => e.previous);
  const bin = join(home, "bin");
  const binOnPath = (process.env["PATH"] ?? "").split(delimiter).includes(bin);
  const ghFound = Boolean(Bun.which("gh"));

  return {
    schema: "yolo.doctor/1",
    timestamp: new Date().toISOString(),
    home,
    yoloVersion: yoloVersion(),
    hostTarget: hostTarget(),
    bunVersion: Bun.version,
    tools,
    codeIntel: codeIntelTools(),
    components,
    stack,
    runtime: runtimeInfo,
    rollbackAvailable: previous?.name,
    binOnPath,
    ghFound,
    ok: okStatus,
  };
}

const statusIcon = (val: boolean): string => (val ? "✔ pass" : "✘ fail");

export function renderDoctorMarkdown(report: DoctorReport): string {
  const lines = [
    `# yolo doctor: ${report.ok ? "PASS" : "WARN/FAIL"}`,
    "",
    `- **Home:** \`${report.home}\``,
    `- **Version:** \`${report.yoloVersion}\` (\`${report.hostTarget}\`)`,
    `- **Bun:** \`${report.bunVersion}\``,
    `- **Bin on PATH:** ${report.binOnPath ? "Yes" : "No"}`,
    "",
    "## Stack Maturation Toolchain",
    "",
    "| Tier | Technology | Status | Path / Info |",
    "| :--- | :--- | :--- | :--- |",
    `| Tier 1 (Default) | Bun / TypeScript | ✔ active | v${report.stack.bun.version} |`,
    `| Tier 2 (Critique) | Rust & Cargo | ${report.stack.rust.found ? "✔ installed" : "! missing"} | ${report.stack.rust.cargo ?? "none"} |`,
    `| Tier 3 (Natif) | C / C++ Compiler | ${report.stack.cCompiler.found ? "✔ installed" : "! missing"} | ${report.stack.cCompiler.bin ?? "none"} |`,
    `| Tier 5 (Python/uv) | Python via uv | ${report.stack.python.uv ? "✔ uv ready" : report.stack.python.found ? "! python without uv" : "! missing"} | ${report.stack.python.uv ?? report.stack.python.python ?? "none"} |`,
    "",
    "## Installed Components",
    "",
    "| Component | Path | Status |",
    "| :--- | :--- | :--- |",
  ];

  for (const c of report.components) {
    lines.push(`| ${c.label} | \`${c.path}\` | ${statusIcon(c.exists)} |`);
  }

  lines.push("", "## Native Runtime Artifact", "");
  if (report.runtime.installed && !report.runtime.error) {
    lines.push(
      `- **Active:** \`${report.runtime.active}\` (ABI ${report.runtime.abi}, v${report.runtime.version})`,
      `- **Capabilities:** ${(report.runtime.capabilities ?? []).join(", ") || "none"}`,
      `- **Panic Recovery:** ${report.runtime.panicRecovery ? "enabled" : "disabled"}`,
    );
  } else {
    lines.push(`- **Status:** ${report.runtime.error ?? "Not installed"}`);
  }

  return lines.join("\n");
}
