import { tempPath } from "@aphrody/paths";
import { expect, test } from "bun:test";
import {
  classify,
  compareSemver,
  evaluatePatch,
  exitCode,
  parseArgs,
  parseCatalog,
  parseConfig,
  parseWorkspaceDeps,
  pickEligible,
  mirrorDrift,
  pickLatest,
  renderReport,
  rewriteCatalogEntry,
  rewriteMirror,
  rewriteWorkspaceDep,
  summarize,
  type PatchSpec,
} from "../src/tauri/sync.ts";

const cargo = `[workspace]
members = []

[workspace.dependencies]
serde = "1"
tauri = { version = "=3.0.0-alpha.3", default-features = false, features = ["compression"] }
tauri-build = "=3.0.0-alpha.2"
tauri-plugin = { version = "=3.0.0-alpha.2" }
tauri-specta = { git = "https://github.com/koharu-rs/tauri-specta", tag = "v2.0.0-rc.25-koharu.1" }

[patch.crates-io]
tauri-plugin-dialog = { path = "upstream/tauri-plugin-dialog" }
`;

test("semver precedence follows SemVer 2.0 for pre-releases", () => {
  expect(compareSemver("3.0.0-alpha.2", "3.0.0-alpha.3")).toBe(-1);
  expect(compareSemver("3.0.0-alpha.10", "3.0.0-alpha.9")).toBe(1);
  expect(compareSemver("3.0.0-alpha.3", "3.0.0")).toBe(-1);
  expect(compareSemver("3.0.0-beta", "3.0.0-alpha.9")).toBe(1);
  expect(compareSemver("=3.0.0", "3.0.0")).toBe(0);
  expect(compareSemver("3.0.0-alpha", "3.0.0-alpha.1")).toBe(-1);
  expect(() => compareSemver("x", "1.0.0")).toThrow();
});

test("pickLatest stays on the requested major line", () => {
  const versions = [
    "2.12.1",
    "3.0.0-alpha.2",
    "3.0.0-alpha.3",
    "bogus",
    "2.99.0",
  ];
  expect(pickLatest(versions, 3)).toBe("3.0.0-alpha.3");
  expect(pickLatest(versions, 2)).toBe("2.99.0");
  expect(pickLatest(versions, 4)).toBeNull();
});

test("pickEligible honours the minimum release age", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const times = {
    "3.0.0-alpha.1": "2026-09-21T00:00:00Z",
    "3.0.0-alpha.2": "2026-09-30T00:00:00Z",
    "2.7.0": "2026-09-29T00:00:00Z",
  };
  expect(pickEligible(times, 3, now, 259200)).toEqual({
    latest: "3.0.0-alpha.2",
    eligible: "3.0.0-alpha.1",
  });
  expect(pickEligible(times, 3, now, 0).eligible).toBe("3.0.0-alpha.2");
});

test("workspace dependency parsing and rewriting keep the surrounding fields", () => {
  const deps = parseWorkspaceDeps(cargo, [
    "tauri",
    "tauri-build",
    "tauri-plugin",
    "tauri-specta",
    "missing",
  ]);
  expect(deps).toEqual([
    { name: "tauri", version: "3.0.0-alpha.3", source: "crates.io" },
    { name: "tauri-build", version: "3.0.0-alpha.2", source: "crates.io" },
    { name: "tauri-plugin", version: "3.0.0-alpha.2", source: "crates.io" },
    { name: "tauri-specta", version: null, source: "git" },
  ]);
  const bumped = rewriteWorkspaceDep(
    rewriteWorkspaceDep(cargo, "tauri", "3.0.0-alpha.4"),
    "tauri-build",
    "3.0.0-alpha.3",
  );
  expect(bumped).toContain(
    'tauri = { version = "=3.0.0-alpha.4", default-features = false, features = ["compression"] }',
  );
  expect(bumped).toContain('tauri-build = "=3.0.0-alpha.3"');
  expect(bumped).toContain('tauri-plugin = { version = "=3.0.0-alpha.2" }');
  expect(bumped).toContain("[patch.crates-io]");
  expect(() => rewriteWorkspaceDep(cargo, "nope", "1.0.0")).toThrow();
});

test("a workspace.dependencies table at the end of the file is handled", () => {
  const tail = '[workspace.dependencies]\ntauri-build = "=3.0.0-alpha.2"';
  expect(parseWorkspaceDeps(tail, ["tauri-build"])[0]?.version).toBe(
    "3.0.0-alpha.2",
  );
  expect(rewriteWorkspaceDep(tail, "tauri-build", "3.0.0-alpha.3")).toBe(
    '[workspace.dependencies]\ntauri-build = "=3.0.0-alpha.3"',
  );
});

test("catalog parsing and rewriting preserve formatting", () => {
  const json = `{\n  "workspaces": {\n    "catalog": {\n      "@tauri-apps/api": "3.0.0-alpha.2",\n      "zustand": "^5.0.14"\n    }\n  }\n}\n`;
  expect(parseCatalog(json, ["@tauri-apps/api", "absent"])).toEqual({
    "@tauri-apps/api": "3.0.0-alpha.2",
  });
  const next = rewriteCatalogEntry(json, "@tauri-apps/api", "3.0.0-alpha.3");
  expect(next).toContain('"@tauri-apps/api": "3.0.0-alpha.3"');
  expect(next).toContain('"zustand": "^5.0.14"');
  expect(() =>
    rewriteCatalogEntry(json, "@tauri-apps/missing", "1.0.0"),
  ).toThrow();
});

test("classify distinguishes behind, held, too-fresh and ok", () => {
  expect(
    classify("3.0.0-alpha.3", "3.0.0-alpha.3", "3.0.0-alpha.3").status,
  ).toBe("ok");
  expect(
    classify("3.0.0-alpha.2", "3.0.0-alpha.3", "3.0.0-alpha.3").status,
  ).toBe("behind");
  expect(
    classify(
      "3.0.0-alpha.2",
      "3.0.0-alpha.3",
      "3.0.0-alpha.3",
      "held by patch x",
    ).status,
  ).toBe("held");
  expect(
    classify("3.0.0-alpha.1", "3.0.0-alpha.2", "3.0.0-alpha.1").status,
  ).toBe("too-fresh");
  expect(classify(null, "1.0.0", "1.0.0").status).toBe("unknown");
});

const spec: PatchSpec = {
  id: "dialog",
  kind: "vendored-crate",
  crate: "tauri-plugin-dialog",
  base: "3.0.0-alpha.2",
  path: "upstream/tauri-plugin-dialog",
  appliedFile: "upstream/tauri-plugin-dialog/src/desktop.rs",
  appliedMarker: "use tauri::{AppHandle, Manager",
};

test("patch evaluation flags missing, unapplied, upstream-contains and newer-base", () => {
  const ok = {
    spec,
    fileText: "use tauri::{AppHandle, Manager, Runtime};",
    cargoPatchPresent: true,
    latestPublished: "3.0.0-alpha.2",
    upstreamContainsFix: false,
  };
  expect(evaluatePatch(ok).state).toBe("applied");
  expect(evaluatePatch({ ...ok, fileText: null }).state).toBe("missing");
  expect(
    evaluatePatch({ ...ok, fileText: "use tauri::AppHandle;" }).state,
  ).toBe("unapplied");
  expect(evaluatePatch({ ...ok, cargoPatchPresent: false }).state).toBe(
    "unapplied",
  );
  expect(evaluatePatch({ ...ok, upstreamContainsFix: true }).state).toBe(
    "upstream-contains",
  );
  expect(evaluatePatch({ ...ok, latestPublished: "3.0.0-alpha.3" }).state).toBe(
    "newer-base",
  );
  expect(evaluatePatch({ ...ok, upstreamContainsFix: null }).state).toBe(
    "unchecked",
  );
});

test("report summary, rendering and exit codes", () => {
  const rows = [
    {
      kind: "crate" as const,
      name: "tauri",
      current: "3.0.0-alpha.2",
      latest: "3.0.0-alpha.3",
      target: "3.0.0-alpha.3",
      status: "behind" as const,
    },
    {
      kind: "npm" as const,
      name: "@tauri-apps/api",
      current: "3.0.0-alpha.2",
      latest: "3.0.0-alpha.2",
      target: "3.0.0-alpha.2",
      status: "ok" as const,
    },
  ];
  const report = summarize(
    rows,
    [{ id: "p", state: "applied", detail: "still required" }],
    [{ name: "tauri", ref: "v3", commit: "70541fe2aaaa" }],
  );
  expect(report.behind).toBe(1);
  expect(renderReport(report)).toContain("tauri");
  expect(renderReport(report)).toContain("behind=1 brokenPatches=0");
  expect(exitCode(report, { check: true })).toBe(1);
  expect(exitCode(report, { check: false })).toBe(0);
  const broken = summarize([], [{ id: "p", state: "missing", detail: "" }], []);
  expect(exitCode(broken, { check: false })).toBe(1);
});

test("argument parsing", () => {
  expect(parseArgs(["--check", "--json", "--root", tempPath("x")]).root).toBe(
    tempPath("x"),
  );
  expect(parseArgs(["--apply"], "/repo").apply).toBe(true);
  expect(() => parseArgs(["--apply", "--offline"])).toThrow();
  expect(() => parseArgs(["--apply", "--check"])).toThrow();
  expect(() => parseArgs(["--bogus"])).toThrow("Unknown argument");
});

test("the committed config parses and lists every tracked crate", async () => {
  const text = await Bun.file(
    new URL(
      "../../../tools/aphrody/config/tauri-upstream.json",
      import.meta.url,
    ),
  ).text();
  const config = parseConfig(text);
  expect(config.line).toBe(3);
  expect(config.rust.crates).toContain("tauri-runtime-cef");
  expect(config.rust.crates).not.toContain("tauri-runtime-wry");
  expect(config.patches.map((patch) => patch.id)).toContain(
    "tauri-runtime-cef-glib-work-source",
  );
  expect(() => parseConfig('{"schemaVersion":2}')).toThrow();
});

const mirror = {
  file: "scaffolder.ts",
  keys: { tauri: "tauri", jsApi: "@tauri-apps/api", jsCli: "@tauri-apps/cli" },
};
const mirrorText =
  'export const TAURI_3 = {\n  tauri: "3.0.0-alpha.2",\n  jsApi: "3.0.0-alpha.2",\n  jsCli: "3.0.0-alpha.3",\n} as const;\n';

test("mirror drift detection and rewriting", () => {
  const central = {
    tauri: "3.0.0-alpha.3",
    "@tauri-apps/api": "3.0.0-alpha.2",
    "@tauri-apps/cli": "3.0.0-alpha.3",
    unused: null,
  };
  const drift = mirrorDrift(mirrorText, mirror, central);
  expect(drift).toEqual([
    {
      file: "scaffolder.ts",
      key: "tauri",
      name: "tauri",
      mirror: "3.0.0-alpha.2",
      expected: "3.0.0-alpha.3",
    },
  ]);
  const fixed = rewriteMirror(mirrorText, mirror, central);
  expect(fixed).toContain('tauri: "3.0.0-alpha.3"');
  expect(fixed).toContain('jsApi: "3.0.0-alpha.2"');
  expect(mirrorDrift(fixed, mirror, central)).toEqual([]);
  expect(() => rewriteMirror("nothing", mirror, central)).toThrow("not found");
  expect(mirrorDrift("nothing", mirror, central).length).toBe(3);
});

test("mirror drift fails the exit code even without --check", () => {
  const report = summarize(
    [],
    [],
    [],
    [{ file: "f", key: "k", name: "n", mirror: null, expected: "1.0.0" }],
  );
  expect(exitCode(report, { check: false })).toBe(1);
  expect(renderReport(report)).toContain("mirror drift");
});
