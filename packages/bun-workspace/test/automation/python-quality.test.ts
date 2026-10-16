import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPythonQuality, type PythonQualityRunner } from "../../src/automation/python-quality.ts";

const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "aphrody-python-quality-"));
  fixtures.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(root, path);
    mkdirSync(join(destination, ".."), { recursive: true });
    writeFileSync(destination, contents);
  }
  return root;
}

function capture(exitCode = 0) {
  const calls: string[][] = [];
  const run: PythonQualityRunner = args => {
    calls.push(args);
    return args.includes("pytest") ? exitCode : 0;
  };
  return { calls, run };
}

test("nested IECODE tests run even without a root tests directory", () => {
  const root = fixture({
    "src/niepy/tests/test_contract.py": "def test_contract(): pass",
  });
  const { calls, run } = capture();
  expect(runPythonQuality(["test", "--root", root, "--source", "src/niepy", "--no-build"], run)).toBe(0);
  expect(calls).toEqual([
    ["uv", "run", "--frozen", "--no-sync", "python", "-m", "compileall", "-q", "src/niepy"],
    ["uv", "run", "--frozen", "--no-sync", "pytest", "-q", "src/niepy"],
  ]);
});

test("configured Python workspace testpaths are used without a src directory", () => {
  const root = fixture({
    "pyproject.toml": '[tool.pytest.ini_options]\ntestpaths = ["packages/sdk/tests"]\n',
    "packages/sdk/tests/test_contract.py": "def test_contract(): pass",
  });
  const { calls, run } = capture();
  expect(runPythonQuality(["test", "--root", root, "--no-build"], run)).toBe(0);
  expect(calls[1]).toContain("packages/sdk/tests");
});

test("zero collected tests and failing tests cannot become successful gates", () => {
  const root = fixture({ "src/no_tests.py": "x = 1" });
  for (const exitCode of [1, 5]) {
    const { calls, run } = capture(exitCode);
    expect(runPythonQuality(["test", "--root", root, "--no-build"], run)).toBe(exitCode);
    expect(calls).toHaveLength(2);
  }
});

test("missing or misspelled source roots fail before running commands", () => {
  const root = fixture({});
  const { calls, run } = capture();
  expect(() => runPythonQuality(["test", "--root", root], run)).toThrow("No Python test roots");
  expect(() => runPythonQuality(["test", "--root", root, "--source", "src/typo"], run)).toThrow("does not exist");
  expect(calls).toHaveLength(0);
});

test("syntax failures stop before pytest", () => {
  const root = fixture({ "tests/test_contract.py": "invalid syntax" });
  const calls: string[][] = [];
  expect(
    runPythonQuality(["test", "--root", root], args => {
      calls.push(args);
      return 1;
    }),
  ).toBe(1);
  expect(calls).toHaveLength(1);
});

test("lint no-build mode uses installed tools and propagates failures", () => {
  const { calls, run } = capture();
  runPythonQuality(["lint", "--root", tmpdir(), "--no-build"], run);
  expect(calls).toEqual([["uv", "run", "--frozen", "--no-sync", "ruff", "check"]]);
  expect(runPythonQuality(["lint", "--root", tmpdir(), "--no-build"], () => 3)).toBe(3);
});

test("legacy normal mode remains available explicitly through absence of no-build", () => {
  const previous = process.env.APHRODY_NO_BUILD;
  delete process.env.APHRODY_NO_BUILD;
  try {
    const { calls, run } = capture();
    runPythonQuality(["lint", "--root", tmpdir()], run);
    expect(calls[0]).toEqual(["uv", "run", "--only-group", "dev", "ruff", "check"]);
  } finally {
    if (previous === undefined) delete process.env.APHRODY_NO_BUILD;
    else process.env.APHRODY_NO_BUILD = previous;
  }
});

test("environment no-build policy also disables uv synchronization", () => {
  const previous = process.env.APHRODY_NO_BUILD;
  process.env.APHRODY_NO_BUILD = "1";
  try {
    const { calls, run } = capture();
    runPythonQuality(["lint", "--root", tmpdir()], run);
    expect(calls[0]).toContain("--no-sync");
    expect(calls[0]).not.toContain("--only-group");
  } finally {
    if (previous === undefined) delete process.env.APHRODY_NO_BUILD;
    else process.env.APHRODY_NO_BUILD = previous;
  }
});

test("invalid configured testpaths fail rather than silently falling back", () => {
  const root = fixture({
    "pyproject.toml": '[tool.pytest.ini_options]\ntestpaths = "src"\n',
  });
  expect(() => runPythonQuality(["test", "--root", root], () => 0)).toThrow("testpaths must contain");
});
