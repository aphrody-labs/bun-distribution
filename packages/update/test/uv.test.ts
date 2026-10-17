// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ctx } from "../src/context.ts";
import {
  bumpKind,
  classifyDirect,
  cmpPy,
  discover,
  exactRequired,
  holdFor,
  latestSnapshot,
  lockArgs,
  lockFor,
  lockLabel,
  lockStates,
  lockVersions,
  parseArgs,
  parseLock,
  parseLockOutput,
  parsePy,
  parsePyProject,
  parsePypi,
  parseRequirement,
  planLocks,
  problems,
  pythonAccepts,
  pythonFloor,
  pythonPolicy,
  renderPlan,
  restoreSnapshot,
  satisfies,
  snapshot,
  syncArgs,
  testDirs,
  transitiveBehind,
  type Hold,
  type UvStatus,
} from "../src/ecosystems/uv.ts";

describe("PEP 440 order", () => {
  test("releases, pre, post, dev, epoch and local", () => {
    expect(cmpPy("0.12.21", "0.12.22")).toBe(-1);
    expect(cmpPy("2.14.1", "2.8.0")).toBe(1);
    expect(cmpPy("1.0", "1.0.0")).toBe(0);
    expect(cmpPy("1.0rc1", "1.0")).toBe(-1);
    expect(cmpPy("1.0.dev3", "1.0a1")).toBe(-1);
    expect(cmpPy("1.0a1", "1.0b1")).toBe(-1);
    expect(cmpPy("1.0.post1", "1.0")).toBe(1);
    expect(cmpPy("2.14.0b2", "2.13.5")).toBe(1);
    expect(cmpPy("1!0.1", "2.0")).toBe(1);
    expect(cmpPy("2.8.0+cu129", "2.8.0")).toBe(1);
    expect(cmpPy("2026.9.0", "2026.6.0")).toBe(1);
  });
  test("parsePy exposes the parts", () => {
    expect(parsePy("1.2.3rc2")).toMatchObject({
      release: [1, 2, 3],
      pre: [2, 2],
    });
    expect(parsePy("1.2.post4")).toMatchObject({ post: 4 });
    expect(parsePy("not a version")).toBeUndefined();
  });
});

describe("specifiers", () => {
  test("comparison sets", () => {
    expect(satisfies("5.7.0", ">=5.7,<6")).toBe(true);
    expect(satisfies("6.1.0", ">=5.7,<6")).toBe(false);
    expect(satisfies("2.8.0", "==2.8.0")).toBe(true);
    expect(satisfies("2.14.1", "==2.8.0")).toBe(false);
    expect(satisfies("3.12.4", "==3.12.*")).toBe(true);
    expect(satisfies("3.13.0", "==3.12.*")).toBe(false);
    expect(satisfies("1.0", "!=1.0")).toBe(false);
    expect(satisfies("anything", "")).toBe(true);
  });
  test("compatible release", () => {
    expect(satisfies("0.6.3", "~=0.6.1")).toBe(true);
    expect(satisfies("0.7.0", "~=0.6.1")).toBe(false);
    expect(satisfies("1.0.3", "~=0.6.1")).toBe(false);
    expect(satisfies("2.5", "~=2.2")).toBe(true);
    expect(satisfies("3.0", "~=2.2")).toBe(false);
  });
  test("a local label is ignored unless the specifier names one", () => {
    expect(satisfies("2.8.0+cu129", "==2.8.0")).toBe(true);
    expect(satisfies("2.8.0+cu129", "==2.8.0+cu128")).toBe(false);
  });
  test("python floor and release compatibility", () => {
    expect(pythonFloor(">=3.11")).toBe("3.11");
    expect(pythonFloor("==3.12.*")).toBe("3.12");
    expect(pythonFloor(">=3.12,<3.13")).toBe("3.12");
    expect(pythonFloor(undefined)).toBeUndefined();
    expect(pythonAccepts(">=3.12", "3.11")).toBe(false);
    expect(pythonAccepts(">=3.11", "3.11")).toBe(true);
    expect(pythonAccepts(undefined, "3.11")).toBe(true);
  });
});

describe("requirements and pyproject", () => {
  test("PEP 508 forms", () => {
    expect(parseRequirement("httpx>=0.28")).toEqual({
      name: "httpx",
      extras: [],
      spec: ">=0.28",
      marker: undefined,
    });
    expect(parseRequirement("Sentence_Transformers[onnx]>=5.7,<6")).toMatchObject({
      name: "sentence-transformers",
      extras: ["onnx"],
      spec: ">=5.7,<6",
    });
    expect(parseRequirement("torch==2.8.0 ; sys_platform == 'linux'")).toMatchObject({
      name: "torch",
      spec: "==2.8.0",
      marker: "sys_platform == 'linux'",
    });
    expect(parseRequirement("pkg @ https://example.test/pkg.whl")).toMatchObject({
      name: "pkg",
      spec: "",
    });
    expect(parseRequirement("")).toBeUndefined();
  });
  test("direct dependencies of every section", () => {
    const p = parsePyProject(
      "m/pyproject.toml",
      [
        "[build-system]",
        'requires = ["maturin==1.14.1"]',
        "[project]",
        'name = "Aphrody_Train"',
        'requires-python = ">=3.12,<3.13"',
        'dependencies = ["click>=8.1"]',
        "[project.optional-dependencies]",
        'full = ["torch==2.8.0", "numpy>=1.26"]',
        "[dependency-groups]",
        'dev = ["pytest>=8.3", { include-group = "x" }]',
        "[tool.uv]",
        'required-version = "==0.12.22"',
        "[tool.uv.workspace]",
        'members = ["a", "b"]',
      ].join("\n"),
    );
    expect(p.name).toBe("aphrody-train");
    expect(p.requiresPython).toBe(">=3.12,<3.13");
    expect(p.requiredVersion).toBe("==0.12.22");
    expect(p.members).toEqual(["a", "b"]);
    expect(p.deps.map(d => `${d.section}:${d.req.name}${d.req.spec}`)).toEqual([
      "dependencies:click>=8.1",
      "extra:full:torch==2.8.0",
      "extra:full:numpy>=1.26",
      "group:dev:pytest>=8.3",
      "build:maturin==1.14.1",
    ]);
  });
  test("exact required-version only", () => {
    expect(exactRequired("==0.12.22")).toBe("0.12.22");
    expect(exactRequired(">=0.12")).toBeUndefined();
  });
});

const LOCK = [
  "version = 1",
  "revision = 5",
  'requires-python = "==3.12.*"',
  "[[package]]",
  'name = "torch"',
  'version = "2.8.0+cu129"',
  'source = { registry = "https://download.pytorch.org/whl/cu129" }',
  "[[package]]",
  'name = "Click"',
  'version = "8.3.0"',
  'source = { registry = "https://pypi.org/simple" }',
  "[[package]]",
  'name = "click"',
  'version = "8.2.0"',
  'source = { registry = "https://pypi.org/simple" }',
  "[[package]]",
  'name = "langextract"',
  'version = "1.0.0"',
  'source = { git = "https://github.com/google/langextract.git?rev=x#abc" }',
  "[[package]]",
  'name = "aphrody"',
  'version = "0.1.0"',
  'source = { editable = "packages/aphrody" }',
].join("\n");

describe("uv.lock", () => {
  test("parse kinds, revision and registry versions", () => {
    const info = parseLock(LOCK);
    expect(info.revision).toBe(5);
    expect(info.requiresPython).toBe("==3.12.*");
    expect(info.packages.map(p => p.kind)).toEqual(["registry", "registry", "registry", "git", "workspace"]);
    expect(lockVersions(info).get("click")).toEqual(["8.3.0", "8.2.0"]);
    expect(lockVersions(info).has("langextract")).toBe(false);
  });
  test("uv lock output lines become changes", () => {
    const out = [
      "Resolved 234 packages in 986ms",
      "Updated filelock v4.0.8 -> v4.0.9",
      "Update onnxruntime v1.20.1, v1.30.0 -> v1.30.0",
      "Add coloredlogs v15.0.1",
      "Removed humanfriendly v10.0",
    ].join("\n");
    expect(parseLockOutput(out)).toEqual([
      { ecosystem: "uv-lock", name: "filelock", from: "4.0.8", to: "4.0.9" },
      {
        ecosystem: "uv-lock",
        name: "onnxruntime",
        from: "1.20.1,1.30.0",
        to: "1.30.0",
      },
      {
        ecosystem: "uv-lock",
        name: "coloredlogs",
        from: "(new)",
        to: "15.0.1",
      },
      {
        ecosystem: "uv-lock",
        name: "humanfriendly",
        from: "10.0",
        to: "(removed)",
      },
    ]);
  });
  test("bump kinds", () => {
    expect(bumpKind("4.0.8", "4.0.9")).toBe("patch");
    expect(bumpKind("2.26.0", "2.27.0")).toBe("minor");
    expect(bumpKind("0.36.2", "1.0.0")).toBe("major");
    expect(bumpKind("2.13.5", "2.14.0b2")).toBe("pre");
    expect(bumpKind("1.0.0", "1.0.0")).toBe("none");
  });
  test("owning lock is the nearest ancestor", () => {
    const locks = [".", "packages/aphrody", "packages/aphrody-train"];
    expect(lockFor("packages/aphrody/pyproject.toml", locks)).toBe("packages/aphrody");
    expect(lockFor("packages/aphrody-train/pyproject.toml", locks)).toBe("packages/aphrody-train");
    expect(lockFor("packages/embedding-fixtures/pyproject.toml", locks)).toBe(".");
    expect(lockFor("pyproject.toml", locks)).toBe(".");
    expect(lockFor("x/pyproject.toml", ["a"])).toBeUndefined();
    expect(lockLabel(".")).toBe("uv.lock");
    expect(lockLabel("a/b")).toBe("a/b/uv.lock");
  });
});

describe("holds", () => {
  const holds: Hold[] = [
    { name: "torch", maxVersion: "2.8.0", reason: "windows" },
    { name: "transformers", maxMajor: 4, reason: "optimum-onnx" },
    { name: "nvidia-*", reason: "follows torch" },
  ];
  test("version and major ceilings", () => {
    expect(holdFor(holds, "torch", "2.14.1")?.reason).toBe("windows");
    expect(holdFor(holds, "torch", "2.8.0")).toBeUndefined();
    expect(holdFor(holds, "transformers", "5.18.0")?.reason).toBe("optimum-onnx");
    expect(holdFor(holds, "transformers", "4.57.6")).toBeUndefined();
    expect(holdFor(holds, "nvidia-nccl-cu12", "2.32.3")?.reason).toBe("follows torch");
    expect(holdFor(holds, "numpy", "2.5.3")).toBeUndefined();
    expect(holdFor(holds, "torch", undefined)).toBeUndefined();
  });
});

describe("classifyDirect", () => {
  const base = {
    files: ["p.toml"],
    sections: ["dependencies"],
    holds: [] as Hold[],
  };
  test("current when the best fitting lock reaches latest", () => {
    expect(
      classifyDirect({
        ...base,
        name: "httpx",
        spec: ">=0.28",
        locked: ["0.28.1"],
        release: { latest: "0.28.1" },
      }).state,
    ).toBe("current");
  });
  test("open when latest satisfies the specifier and nothing holds it", () => {
    const r = classifyDirect({
      ...base,
      name: "fire",
      spec: ">=0.7",
      locked: ["0.7.0"],
      release: { latest: "0.8.1" },
    });
    expect(r).toMatchObject({ state: "open", kind: "minor" });
  });
  test("manifest cap with a hold reason, and without one", () => {
    const held = classifyDirect({
      ...base,
      name: "torch",
      spec: "==2.8.0",
      locked: ["2.8.0", "2.8.0+cu129"],
      release: { latest: "2.14.1" },
      holds: [{ name: "torch", maxVersion: "2.8.0", reason: "windows wheel" }],
    });
    expect(held).toMatchObject({
      state: "held",
      cause: "manifest-cap",
      reason: "windows wheel",
      undocumented: false,
    });
    const bare = classifyDirect({
      ...base,
      name: "maturin",
      spec: "==1.14.1",
      locked: ["1.14.1"],
      release: { latest: "1.15.0" },
    });
    expect(bare).toMatchObject({
      state: "held",
      cause: "manifest-cap",
      undocumented: true,
    });
  });
  test("a fork that already reaches latest is current for the matching requirement", () => {
    const fits = classifyDirect({
      ...base,
      name: "sentence-transformers",
      spec: ">=6.1",
      locked: ["5.7.0", "6.1.0"],
      release: { latest: "6.1.0" },
    });
    expect(fits.state).toBe("current");
    const capped = classifyDirect({
      ...base,
      name: "sentence-transformers",
      spec: ">=5.7,<6",
      locked: ["5.7.0", "6.1.0"],
      release: { latest: "6.1.0" },
      holds: [{ name: "sentence-transformers", maxMajor: 5, reason: "onnx" }],
    });
    expect(capped).toMatchObject({ state: "held", cause: "manifest-cap" });
  });
  test("python floor hold", () => {
    const r = classifyDirect({
      ...base,
      name: "numpy",
      spec: ">=1.26",
      locked: ["2.4.6"],
      release: { latest: "2.5.3", requiresPython: ">=3.12" },
      floor: "3.11",
    });
    expect(r).toMatchObject({ state: "held", cause: "python-floor" });
    expect(
      classifyDirect({
        ...base,
        name: "numpy",
        spec: ">=1.26",
        locked: ["2.4.6"],
        release: { latest: "2.5.3", requiresPython: ">=3.12" },
        floor: "3.12",
      }).state,
    ).toBe("open");
  });
  test("recorded hold on an uncapped dependency", () => {
    const r = classifyDirect({
      ...base,
      name: "websockets",
      spec: ">=12.0",
      locked: ["16.1.1"],
      release: { latest: "17.1" },
      holds: [{ name: "websockets", reason: "google-genai <17" }],
    });
    expect(r).toMatchObject({
      state: "held",
      cause: "hold",
      reason: "google-genai <17",
    });
  });
  test("advisory hold documents a cap", () => {
    const r = classifyDirect({
      ...base,
      name: "torch",
      spec: "==2.8.0",
      locked: ["2.8.0"],
      release: { latest: "2.14.1" },
      advisoryHolds: [{ ecosystem: "PyPI", name: "torch", reason: "advisory reason" }],
    });
    expect(r.reason).toBe("advisory reason");
  });
  test("build requirements use their exact pin; unpinned ones are current", () => {
    expect(
      classifyDirect({
        ...base,
        sections: ["build"],
        name: "maturin",
        spec: "==1.14.1",
        locked: [],
        release: { latest: "1.14.1" },
      }).state,
    ).toBe("current");
    expect(
      classifyDirect({
        ...base,
        sections: ["build"],
        name: "hatchling",
        spec: "",
        locked: [],
        release: { latest: "1.30.0" },
      }).state,
    ).toBe("current");
  });
  test("unlocked and unknown", () => {
    expect(
      classifyDirect({
        ...base,
        name: "x",
        spec: "",
        locked: [],
        release: { latest: "1" },
      }).state,
    ).toBe("unlocked");
    expect(classifyDirect({ ...base, name: "x", spec: "", locked: ["1"] }).state).toBe("unknown");
  });
});

describe("transitive rows", () => {
  test("only packages behind latest that no pyproject names; holds explain them", () => {
    const rows = transitiveBehind({
      lock: ".",
      versions: new Map([
        ["fsspec", ["2026.6.0"]],
        ["click", ["8.3.0"]],
        ["torch", ["2.8.0"]],
        ["idna", ["3.20"]],
      ]),
      directNames: new Set(["torch"]),
      latest: new Map([
        ["fsspec", { latest: "2026.9.0" }],
        ["click", { latest: "8.3.0" }],
        ["torch", { latest: "2.14.1" }],
        ["idna", { latest: "3.21" }],
      ]),
      holds: [{ name: "fsspec", reason: "datasets" }],
    });
    expect(rows).toEqual([
      {
        lock: ".",
        name: "fsspec",
        locked: "2026.6.0",
        latest: "2026.9.0",
        held: "datasets",
      },
      {
        lock: ".",
        name: "idna",
        locked: "3.20",
        latest: "3.21",
        held: undefined,
      },
    ]);
  });
});

describe("python policy", () => {
  test("pinned interpreter, requires-python and managed patch levels", () => {
    expect(
      pythonPolicy({
        pinned: "3.12",
        requires: [{ file: "a", spec: ">=3.12,<3.13" }],
        interpreters: [{ version: "3.12.3", managed: false, installed: true }],
      }),
    ).toEqual([]);
    expect(
      pythonPolicy({
        pinned: "3.13",
        requires: [],
        interpreters: [{ version: "3.12.3", managed: false, installed: true }],
      })[0],
    ).toContain(".python-version 3.13 has no installed interpreter");
    expect(
      pythonPolicy({
        pinned: "3.14",
        requires: [{ file: "tools/x/pyproject.toml", spec: ">=3.12,<3.13" }],
        interpreters: [{ version: "3.14.7", managed: true, installed: true }],
      }).some(l => l.includes("excludes the pinned interpreter")),
    ).toBe(true);
    const behind = pythonPolicy({
      pinned: "3.14",
      requires: [],
      interpreters: [
        { version: "3.14.7", managed: true, installed: true },
        { version: "3.14.8", managed: true, installed: false },
      ],
    });
    expect(behind).toEqual(["managed 3.14.7 is behind 3.14.8 (uv python upgrade)"]);
    expect(
      pythonPolicy({
        pinned: "3.14",
        requires: [],
        interpreters: [
          { version: "3.14.7", managed: true, installed: true },
          { version: "3.14.8", managed: true, installed: true },
        ],
      }),
    ).toEqual([]);
  });
});

describe("arguments and command lines", () => {
  test("subcommand, packages, flags and roots", () => {
    expect(parseArgs([])).toMatchObject({
      sub: "status",
      packages: [],
      apply: false,
    });
    const a = parseArgs([
      "apply",
      "--upgrade-package",
      "Torch,Transformers",
      "--upgrade-package=click",
      "--root",
      "/r",
      "--py-root",
      "/p",
      "--offline",
      "--skip-tests",
      "--json",
    ]);
    expect(a).toMatchObject({
      sub: "apply",
      packages: ["torch", "transformers", "click"],
      root: "/r",
      pyRoot: "/p",
      offline: true,
      skipTests: true,
      json: true,
    });
  });
  test("uv lock and sync arguments", () => {
    expect(lockArgs([])).toEqual(["lock", "--upgrade"]);
    expect(lockArgs(["a", "b"], ["--dry-run"])).toEqual([
      "lock",
      "--upgrade-package",
      "a",
      "--upgrade-package",
      "b",
      "--dry-run",
    ]);
    expect(syncArgs()).toEqual(["sync", "--all-packages", "--locked", "--extra", "rag", "--extra", "dedup"]);
  });
  test("pypi payload", () => {
    const text = JSON.stringify({
      info: { version: "2.5.3", requires_python: ">=3.9" },
      releases: { "2.5.3": [{ requires_python: ">=3.12" }] },
    });
    expect(parsePypi(text)).toEqual({
      latest: "2.5.3",
      requiresPython: ">=3.12",
    });
  });
});

function fixture(): { root: string; py: string; c: Ctx } {
  const root = mkdtempSync(join(tmpdir(), "uv-test-"));
  const py = join(root, "py");
  for (const [dir, body] of [
    [".", '[tool.uv.workspace]\nmembers = ["pkg/a", "pkg/b"]\n[tool.uv]\nrequired-version = "==0.12.22"\n'],
    ["pkg/a", '[project]\nname = "a"\nrequires-python = ">=3.12"\ndependencies = ["click>=8"]\n'],
    ["pkg/b", '[project]\nname = "b"\nrequires-python = ">=3.12"\n'],
    ["docs/vendored", '[project]\nname = "vendored"\n'],
  ] as const) {
    mkdirSync(join(py, dir), { recursive: true });
    writeFileSync(join(py, dir, "pyproject.toml"), body);
  }
  writeFileSync(join(py, "uv.lock"), LOCK);
  mkdirSync(join(py, "pkg/a/tests"), { recursive: true });
  writeFileSync(join(py, "pkg/a/tests/test_x.py"), "def test_x():\n    pass\n");
  mkdirSync(join(py, "pkg/b/tests"), { recursive: true });
  writeFileSync(join(py, "pkg/b/tests/conftest.py"), "");
  mkdirSync(join(py, "docs/locks"), { recursive: true });
  writeFileSync(join(py, "docs/locks/uv.lock"), LOCK);
  return { root, py, c: new Ctx(root, false, false) };
}

describe("repository access", () => {
  test("discover skips vendored docs; test dirs need test files", () => {
    const { py } = fixture();
    const layout = discover(py);
    expect(layout.locks).toEqual(["."]);
    expect(layout.projects).toEqual(["pkg/a/pyproject.toml", "pkg/b/pyproject.toml", "pyproject.toml"]);
    expect(testDirs(layout)).toEqual(["pkg/a/tests"]);
  });
  test("lock states and plans go through the runner", () => {
    const { py } = fixture();
    const layout = discover(py);
    const calls: string[][] = [];
    const run = (_cmd: string, args: string[]) => {
      calls.push(args);
      return args.includes("--check")
        ? { status: 1, stdout: "", stderr: "error: lock needs updating" }
        : { status: 0, stdout: "", stderr: "Update click v8.2.0 -> v8.3.0\n" };
    };
    expect(lockStates(layout, run)).toEqual([
      {
        dir: ".",
        fresh: false,
        revision: 5,
        packages: 5,
        detail: "error: lock needs updating",
      },
    ]);
    const plans = planLocks(layout, ["click"], run);
    expect(calls.at(-1)).toEqual(["lock", "--upgrade-package", "click", "--dry-run"]);
    expect(plans[0]!.changes).toEqual([{ ecosystem: "uv-lock", name: "click", from: "8.2.0", to: "8.3.0" }]);
  });
  test("snapshot and restore round trip", () => {
    const { py, c } = fixture();
    const layout = discover(py);
    const dir = snapshot(c, layout, "2026-10-02T00-00-00-000Z");
    writeFileSync(join(py, "uv.lock"), "broken");
    expect(latestSnapshot(c)).toBe(dir);
    expect(restoreSnapshot(c, dir)).toEqual([join(py, "uv.lock")]);
    expect(readFileSync(join(py, "uv.lock"), "utf8")).toBe(LOCK);
  });
});

const status = (over: Partial<UvStatus> = {}): UvStatus => ({
  pyRoot: "/py",
  tool: {
    installed: "0.12.22",
    pinned: "0.12.22",
    latest: "0.12.22",
    required: [{ file: "pyproject.toml", version: "0.12.22" }],
  },
  locks: [{ dir: ".", fresh: true, revision: 5, packages: 3 }],
  direct: [],
  transitive: [],
  advisories: { open: [], held: [] },
  python: [],
  interpreters: [],
  ...over,
});

describe("status verdicts", () => {
  test("clean status has no problems", () => {
    expect(problems(status())).toEqual([]);
  });
  test("drift, stale locks, undocumented caps and open advisories fail", () => {
    const p = problems(
      status({
        tool: {
          installed: "0.12.21",
          pinned: "0.12.22",
          latest: "0.12.22",
          required: [{ file: "pyproject.toml", version: "0.12.21" }],
        },
        locks: [{ dir: "a", fresh: false, packages: 1, detail: "needs update" }],
        direct: [
          {
            name: "maturin",
            files: [],
            sections: ["build"],
            spec: "==1.14.1",
            locked: ["1.14.1"],
            latest: "1.15.0",
            state: "held",
            kind: "minor",
            undocumented: true,
          },
        ],
        advisories: {
          open: [{ name: "x", version: "1", ids: ["GHSA-1"] }],
          held: [],
        },
        python: ["managed 3.14.7 is behind 3.14.8 (uv python upgrade)"],
      }),
    );
    expect(p).toHaveLength(6);
    expect(p[0]).toContain("installed 0.12.21 differs from the pin 0.12.22");
    expect(p[2]).toContain("a/uv.lock is stale");
  });
  test("plan names the decision rows", () => {
    const s = status({
      direct: [
        {
          name: "fire",
          files: [],
          sections: ["dependencies"],
          spec: ">=0.7",
          locked: ["0.7.0"],
          latest: "1.0.0",
          state: "open",
          kind: "major",
        },
      ],
    });
    const lines = renderPlan(s, [
      {
        dir: ".",
        changes: [{ ecosystem: "uv-lock", name: "click", from: "8.2.0", to: "8.3.0" }],
      },
    ]);
    expect(lines.join("\n")).toContain("click 8.2.0 -> 8.3.0  [minor]");
    expect(lines.join("\n")).toContain("1 direct requirement(s) behind latest and not held (1 major)");
  });
});
