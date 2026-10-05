/**
 * `yolo py`: Python + uv + PyO3 toolchain commands.
 *
 *   yolo py status [--json|--md]     status of Python, uv, maturin, PyO3 and packages/engine/python
 *   yolo py test                     runs Python pytest test suite via uv
 *   yolo py lint                     runs ruff check
 *   yolo py fmt                      runs ruff format
 *   yolo py build                    builds native PyO3 extension via maturin
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { yoloHome, yoloVersion } from "./home";

export interface PythonStatusReport {
  readonly schema: "yolo.python/1";
  readonly yoloVersion: string;
  readonly pythonVersion: string | null;
  readonly uvVersion: string | null;
  readonly maturinVersion: string | null;
  readonly ruffVersion: string | null;
  readonly packageConfigured: boolean;
  readonly venvActive: boolean;
  readonly ok: boolean;
}

export async function runPythonCommand(
  args: string[],
  root: string = yoloHome(),
  deps: { out?: (line: string) => void } = {},
): Promise<number> {
  const out = deps.out ?? ((line: string) => console.log(line));
  const sub = args[0] ?? "status";
  const json = args.includes("--json");
  const md = args.includes("--md");

  const uvBin = Bun.which("uv");
  const pyBin = Bun.which("python3") ?? Bun.which("python");
  const maturinBin = Bun.which("maturin");
  const ruffBin = Bun.which("ruff");

  if (sub === "status") {
    let pyVer: string | null = null;
    if (pyBin) {
      const proc = Bun.spawnSync([pyBin, "--version"]);
      pyVer = proc.stdout.toString().trim() || null;
    }
    let uvVer: string | null = null;
    if (uvBin) {
      const proc = Bun.spawnSync([uvBin, "--version"]);
      uvVer = proc.stdout.toString().trim() || null;
    }
    let maturinVer: string | null = null;
    if (maturinBin) {
      const proc = Bun.spawnSync([maturinBin, "--version"]);
      maturinVer = proc.stdout.toString().trim() || null;
    }
    let ruffVer: string | null = null;
    if (ruffBin) {
      const proc = Bun.spawnSync([ruffBin, "--version"]);
      ruffVer = proc.stdout.toString().trim() || null;
    }

    const pkgDir = join(root, "packages/engine/python");
    const packageConfigured = existsSync(join(pkgDir, "pyproject.toml"));
    const venvActive = existsSync(join(pkgDir, ".venv"));

    const report: PythonStatusReport = {
      schema: "yolo.python/1",
      yoloVersion: yoloVersion(),
      pythonVersion: pyVer,
      uvVersion: uvVer,
      maturinVersion: maturinVer,
      ruffVersion: ruffVer,
      packageConfigured,
      venvActive,
      ok: Boolean(uvBin && packageConfigured),
    };

    if (json) {
      out(JSON.stringify(report, null, 2));
      return 0;
    }

    if (md) {
      out("# YOLO Python / uv / PyO3 Runtime Status");
      out(`- **YOLO Version:** \`${report.yoloVersion}\``);
      out(`- **Python:** ${report.pythonVersion ?? "Not found"}`);
      out(`- **Astral uv:** ${report.uvVersion ?? "Not found"}`);
      out(`- **Maturin (PyO3):** ${report.maturinVersion ?? "Not found"}`);
      out(`- **Ruff:** ${report.ruffVersion ?? "Not found"}`);
      out(`- **Package Configured:** ${report.packageConfigured ? "✔ Yes" : "✘ No"}`);
      out(`- **Virtualenv Ready:** ${report.venvActive ? "✔ Yes" : "✘ No"}`);
      return 0;
    }

    out(`\x1b[1mYOLO Python / uv / PyO3 Toolchain\x1b[0m`);
    out(`  Python:       ${pyVer ?? "\x1b[31mmissing\x1b[0m"}`);
    out(`  Astral uv:    ${uvVer ?? "\x1b[31mmissing\x1b[0m"}`);
    out(`  Maturin:      ${maturinVer ?? "\x1b[33mnot found\x1b[0m"}`);
    out(`  Ruff:         ${ruffVer ?? "\x1b[33mnot found\x1b[0m"}`);
    out(
      `  Package:      ${packageConfigured ? "\x1b[32mpackages/engine/python (configured)\x1b[0m" : "\x1b[31mnot configured\x1b[0m"}`,
    );
    out(
      `  Virtualenv:   ${venvActive ? "\x1b[32mready (.venv)\x1b[0m" : "\x1b[33mnot initialized\x1b[0m"}`,
    );
    return 0;
  }

  if (sub === "test") {
    if (!uvBin) {
      console.error("uv is required to run Python tests (https://github.com/astral-sh/uv)");
      return 1;
    }
    const proc = Bun.spawn(
      [
        "uv",
        "run",
        "--package",
        "yolo",
        "--extra",
        "dev",
        "--no-sync",
        "--",
        "python",
        "-m",
        "pytest",
        "packages/engine/python/tests",
      ],
      {
        cwd: root,
        stdio: ["inherit", "inherit", "inherit"],
      },
    );
    return (await proc.exited) ?? 1;
  }

  if (sub === "lint") {
    const cmd = ruffBin ? [ruffBin, "check", "packages/engine/python"] : null;
    if (!cmd) {
      console.error("The installed ruff binary is required for Python linting");
      return 1;
    }
    const proc = Bun.spawn(cmd, { cwd: root, stdio: ["inherit", "inherit", "inherit"] });
    return (await proc.exited) ?? 1;
  }

  if (sub === "fmt") {
    const cmd = ruffBin ? [ruffBin, "format", "packages/engine/python"] : null;
    if (!cmd) {
      console.error("The installed ruff binary is required for Python formatting");
      return 1;
    }
    const proc = Bun.spawn(cmd, { cwd: root, stdio: ["inherit", "inherit", "inherit"] });
    return (await proc.exited) ?? 1;
  }

  if (sub === "build") {
    if (!uvBin) {
      console.error("uv is required to build the PyO3 native extension");
      return 1;
    }
    const proc = Bun.spawn(
      ["uv", "run", "--directory", "packages/engine/python", "maturin", "develop", "--release"],
      {
        cwd: root,
        stdio: ["inherit", "inherit", "inherit"],
      },
    );
    return (await proc.exited) ?? 1;
  }

  console.error(`Unknown python subcommand: ${sub}`);
  console.error("Usage: yolo py [status|test|lint|fmt|build] [--json|--md]");
  return 2;
}
