/**
 * `yolo py`: Python + uv + PyO3 toolchain commands.
 *
 *   yolo py status [--json|--md]     status of Python, uv, maturin, ruff, the vu runtime, the py/ workspace and
 *                                    packages/engine/python
 *   yolo py test                     runs the py/ pytest suite via uv (--engine: packages/engine/python)
 *   yolo py lint                     runs ruff check on py/ (--engine: packages/engine/python)
 *   yolo py fmt                      runs ruff format on py/ (--engine: packages/engine/python)
 *   yolo py check|locks|distributions|providers|typecheck|format:check|plan [--timeout-ms <n>]
 *                                    bounded supervisor of the py/ workspace (timeout, output budget, cancellation,
 *                                    JSON receipt on stdout) through the verified Yolo runtime artifact
 *   yolo py vu <args> | add|remove|sync|lock|run|pip|python|ffi|hf|compile|uv|ruff ...
 *                                    delegated to the installed vu artifact (package manager, interpreters, ffi, hf, compiler)
 *   yolo py build                    builds the aphrody wheel (pinned Bun native adapter via maturin) into py/dist
 *                                    (--engine: maturin develop of packages/engine/python)
 *
 * Tools: `uv` and `ruff` come from the verified vu runtime artifact (`$VU_HOME`, default ~/.vu, or `--vu <dir>`;
 * manifest, target, CLI major and executable hashes are checked first, `--vu-full` checks every file) and fall back to
 * the tools on PATH when no artifact is installed. A damaged artifact is refused, never bypassed silently:
 * `--no-vu` selects the PATH tools explicitly. See docs/plans/vu/PLAN.md.
 *
 * py/ is the fused Python workspace. The wheel build compiles Rust: run it on the serialized build host, never in WSL.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { yoloHome, yoloVersion } from "./home";
import { pathWithVu, resolveVu, vuExecutable, type VuState } from "./vu";

type Env = Readonly<Record<string, string | undefined>>;

export interface VuStatus {
  readonly state: VuState["state"];
  readonly version?: string;
  readonly revision?: string;
  readonly target?: string;
  readonly artifact?: string;
  readonly checked?: "quick" | "full";
  readonly problems?: readonly string[];
  readonly reason?: string;
}

export interface PythonStatusReport {
  readonly schema: "yolo.python/1";
  readonly yoloVersion: string;
  readonly pythonVersion: string | null;
  readonly uvVersion: string | null;
  readonly maturinVersion: string | null;
  readonly ruffVersion: string | null;
  readonly toolSource: "vu" | "path";
  readonly vu: VuStatus;
  readonly packageConfigured: boolean;
  readonly workspaceConfigured: boolean;
  readonly venvActive: boolean;
  readonly ok: boolean;
}

export interface PythonDeps {
  out?: (line: string) => void;
  env?: Env;
  home?: string;
  /** Runs a command to completion with the given environment; the default inherits stdio. */
  run?: (command: string[], options: { cwd: string; env: Env }) => Promise<number>;
}

export interface PythonTools {
  readonly source: "vu" | "path";
  readonly vu: VuStatus;
  readonly uv: string | null;
  readonly ruff: string | null;
  readonly python: string | null;
  readonly env: Env;
  /** Why no command may run (a damaged or unusable artifact), or null. */
  readonly refusal: string | null;
}

/** Commands answered by the vu artifact's own binary (`vu <verb>`). */
const VU_VERBS: ReadonlySet<string> = new Set([
  "add",
  "remove",
  "sync",
  "lock",
  "tree",
  "init",
  "venv",
  "publish",
  "export",
  "tool",
  "cache",
  "pip",
  "run",
  "python",
  "ffi",
  "hf",
  "compile",
  "uv",
  "ruff",
]);

function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function describeVu(state: VuState): VuStatus {
  if (state.state === "verified") {
    return {
      state: "verified",
      version: state.manifest.version,
      revision: state.manifest.revision,
      target: state.manifest.target,
      artifact: state.dir,
      checked: state.full ? "full" : "quick",
    };
  }
  if (state.state === "invalid") return { state: "invalid", artifact: state.dir, problems: state.problems };
  return { state: "absent", reason: state.reason };
}

/** The tools of this invocation: the verified runtime artifact, else the tools on PATH. */
export async function resolveTools(args: readonly string[], deps: PythonDeps = {}): Promise<PythonTools> {
  const env = deps.env ?? process.env;
  const explicit = flag(args, "--vu");
  if (args.includes("--no-vu")) {
    return fromPath(env, { state: "absent", reason: "--no-vu" }, null);
  }
  const state = await resolveVu({
    artifact: explicit,
    env,
    home: deps.home,
    full: args.includes("--vu-full"),
  });
  if (state.state === "verified") {
    const bin = (name: "uv" | "ruff" | "python"): string => join(state.dir, vuExecutable(name, state.manifest.target));
    return {
      source: "vu",
      vu: describeVu(state),
      uv: bin("uv"),
      ruff: bin("ruff"),
      python: bin("python"),
      env: {
        ...env,
        PATH: pathWithVu(state.dir, env["PATH"]),
        VU_RUNTIME: state.dir,
      },
      refusal: null,
    };
  }
  // An explicit --vu that is not usable, or an installed artifact that fails verification, never degrades silently.
  const refusal =
    state.state === "invalid"
      ? `the vu runtime ${state.dir} failed verification (${state.problems.slice(0, 3).join("; ")}); use --no-vu to run the PATH tools`
      : explicit !== undefined
        ? `no usable vu runtime at ${explicit}: ${state.reason}`
        : null;
  return fromPath(env, describeVu(state), refusal);
}

function fromPath(env: Env, vu: VuStatus, refusal: string | null): PythonTools {
  const lookup = (name: string): string | null => Bun.which(name, { PATH: env["PATH"] ?? "" });
  return {
    source: "path",
    vu,
    uv: lookup("uv"),
    ruff: lookup("ruff"),
    python: lookup("python3") ?? lookup("python"),
    env,
    refusal,
  };
}

/** The environment as Bun wants it: no undefined values. */
function plain(env: Env): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function versionOf(program: string | null, env: Env): string | null {
  if (!program || !existsSync(program)) return null;
  try {
    const proc = Bun.spawnSync([program, "--version"], {
      windowsHide: true,
      env: plain(env),
    });
    return proc.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

export async function runPythonCommand(
  args: string[],
  root: string = yoloHome(),
  deps: PythonDeps = {},
): Promise<number> {
  const out = deps.out ?? ((line: string) => console.log(line));
  const sub = args[0] ?? "status";
  const json = args.includes("--json");
  const md = args.includes("--md");
  const engine = args.includes("--engine");
  const tools = await resolveTools(args, deps);
  const maturinBin = Bun.which("maturin", { PATH: tools.env["PATH"] ?? "" });
  const runCommand =
    deps.run ??
    (async (command: string[], options: { cwd: string; env: Env }): Promise<number> => {
      const proc = Bun.spawn(command, {
        windowsHide: true,
        cwd: options.cwd,
        env: plain(options.env),
        stdio: ["inherit", "inherit", "inherit"],
      });
      return (await proc.exited) ?? 1;
    });

  if (sub === "status") {
    const pyVer = versionOf(tools.python, tools.env);
    const uvVer = versionOf(tools.uv, tools.env);
    const maturinVer = versionOf(maturinBin, tools.env);
    const ruffVer = versionOf(tools.ruff, tools.env);

    const pkgDir = join(root, "packages/engine/python");
    const packageConfigured = existsSync(join(pkgDir, "pyproject.toml"));
    const venvActive = existsSync(join(pkgDir, ".venv"));
    const workspaceConfigured = existsSync(join(root, "py/pyproject.toml"));

    const report: PythonStatusReport = {
      schema: "yolo.python/1",
      yoloVersion: yoloVersion(),
      pythonVersion: pyVer,
      uvVersion: uvVer,
      maturinVersion: maturinVer,
      ruffVersion: ruffVer,
      toolSource: tools.source,
      vu: tools.vu,
      packageConfigured,
      workspaceConfigured,
      venvActive,
      ok: Boolean(tools.uv && tools.refusal === null && (packageConfigured || workspaceConfigured)),
    };

    if (json) {
      out(JSON.stringify(report, null, 2));
      return 0;
    }

    const vuLine =
      tools.vu.state === "verified"
        ? `verified ${tools.vu.version} (${tools.vu.checked} check) at ${tools.vu.artifact}`
        : tools.vu.state === "invalid"
          ? `INVALID at ${tools.vu.artifact}: ${(tools.vu.problems ?? []).slice(0, 3).join("; ")}`
          : `not installed (${tools.vu.reason}); PATH tools in use`;

    if (md) {
      out("# YOLO Python / uv / PyO3 Runtime Status");
      out(`- **YOLO Version:** \`${report.yoloVersion}\``);
      out(`- **vu runtime:** ${vuLine}`);
      out(`- **Tool source:** ${report.toolSource}`);
      out(`- **Python:** ${report.pythonVersion ?? "Not found"}`);
      out(`- **Astral uv:** ${report.uvVersion ?? "Not found"}`);
      out(`- **Maturin (PyO3):** ${report.maturinVersion ?? "Not found"}`);
      out(`- **Ruff:** ${report.ruffVersion ?? "Not found"}`);
      out(`- **Package Configured:** ${report.packageConfigured ? "✔ Yes" : "✘ No"}`);
      out(`- **py/ Workspace:** ${report.workspaceConfigured ? "✔ Yes" : "✘ No"}`);
      out(`- **Virtualenv Ready:** ${report.venvActive ? "✔ Yes" : "✘ No"}`);
      return 0;
    }

    out(`\x1b[1mYOLO Python / uv / PyO3 Toolchain\x1b[0m`);
    out(`  vu runtime:   ${vuLine}`);
    out(`  Python:       ${pyVer ?? "\x1b[31mmissing\x1b[0m"}`);
    out(`  Astral uv:    ${uvVer ?? "\x1b[31mmissing\x1b[0m"}`);
    out(`  Maturin:      ${maturinVer ?? "\x1b[33mnot found\x1b[0m"}`);
    out(`  Ruff:         ${ruffVer ?? "\x1b[33mnot found\x1b[0m"}`);
    out(
      `  Package:      ${packageConfigured ? "\x1b[32mpackages/engine/python (configured)\x1b[0m" : "\x1b[31mnot configured\x1b[0m"}`,
    );
    out(`  Workspace:    ${workspaceConfigured ? "\x1b[32mpy/ (configured)\x1b[0m" : "\x1b[31mpy/ not found\x1b[0m"}`);
    out(`  Virtualenv:   ${venvActive ? "\x1b[32mready (.venv)\x1b[0m" : "\x1b[33mnot initialized\x1b[0m"}`);
    return 0;
  }

  // In-process Python on the one shared libpython of the vu artifact, hosted by libaphrody (plan D18): no child
  // process, no second interpreter. `exec` runs statements, `eval` prints str(result).
  if (sub === "eval" || sub === "exec") {
    const code = args
      .slice(1)
      .filter(arg => !arg.startsWith("--"))
      .join(" ");
    if (code === "") {
      console.error(`Usage: yolo py ${sub} <python ${sub === "eval" ? "expression" : "statements"}>`);
      return 2;
    }
    const { Python, libpythonIn } = await import("@aphrody/runtime-sdk/python");
    const libpython = tools.vu.artifact === undefined ? undefined : libpythonIn(tools.vu.artifact);
    try {
      using python = Python.open(libpython === undefined ? {} : { libpython });
      if (sub === "eval") out(python.eval(code));
      else python.run(code);
      return 0;
    } catch (error) {
      console.error(`yolo py ${sub}: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  // The verbs of the vu runtime itself (package manager, interpreters, ffi, hf, compiler): `yolo` loads the installed
  // artifact and delegates (plan D18); it never links vu. `yolo py vu <args>` is the explicit form of any vu command.
  if (sub === "vu" || VU_VERBS.has(sub)) {
    if (tools.source !== "vu" || tools.vu.artifact === undefined) {
      console.error(
        `yolo py ${sub}: the vu runtime is not installed (${tools.vu.state === "absent" ? tools.vu.reason : "unusable"}); install it from the vu repository (bun scripts/install.ts --apply)`,
      );
      return 3;
    }
    const forwarded: string[] = [];
    const rest = sub === "vu" ? args.slice(1) : args;
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index]!;
      if (arg === "--vu") index++;
      else if (arg !== "--no-vu" && arg !== "--vu-full") forwarded.push(arg);
    }
    return runCommand([join(tools.vu.artifact, vuExecutable("vu", tools.vu.target)), ...forwarded], {
      cwd: process.cwd(),
      env: tools.env,
    });
  }

  const supervised = new Set(["check", "locks", "distributions", "providers", "typecheck", "format:check", "plan"]);
  if (supervised.has(sub)) {
    if (sub !== "plan" && tools.refusal !== null) {
      console.error(`yolo py ${sub}: ${tools.refusal}`);
      return 3;
    }
    const { runPythonWorkspace } = await import("@aphrody/bun-workspace/automation/python-workspace.ts");
    const rest: string[] = [];
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;
      if (arg === "--vu") index++;
      else if (!["--no-vu", "--vu-full", "--json", "--md", "--engine"].includes(arg)) rest.push(arg);
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.on("SIGINT", cancel);
    process.on("SIGTERM", cancel);
    try {
      return await runPythonWorkspace(
        rest,
        { root: join(root, "py"), uv: tools.uv ?? "uv" },
        { signal: controller.signal },
      );
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  }

  const known = new Set(["test", "lint", "fmt", "build"]);
  if (known.has(sub) && tools.refusal !== null) {
    console.error(`yolo py ${sub}: ${tools.refusal}`);
    return 3;
  }

  if (sub === "test") {
    if (!tools.uv) {
      console.error("uv is required to run Python tests (https://github.com/astral-sh/uv)");
      return 1;
    }
    const command = engine
      ? [
          tools.uv,
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
        ]
      : [tools.uv, "run", "--directory", "py", "--no-sync", "pytest"];
    return runCommand(command, { cwd: root, env: tools.env });
  }

  if (sub === "lint") {
    if (!tools.ruff) {
      console.error("The ruff binary is required for Python linting");
      return 1;
    }
    return runCommand([tools.ruff, "check", engine ? "packages/engine/python" : "py"], {
      cwd: root,
      env: tools.env,
    });
  }

  if (sub === "fmt") {
    if (!tools.ruff) {
      console.error("The ruff binary is required for Python formatting");
      return 1;
    }
    return runCommand([tools.ruff, "format", engine ? "packages/engine/python" : "py"], {
      cwd: root,
      env: tools.env,
    });
  }

  if (sub === "build") {
    if (!tools.uv) {
      console.error("uv is required to build the PyO3 native extension");
      return 1;
    }
    const command = engine
      ? [tools.uv, "run", "--directory", "packages/engine/python", "maturin", "develop", "--release"]
      : [tools.uv, "build", "--wheel", "py/packages/aphrody", "--out-dir", "py/dist"];
    return runCommand(command, { cwd: root, env: tools.env });
  }

  console.error(`Unknown python subcommand: ${sub}`);
  console.error(
    "Usage: yolo py [status|eval|exec|test|lint|fmt|build|vu|add|remove|sync|lock|run|pip|python|ffi|hf|compile|check|locks|distributions|providers|typecheck|format:check|plan] [--engine] [--timeout-ms <n>] [--vu <dir>] [--no-vu] [--vu-full] [--json|--md]",
  );
  return 2;
}
