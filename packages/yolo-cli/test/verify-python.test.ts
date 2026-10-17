import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATES, runGates, runVerifyCommand, selectChanged, spawnRunner, type Gate, type Report } from "../src/verify";

const nativeTools = Boolean(Bun.which("uv") && Bun.which("python3") && Bun.which("ruff"));

function pythonGate(id: string): Gate {
  const gate = GATES.find(entry => entry.id === id);
  if (!gate) throw new Error(`Missing Python gate: ${id}`);
  return gate;
}

const selected = (file: string): string[] => selectChanged(GATES, [file]).map(gate => gate.id);

describe("Python verification owners", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "yolo-verify-python-"));

  beforeAll(async () => {
    mkdirSync(join(fixtureRoot, "packages/engine/python/python/yolo"), {
      recursive: true,
    });
    mkdirSync(join(fixtureRoot, "packages/engine/python/tests"), {
      recursive: true,
    });
    mkdirSync(join(fixtureRoot, "plugins"));
    mkdirSync(join(fixtureRoot, "design"));
    await Promise.all([
      Bun.write(
        join(fixtureRoot, "pyproject.toml"),
        `[project]\nname = "workspace"\nversion = "0.1.0"\nrequires-python = ">=3.12"\n\n[tool.uv]\npackage = false\n\n[tool.uv.workspace]\nmembers = ["packages/engine/python"]\n`,
      ),
      Bun.write(
        join(fixtureRoot, "packages/engine/python/pyproject.toml"),
        `[project]\nname = "yolo"\nversion = "0.1.0"\nrequires-python = ">=3.12"\n`,
      ),
      Bun.write(join(fixtureRoot, "packages/engine/python/python/yolo/__init__.py"), ""),
      Bun.write(
        join(fixtureRoot, "packages/engine/python/tests/test_engine.py"),
        "def test_engine():\n    assert True\n",
      ),
      Bun.write(join(fixtureRoot, "plugins/foreign.py"), "invalid syntax!!!\n"),
      Bun.write(join(fixtureRoot, "design/foreign.py"), "invalid syntax!!!\n"),
    ]);
    if (nativeTools) {
      const proc = Bun.spawn(
        ["uv", "venv", "--no-python-downloads", "--python", Bun.which("python3")!, join(fixtureRoot, ".venv")],
        { windowsHide: true, cwd: fixtureRoot, stdout: "pipe", stderr: "pipe" },
      );
      const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      if (code !== 0) throw new Error(`Cannot prepare native uv test environment: ${stderr}`);
      const python = Bun.spawn(
        [
          "uv",
          "run",
          "--package",
          "yolo",
          "--no-sync",
          "--",
          "python",
          "-c",
          "import sysconfig; print(sysconfig.get_path('purelib'))",
        ],
        { windowsHide: true, cwd: fixtureRoot, stdout: "pipe", stderr: "pipe" },
      );
      const [pythonCode, purelib, pythonStderr] = await Promise.all([
        python.exited,
        new Response(python.stdout).text(),
        new Response(python.stderr).text(),
      ]);
      if (pythonCode !== 0) throw new Error(`Cannot locate native uv test site-packages: ${pythonStderr}`);
      await Bun.write(
        join(purelib.trim(), "yolo-fixture.pth"),
        `${join(fixtureRoot, "packages/engine/python/python")}\n`,
      );
    }
  });

  afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  it.skipIf(!nativeTools)("lints owned files while leaving separately owned submodules to their gates", async () => {
    const run = spawnRunner(fixtureRoot, 30_000);
    expect((await run(pythonGate("python-lint"))).exitCode).toBe(0);
    await Bun.write(
      join(fixtureRoot, "packages/engine/python/python/yolo/broken.py"),
      "def broken():\n    return missing_name\n",
    );
    try {
      const invalid = await run(pythonGate("python-lint"));
      expect(invalid.exitCode).toBe(1);
      expect(invalid.output).toContain("F821");
      expect(invalid.output).toContain("missing_name");
      expect(invalid.output).not.toContain("foreign.py");
    } finally {
      rmSync(join(fixtureRoot, "packages/engine/python/python/yolo/broken.py"));
    }
  });

  it.skipIf(!nativeTools)(
    "fails a missing native extension prerequisite and prevents pytest from reporting success",
    async () => {
      const { results } = await runGates(
        [pythonGate("python-native"), pythonGate("python-test")],
        spawnRunner(fixtureRoot, 30_000),
        { root: fixtureRoot, parallel: 2 },
      );
      expect(results[0]?.status).toBe("fail");
      expect(results[0]?.detail).toContain("No module named 'yolo._yolo_native'");
      expect(results[1]).toMatchObject({
        status: "skipped",
        detail: "dependency python-native did not pass",
      });
    },
  );

  it.skipIf(!nativeTools)("fails missing workspace pytest instead of falling back to a system executable", async () => {
    const result = await spawnRunner(fixtureRoot, 30_000)(pythonGate("python-test"));
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("No module named pytest");
    expect(result.output).not.toContain("test session starts");
  });

  it("selects Python contracts and extension stubs, without treating submodules as owned Python", () => {
    for (const file of [
      "packages/engine/python/python/yolo/_yolo_native.pyi",
      "packages/engine/python/pyproject.toml",
      "uv.lock",
    ]) {
      expect(selected(file)).toContain("python-native");
      expect(selected(file)).toContain("python-test");
    }
    expect(selected("packages/engine/python/pyproject.toml")).toContain("python-native");
    expect(selected("crates/engine/yolo-core/src/lib.rs")).not.toContain("python-native");
    expect(selected("plugins/foreign.py")).not.toContain("python-lint");
    expect(selected("design/foreign.py")).not.toContain("python-lint");
  });

  it("includes the required native import when only Python tests are requested", async () => {
    const executed: string[] = [];
    let report: Report | undefined;
    const code = await runVerifyCommand(["--only", "python-test", "--json"], fixtureRoot, {
      run: async gate => {
        executed.push(gate.id);
        return {
          exitCode: gate.id === "python-native" ? 1 : 0,
          output: "native extension missing",
        };
      },
      out: text => {
        report = JSON.parse(text) as Report;
      },
    });
    expect(code).toBe(1);
    expect(executed).toEqual(["python-native"]);
    expect(report?.ok).toBe(false);
    expect(report?.gates.map(gate => gate.id)).toEqual(["python-native", "python-test"]);
    expect(report?.gates[0]?.status).toBe("fail");
    expect(report?.gates[1]).toMatchObject({
      status: "skipped",
      detail: "dependency python-native did not pass",
    });
  });

  it("includes transitive prerequisites for both explicit and changed-file selection", async () => {
    const init = Bun.spawnSync(["git", "init", "--quiet", fixtureRoot], {
      windowsHide: true,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(init.exitCode).toBe(0);
    await Bun.write(join(fixtureRoot, "workflow.py"), "# changed workflow\n");
    const catalog: Gate[] = [
      {
        id: "prepare",
        title: "prepare",
        command: ["fake"],
        surfaces: ["prepare.txt"],
      },
      {
        id: "native",
        title: "native",
        command: ["fake"],
        surfaces: ["native.txt"],
        needs: ["prepare"],
      },
      {
        id: "test",
        title: "test",
        command: ["fake"],
        surfaces: ["workflow.py"],
        needs: ["native"],
      },
    ];
    for (const args of [["--only", "test"], ["--changed"]]) {
      const executed: string[] = [];
      // oxlint-disable-next-line no-await-in-loop -- each mode is a full verify run over the same fixture root; the runs are checked one after another
      const code = await runVerifyCommand(args, fixtureRoot, {
        gates: catalog,
        run: async gate => {
          executed.push(gate.id);
          return { exitCode: 0, output: "" };
        },
        out: () => {},
      });
      expect(code).toBe(0);
      expect(executed).toEqual(["prepare", "native", "test"]);
    }
  });
});
