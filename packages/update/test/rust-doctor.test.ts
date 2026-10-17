// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  crateFromPackageId,
  crateOfFile,
  errorLines,
  exitCode,
  featurePlan,
  glob,
  parseDiagnostics,
  parseFmtList,
  parseJunit,
  parseLibtest,
  newestLlvm,
  parsePorcelain,
  stageStatus,
  targetPackages,
  totals,
  vendoredReason,
  type MetaPackage,
  type Problem,
  type StageResult,
} from "../src/ecosystems/rust-doctor.ts";

const message = (o: Record<string, unknown>) =>
  JSON.stringify({
    reason: "compiler-message",
    package_id: "path+file:///repo/crates/ai/foo#aphrody-foo@1.0.0",
    manifest_path: "/repo/crates/ai/foo/Cargo.toml",
    ...o,
  });
const span = (file: string, line: number, applicability?: string) => ({
  file_name: file,
  line_start: line,
  column_start: 5,
  is_primary: true,
  suggestion_applicability: applicability ?? null,
});
const crateOf = (manifest: string, id: string) =>
  manifest === "/repo/crates/ai/foo/Cargo.toml" ? "aphrody-foo" : crateFromPackageId(id);
const pkg = (name: string, targets: (string | null)[]): MetaPackage => ({
  name,
  manifest_path: `/repo/${name}/Cargo.toml`,
  features: {},
  dependencies: targets.map((t, i) => ({ name: `d${i}`, target: t })),
});
const p = (severity: Problem["severity"]): Problem => ({
  stage: "compile",
  severity,
  message: "m",
});
const stage = (problems: Problem[], fixed: number): StageResult => ({
  stage: "compile",
  status: stageStatus(problems),
  seconds: 1,
  summary: "",
  problems,
  fixed,
  commands: [],
});

describe("parseDiagnostics", () => {
  test("keeps errors and warnings, drops summaries, notes and other reasons", () => {
    const text = [
      message({
        message: {
          level: "warning",
          message: "unused variable: `x`",
          code: { code: "unused_variables" },
          spans: [span("crates/ai/foo/src/lib.rs", 12)],
        },
      }),
      message({
        message: {
          level: "warning",
          message: "1 warning emitted",
          code: null,
          spans: [],
        },
      }),
      message({
        message: {
          level: "error",
          message: "mismatched types",
          code: { code: "E0308" },
          spans: [span("crates/ai/foo/src/lib.rs", 40)],
        },
      }),
      message({
        message: {
          level: "error",
          message: "aborting due to 1 previous error",
          code: null,
          spans: [],
        },
      }),
      message({
        message: { level: "note", message: "some note", code: null, spans: [] },
      }),
      JSON.stringify({ reason: "compiler-artifact", package_id: "x" }),
      "   Compiling foo v1.0.0",
      "{not json",
    ].join("\n");
    const d = parseDiagnostics(text, crateOf);
    expect(d.map(x => [x.level, x.code, x.crate, x.file, x.line])).toEqual([
      ["warning", "unused_variables", "aphrody-foo", "crates/ai/foo/src/lib.rs", 12],
      ["error", "E0308", "aphrody-foo", "crates/ai/foo/src/lib.rs", 40],
    ]);
  });

  test("reports one row when the lib and its test build repeat a warning", () => {
    const one = message({
      message: {
        level: "warning",
        message: "function `a` is never used",
        code: { code: "dead_code" },
        spans: [span("crates/ai/foo/src/a.rs", 3)],
      },
    });
    expect(parseDiagnostics([one, one].join("\n"), crateOf)).toHaveLength(1);
  });

  test("a machine-applicable suggestion on the message or on a child makes it fixable", () => {
    const direct = message({
      message: {
        level: "warning",
        message: "unneeded `return`",
        code: { code: "clippy::needless_return" },
        spans: [span("a.rs", 1, "MachineApplicable")],
      },
    });
    const child = message({
      message: {
        level: "warning",
        message: "collapsible",
        code: { code: "clippy::collapsible_if" },
        spans: [span("b.rs", 2)],
        children: [
          {
            message: "collapse",
            spans: [span("b.rs", 2, "MachineApplicable")],
            children: [],
          },
        ],
      },
    });
    const manual = message({
      message: {
        level: "warning",
        message: "complex type",
        code: { code: "clippy::type_complexity" },
        spans: [span("c.rs", 3, "MaybeIncorrect")],
      },
    });
    expect(parseDiagnostics([direct, child, manual].join("\n"), crateOf).map(x => x.fixable)).toEqual([
      true,
      true,
      false,
    ]);
  });

  test("an internal compiler error counts as an error", () => {
    const ice = message({
      message: {
        level: "error: internal compiler error",
        message: "unexpected panic",
        code: null,
        spans: [],
      },
    });
    expect(parseDiagnostics(ice, crateOf)[0]?.level).toBe("error");
  });
});

describe("crateFromPackageId", () => {
  test("handles the three id shapes Cargo prints", () => {
    expect(crateFromPackageId("path+file:///repo/crates/ai/engine#aphrody-engine@1.0.0")).toBe("aphrody-engine");
    expect(crateFromPackageId("path+file:///repo/crates/web/taffy#0.9.2")).toBe("taffy");
    expect(crateFromPackageId("registry+https://github.com/rust-lang/crates.io-index#serde@1.0.229")).toBe("serde");
  });
});

describe("featurePlan", () => {
  const packages = [
    { name: "b", features: { default: ["x"], x: [], gpu: [] } },
    { name: "a", features: { default: [], cuda: [], engine: [] } },
    { name: "taffy", features: { grid: [], flexbox: [] } },
  ];
  test("enables every member feature except default, sorted, and records the skips with their reason", () => {
    const plan = featurePlan(packages, [
      { feature: "taffy/*", reason: "vendored" },
      { feature: "a/cuda", reason: "needs CUDA" },
    ]);
    expect(plan.enabled).toEqual(["a/engine", "b/gpu", "b/x"]);
    expect(plan.skipped).toEqual([
      { feature: "a/cuda", reason: "needs CUDA" },
      { feature: "taffy/flexbox", reason: "vendored" },
      { feature: "taffy/grid", reason: "vendored" },
    ]);
  });
  test("no skip rule enables everything", () => {
    expect(featurePlan(packages, []).enabled).toEqual([
      "a/cuda",
      "a/engine",
      "b/gpu",
      "b/x",
      "taffy/flexbox",
      "taffy/grid",
    ]);
  });
});

describe("targetPackages", () => {
  const packages = [
    pkg("web", ['cfg(target_arch = "wasm32")', null]),
    pkg("host", ['cfg(not(target_arch = "wasm32"))']),
    pkg("win", ["cfg(windows)"]),
    pkg("plain", [null]),
  ];
  test("auto selects members with a dependency gated on the target family", () => {
    expect(
      targetPackages(packages, {
        triple: "wasm32-unknown-unknown",
        packages: "auto",
      }).packages,
    ).toEqual(["host", "web"]);
    expect(
      targetPackages(packages, {
        triple: "x86_64-pc-windows-msvc",
        packages: "auto",
      }).packages,
    ).toEqual(["win"]);
  });
  test("include adds members that carry no target-gated dependency", () => {
    expect(
      targetPackages(packages, {
        triple: "wasm32-unknown-unknown",
        packages: "auto",
        include: ["plain", "web"],
      }).packages,
    ).toEqual(["host", "plain", "web"]);
  });
  test("workspace and explicit lists, with exclusions kept as data", () => {
    const all = targetPackages(packages, {
      triple: "wasm32-unknown-unknown",
      packages: "workspace",
      exclude: [{ crates: "h*", reason: "host only" }],
    });
    expect(all.packages).toEqual(["plain", "web", "win"]);
    expect(all.excluded).toEqual([{ crate: "host", reason: "host only" }]);
    expect(targetPackages(packages, { triple: "x", packages: ["web", "web"] }).packages).toEqual(["web"]);
  });
});

describe("parseJunit", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="nextest-run" tests="4" failures="1" errors="0">
    <testsuite name="aphrody-foo" tests="2" disabled="0" errors="0" failures="1">
        <testcase name="tests::passes" classname="aphrody-foo" time="0.01">
        </testcase>
        <testcase name="tests::breaks" classname="aphrody-foo" time="0.02">
            <failure message="thread &apos;tests::breaks&apos; panicked at src/lib.rs:9:5" type="test failure">details</failure>
            <system-out>out</system-out>
        </testcase>
    </testsuite>
    <testsuite name="aphrody-bar::integration" tests="2" disabled="0" errors="0" failures="0">
        <testcase name="quick" classname="aphrody-bar::integration" time="0.01"/>
        <testcase name="sometimes" classname="aphrody-bar::integration" time="0.5">
            <flakyFailure timestamp="2026-10-02T00:00:00Z" time="0.2" type="test failure">first try</flakyFailure>
        </testcase>
    </testsuite>
</testsuites>`;
  test("separates failing from flaky cases and counts every case", () => {
    const r = parseJunit(xml);
    expect(r.tests).toBe(4);
    expect(r.failures).toEqual([
      {
        suite: "aphrody-foo",
        name: "tests::breaks",
        kind: "fail",
        message: "thread 'tests::breaks' panicked at src/lib.rs:9:5",
      },
    ]);
    expect(r.flaky).toEqual([
      {
        suite: "aphrody-bar::integration",
        name: "sometimes",
        kind: "flaky",
        message: "test failure",
      },
    ]);
  });
  test("an empty report has no case", () => {
    expect(parseJunit("<testsuites></testsuites>")).toEqual({
      tests: 0,
      failures: [],
      flaky: [],
    });
  });
});

describe("parseLibtest", () => {
  test("attributes failing doc tests to their crate", () => {
    const text = [
      "   Doc-tests aphrody_foo",
      "test crates/ai/foo/src/lib.rs - Foo::bar (line 12) ... ok",
      "test crates/ai/foo/src/lib.rs - Foo::baz (line 30) ... FAILED",
      "   Doc-tests aphrody_bar",
      "test crates/ai/bar/src/lib.rs - run (line 5) ... FAILED",
      "test result: FAILED. 0 passed; 1 failed",
    ].join("\n");
    expect(parseLibtest(text)).toEqual([
      {
        suite: "aphrody_foo",
        name: "crates/ai/foo/src/lib.rs - Foo::baz (line 30)",
      },
      { suite: "aphrody_bar", name: "crates/ai/bar/src/lib.rs - run (line 5)" },
    ]);
  });
});

describe("format and git helpers", () => {
  test("parseFmtList returns repo-relative files once, newline-style lines included", () => {
    const text = [
      "/repo/crates/a/src/lib.rs",
      "Incorrect newline style in /repo/crates/b/src/x.rs",
      "/repo/crates/a/src/lib.rs",
      "Warning: something",
      "/repo/../source/up/src/lib.rs",
    ].join("\n");
    expect(parseFmtList(text, "/repo")).toEqual([
      "../source/up/src/lib.rs",
      "crates/a/src/lib.rs",
      "crates/b/src/x.rs",
    ]);
  });
  test("crateOfFile picks the longest member directory", () => {
    const dirs: [string, string][] = [
      ["crates/web", "outer"],
      ["crates/web/taffy", "taffy"],
      ["crates/infra/aphrody", "aphrody"],
    ];
    expect(crateOfFile("crates/web/taffy/src/lib.rs", dirs)).toBe("taffy");
    expect(crateOfFile("crates/web/x.rs", dirs)).toBe("outer");
    expect(crateOfFile("crates/webby/x.rs", dirs)).toBeUndefined();
    expect(crateOfFile("docs/a.md", dirs)).toBeUndefined();
  });
  test("parsePorcelain keeps both sides of a rename and untracked paths", () => {
    expect(parsePorcelain(" M a/b.rs\n?? new/\nR  old.rs -> fresh.rs\n")).toEqual([
      "a/b.rs",
      "new/",
      "old.rs",
      "fresh.rs",
    ]);
  });
  test("errorLines starts at the first error, or falls back to the tail", () => {
    expect(errorLines("Compiling x\nerror[E0432]: unresolved import\n --> src/lib.rs:1:5\nmore", 2)).toEqual([
      "error[E0432]: unresolved import",
      " --> src/lib.rs:1:5",
    ]);
    expect(errorLines("a\nb\nc", 2)).toEqual(["b", "c"]);
  });
});

describe("newestLlvm", () => {
  test("picks the highest installed LLVM, numerically", () => {
    expect(newestLlvm(["llvm-18", "llvm-9", "llvm-23", "gcc", "llvm-toolchain"])).toBe("llvm-23");
    expect(newestLlvm(["gcc"])).toBeUndefined();
  });
});

describe("classification", () => {
  test("glob is anchored and escapes regex characters", () => {
    expect(glob("koharu*").test("koharu-ml")).toBe(true);
    expect(glob("koharu*").test("my-koharu")).toBe(false);
    expect(glob("a.b/*").test("a.b/x")).toBe(true);
    expect(glob("a.b/*").test("aXb/x")).toBe(false);
  });
  test("vendoredReason returns the first matching reason", () => {
    const v = [
      { crates: "obscura*", reason: "upstream obscura" },
      { crates: "taffy", reason: "upstream taffy" },
    ];
    expect(vendoredReason("obscura-net", v)).toBe("upstream obscura");
    expect(vendoredReason("taffy", v)).toBe("upstream taffy");
    expect(vendoredReason("aphrody-web", v)).toBeUndefined();
  });
  test("status, totals and exit code follow the worst severity", () => {
    expect(stageStatus([])).toBe("ok");
    expect(stageStatus([p("info")])).toBe("ok");
    expect(stageStatus([p("info"), p("warning")])).toBe("problems");
    expect(stageStatus([p("warning"), p("error")])).toBe("failed");
    const t = totals([stage([p("error"), p("warning")], 2), stage([p("info"), p("warning")], 1)]);
    expect(t).toEqual({ errors: 1, warnings: 2, notes: 1, fixed: 3 });
    expect(exitCode(t, false)).toBe(1);
    expect(exitCode({ errors: 0, warnings: 2, notes: 0, fixed: 0 }, false)).toBe(0);
    expect(exitCode({ errors: 0, warnings: 2, notes: 0, fixed: 0 }, true)).toBe(1);
    expect(exitCode({ errors: 0, warnings: 0, notes: 5, fixed: 0 }, true)).toBe(0);
  });
});
