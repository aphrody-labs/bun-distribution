// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Ctx } from "../src/context.ts";
import {
  advisoryHeld,
  applyEdit,
  behind,
  buildRows,
  bumpKind,
  catalogEntries,
  collectDirect,
  describeOverrides,
  eligibleVersion,
  expandMajors,
  fetchWithBackoff,
  holdFor,
  isExcluded,
  npmLatest,
  openAdvisories,
  parseArgs,
  parseHolds,
  parseReleaseAge,
  planRows,
  renderPlan,
  resolvedDeps,
  rewriteSpec,
  satisfies,
  specBase,
  specEdits,
  specKind,
  targetOf,
  touchedManifests,
  type Direct,
  type Row,
} from "../src/ecosystems/bun.ts";

const DAY = 86_400;
const NOW = Date.parse("2026-10-02T00:00:00Z");
const iso = (daysAgo: number) =>
  new Date(NOW - daysAgo * DAY * 1000).toISOString();
const age = { seconds: 3 * DAY, excludes: ["next"] };

describe("specs", () => {
  test("specKind separates registry versions from everything else", () => {
    expect(specKind("^1.2.3")).toBe("version");
    expect(specKind("1.2.3")).toBe("version");
    expect(specKind("3.0.0-alpha.4")).toBe("version");
    expect(specKind(">=1 <2 || ^3")).toBe("version");
    expect(specKind("catalog:")).toBe("catalog");
    expect(specKind("catalog:ui")).toBe("catalog");
    expect(specKind("workspace:*")).toBe("workspace");
    expect(specKind("file:.cache/x.tgz")).toBe("file");
    expect(specKind("link:../x")).toBe("link");
    expect(specKind("npm:other@^1")).toBe("alias");
    expect(specKind("github:owner/repo#main")).toBe("git");
    expect(specKind("owner/repo")).toBe("git");
    expect(specKind("https://example.com/x.tgz")).toBe("url");
    expect(specKind("latest")).toBe("tag");
  });

  test("specBase is the lowest bound of the highest alternative", () => {
    expect(specBase("^1.2.3")).toBe("1.2.3");
    expect(specBase("~4.5")).toBe("4.5.0");
    expect(specBase("^7")).toBe("7.0.0");
    expect(specBase(">=1.0.0 <2.0.0 || ^3.1.0")).toBe("3.1.0");
    expect(specBase("3.0.0-alpha.4")).toBe("3.0.0-alpha.4");
    expect(specBase("*")).toBeUndefined();
    expect(specBase("latest")).toBeUndefined();
  });

  test("rewriteSpec keeps the operator", () => {
    expect(rewriteSpec("^1.2.3", "2.0.0")).toBe("^2.0.0");
    expect(rewriteSpec("~1.2.3", "1.3.0")).toBe("~1.3.0");
    expect(rewriteSpec("16.3.5", "16.3.8")).toBe("16.3.8");
    expect(rewriteSpec("=1.0.0", "1.0.1")).toBe("1.0.1");
    expect(rewriteSpec(">=1.0.0", "2.0.0")).toBe(">=2.0.0");
    expect(rewriteSpec("^1.0.0 || ^2.0.0", "3.0.0")).toBe("^3.0.0");
    expect(rewriteSpec("<2.0.0", "3.0.0")).toBe("^3.0.0");
  });

  test("bumpKind: majors, 0.x minors, ahead and prerelease", () => {
    expect(bumpKind("1.2.3", "1.2.3")).toBe("none");
    expect(bumpKind("1.2.3", "1.2.4")).toBe("patch");
    expect(bumpKind("1.2.3", "1.3.0")).toBe("minor");
    expect(bumpKind("1.2.3", "2.0.0")).toBe("major");
    expect(bumpKind("0.184.0", "0.186.1")).toBe("major");
    expect(bumpKind("0.19.0", "0.19.2")).toBe("patch");
    expect(bumpKind("3.0.0-alpha.4", "2.9.0")).toBe("ahead");
    expect(bumpKind("3.0.0-alpha.2", "3.0.0-alpha.4")).toBe("pre");
    expect(bumpKind(undefined, "1.0.0")).toBe("none");
  });

  test("satisfies follows semver ranges", () => {
    expect(satisfies("1.9.0", "^1.2.3")).toBe(true);
    expect(satisfies("2.0.0", "^1.2.3")).toBe(false);
    expect(satisfies("1.7.7", "1.6.28")).toBe(false);
    expect(satisfies("1.0.0", "not a range")).toBe(false);
  });
});

describe("manifests", () => {
  const root = {
    workspaces: {
      packages: ["packages/*"],
      catalog: { react: "^19.3.0", next: "16.3.8" },
      catalogs: { legacy: { react: "^18.0.0", left: "^1.0.0" } },
    },
  };
  const manifests = {
    "packages/a/package.json": {
      dependencies: {
        react: "catalog:",
        zod: "^4.6.5",
        "@aphrody/x": "workspace:*",
      },
      devDependencies: { left: "catalog:legacy" },
    },
    "packages/b/package.json": {
      dependencies: { zod: "^4.6.5", next: "catalog:", tgz: "file:x.tgz" },
      optionalDependencies: { sharp: "~0.35.0" },
    },
  };

  test("catalogEntries flattens default and named catalogs, default first", () => {
    expect(catalogEntries(root)).toEqual({
      react: "^19.3.0",
      next: "16.3.8",
      left: "^1.0.0",
    });
  });

  test("resolvedDeps resolves catalog: and named catalogs", () => {
    const m = resolvedDeps(manifests["packages/a/package.json"], root);
    expect(m.get("react")).toBe("^19.3.0");
    expect(m.get("left")).toBe("^1.0.0");
    expect(m.get("zod")).toBe("^4.6.5");
    expect(m.get("@aphrody/x")).toBe("workspace:*");
  });

  test("collectDirect merges catalog entries and literal ranges and dedups by name and spec", () => {
    const d = collectDirect(root, manifests);
    const zod = d.filter((x) => x.name === "zod");
    expect(zod).toHaveLength(1);
    expect(zod[0]!.where).toEqual([
      "packages/a/package.json",
      "packages/b/package.json",
    ]);
    expect(d.find((x) => x.name === "react")!.where).toEqual(["catalog"]);
    expect(d.find((x) => x.name === "sharp")!.spec).toBe("~0.35.0");
    expect(d.map((x) => x.name)).toEqual(d.map((x) => x.name).toSorted());
  });

  test("touchedManifests propagates a catalog edit to its users", () => {
    const after = {
      root: {
        workspaces: {
          catalog: { react: "^20.0.0", next: "16.3.8" },
          catalogs: root.workspaces.catalogs,
        },
      },
      manifests,
    };
    expect(touchedManifests({ root, manifests }, after)).toEqual([
      "packages/a/package.json",
    ]);
    const literal = {
      root,
      manifests: {
        ...manifests,
        "packages/b/package.json": {
          ...manifests["packages/b/package.json"],
          dependencies: { zod: "^5.0.0", next: "catalog:", tgz: "file:x.tgz" },
        },
      },
    };
    expect(touchedManifests({ root, manifests }, literal)).toEqual([
      "packages/b/package.json",
    ]);
    expect(touchedManifests({ root, manifests }, { root, manifests })).toEqual(
      [],
    );
  });
});

describe("config", () => {
  test("parseReleaseAge reads bunfig.toml and isExcluded matches names exactly", () => {
    const a = parseReleaseAge(
      '[install]\nminimumReleaseAge = 259200\nminimumReleaseAgeExcludes = ["next", "undici"]\n',
    );
    expect(a).toEqual({ seconds: 259200, excludes: ["next", "undici"] });
    expect(isExcluded("next", a)).toBe(true);
    expect(isExcluded("next-intl", a)).toBe(false);
    expect(parseReleaseAge("[jsx]\nruntime = 'automatic'\n")).toEqual({
      seconds: 0,
      excludes: [],
    });
  });

  test("holdFor refuses releases above maxMajor only", () => {
    const holds = parseHolds(
      '{"holds":[{"name":"graphql","maxMajor":16,"reason":"yoga"}]}',
    ).holds;
    expect(holdFor(holds, "graphql", "17.0.2")?.reason).toBe("yoga");
    expect(holdFor(holds, "graphql", "16.14.3")).toBeUndefined();
    expect(holdFor(holds, "zod", "99.0.0")).toBeUndefined();
    expect(parseHolds("{}").holds).toEqual([]);
    const pin = [
      {
        name: "undici-types",
        maxVersion: "8.9.0",
        reason: "types/node nests 8.9.0",
      },
    ];
    expect(holdFor(pin, "undici-types", "8.11.2")?.reason).toBe(
      "types/node nests 8.9.0",
    );
    expect(holdFor(pin, "undici-types", "8.9.0")).toBeUndefined();
  });

  test("advisoryHeld looks at npm entries only", () => {
    const holds = [
      { ecosystem: "npm", name: "vite", reason: "r" },
      { ecosystem: "crates.io", name: "rand", reason: "r" },
    ];
    expect(advisoryHeld(holds, "vite")?.reason).toBe("r");
    expect(advisoryHeld(holds, "rand")).toBeUndefined();
  });
});

describe("release age", () => {
  const times = {
    "1.0.0": iso(30),
    "1.1.0": iso(10),
    "1.2.0": iso(1),
    "2.0.0-rc.1": iso(0.5),
    "2.0.0": iso(0.2),
  };

  test("eligible is the newest release old enough, inside the latest's major", () => {
    expect(
      eligibleVersion(
        times,
        "1.2.0",
        { seconds: 3 * DAY, excludes: [] },
        "x",
        NOW,
      ),
    ).toEqual({
      eligible: "1.1.0",
      ageGated: true,
    });
    expect(
      eligibleVersion(times, "1.2.0", { seconds: 0, excludes: [] }, "x", NOW),
    ).toEqual({
      eligible: "1.2.0",
      ageGated: false,
    });
  });

  test("excluded packages and missing timestamps take the latest", () => {
    expect(eligibleVersion(times, "1.2.0", age, "next", NOW)).toEqual({
      eligible: "1.2.0",
      ageGated: false,
    });
    expect(
      eligibleVersion(
        undefined,
        "1.2.0",
        { seconds: 3 * DAY, excludes: [] },
        "x",
        NOW,
      ),
    ).toEqual({ eligible: "1.2.0", ageGated: false });
  });

  test("a prerelease is never the answer for a stable latest", () => {
    const t = { "9.0.0": iso(40), "10.0.0-rc.3": iso(20), "10.0.0": iso(1) };
    expect(
      eligibleVersion(t, "10.0.0", { seconds: 3 * DAY, excludes: [] }, "x", NOW)
        .eligible,
    ).toBeUndefined();
  });
});

describe("rows and plan", () => {
  const directs: Direct[] = [
    { name: "inrange", spec: "^1.2.0", where: ["catalog"] },
    { name: "pinned", spec: "1.6.28", where: ["a"] },
    { name: "major", spec: "^8.5.0", where: ["catalog"] },
    { name: "held", spec: "^16.14.2", where: ["catalog"] },
    { name: "waiting", spec: "^1.0.0", where: ["catalog"] },
    { name: "current", spec: "^2.0.0", where: ["catalog"] },
    { name: "@tauri-apps/api", spec: "3.0.0-alpha.2", where: ["catalog"] },
    { name: "typescript", spec: "7.0.1", where: ["catalog"] },
    { name: "tarball", spec: "file:x.tgz", where: ["catalog"] },
  ];
  const latest = new Map([
    ["inrange", { version: "1.9.0" }],
    ["pinned", { version: "1.7.1" }],
    ["major", { version: "9.1.0" }],
    ["held", { version: "17.0.2" }],
    ["waiting", { version: "1.1.0" }],
    ["current", { version: "2.0.0" }],
    ["@tauri-apps/api", { version: "3.0.0-alpha.4" }],
    ["typescript", { version: "7.0.2" }],
  ]);
  const old = { "1.0.0": iso(30), "1.1.0": iso(1) };
  const times = new Map([["waiting", old]]);
  const holds = [{ name: "held", maxMajor: 16, reason: "yoga is on 16" }];
  const rows = buildRows({ directs, latest, holds, age, times, now: NOW });
  const by = (n: string) => rows.find((r) => r.name === n)!;

  test("only registry versions become rows, owners are tagged", () => {
    expect(rows.map((r) => r.name)).not.toContain("tarball");
    expect(by("@tauri-apps/api").owner).toBe("tauri");
    expect(by("typescript").owner).toBe("pins");
    expect(
      behind(rows)
        .map((r) => r.name)
        .toSorted(),
    ).toEqual(["held", "inrange", "major", "pinned", "waiting"]);
  });

  test("planRows buckets: in-range, pinned, major, held, waiting", () => {
    const p = planRows(rows);
    expect(p.inRange.map((r) => r.name)).toEqual(["inrange"]);
    expect(p.pinned.map((r) => r.name)).toEqual(["pinned"]);
    expect(p.majors.map((r) => r.name)).toEqual(["major"]);
    expect(p.held.map((r) => r.name)).toEqual(["held"]);
    expect(p.waiting.map((r) => r.name)).toEqual(["waiting"]);
  });

  test("an exact pin behind inside its major is `pinned`, not a major", () => {
    expect(by("pinned").kind).toBe("minor");
    expect(by("pinned").inRange).toBe(false);
  });

  test("targetOf is the installable release, and nothing while a whole major is too young", () => {
    expect(
      targetOf({ ...by("waiting"), eligible: "1.0.5", ageGated: true } as Row),
    ).toBe("1.0.5");
    expect(targetOf(by("major"))).toBe("9.1.0");
    expect(
      targetOf({ ...by("major"), eligible: undefined, ageGated: true } as Row),
    ).toBeUndefined();
  });

  test("a major whose every release is younger than the window waits instead of being offered", () => {
    const fresh = buildRows({
      directs: [{ name: "stripe", spec: "^22.6.2", where: ["catalog"] }],
      latest: new Map([["stripe", { version: "23.0.0" }]]),
      holds: [],
      age,
      now: NOW,
      times: new Map([["stripe", { "22.6.2": iso(30), "23.0.0": iso(1) }]]),
    });
    expect(fresh[0]!.ageGated).toBe(true);
    expect(fresh[0]!.eligible).toBeUndefined();
    const p = planRows(fresh);
    expect(p.waiting.map((r) => r.name)).toEqual(["stripe"]);
    expect(p.majors).toEqual([]);
  });

  test("renderPlan lists the requested majors with their family siblings", () => {
    const status = {
      runtime: [],
      rows,
      plan: planRows(rows),
      overrides: [],
      releaseAge: age,
      holds: [],
      manifests: 2,
    };
    const text = renderPlan(status, ["major"]).join("\n");
    expect(text).toContain("* major ^8.5.0 -> 9.1.0 (major)");
    expect(text).toContain("held");
  });
});

const makeRow = (name: string, kind: Row["kind"] = "major"): Row => ({
  name,
  spec: "^1.0.0",
  where: ["catalog"],
  kind,
  inRange: false,
});

describe("families", () => {
  test("a react major pulls its behind siblings only", () => {
    const rows = [
      makeRow("react"),
      makeRow("react-dom"),
      makeRow("@types/react"),
      makeRow("@types/react-dom", "patch"),
      makeRow("zod"),
    ];
    expect(expandMajors(["react"], rows)).toEqual([
      "@types/react",
      "react",
      "react-dom",
    ]);
    expect(expandMajors(["zod"], rows)).toEqual(["zod"]);
  });
});

describe("spec edits", () => {
  test("applyEdit rewrites exact name and spec pairs and keeps the formatting", () => {
    const text =
      '{\n  "catalog": {\n    "three": "^0.184.0",\n    "@types/three": "^0.186.0",\n    "three-x": "^0.184.0"\n  }\n}\n';
    const r = applyEdit(text, "three", "^0.184.0", "^0.186.1");
    expect(r.count).toBe(1);
    expect(r.text).toBe(
      '{\n  "catalog": {\n    "three": "^0.186.1",\n    "@types/three": "^0.186.0",\n    "three-x": "^0.184.0"\n  }\n}\n',
    );
    expect(applyEdit(text, "three", "^9.9.9", "^1.0.0").count).toBe(0);
  });

  test("specEdits targets the catalog file for catalogued names and every literal manifest otherwise", () => {
    const rows: Row[] = [
      {
        name: "a",
        spec: "^1.0.0",
        where: ["catalog"],
        kind: "major",
        inRange: false,
        latest: "2.1.0",
        base: "1.0.0",
      },
      {
        name: "b",
        spec: "^1.0.0",
        where: ["packages/x/package.json", "packages/y/package.json"],
        kind: "major",
        inRange: false,
        latest: "2.0.0",
        eligible: "2.0.0",
        base: "1.0.0",
      },
      {
        name: "h",
        spec: "^1.0.0",
        where: ["catalog"],
        kind: "major",
        inRange: false,
        latest: "2.0.0",
        base: "1.0.0",
        hold: { name: "h", maxMajor: 1, reason: "peer" },
      },
      {
        name: "w",
        spec: "^1.0.0",
        where: ["catalog"],
        kind: "major",
        inRange: false,
        latest: "2.0.0",
        base: "1.0.0",
      },
    ];
    const { edits, errors } = specEdits(
      rows,
      ["a", "b", "h", "w", "ghost"],
      (r) => (r.name === "w" ? undefined : (r.eligible ?? r.latest)),
    );
    expect(edits).toEqual([
      { file: "package.json", name: "a", from: "^1.0.0", to: "^2.1.0" },
      {
        file: "packages/x/package.json",
        name: "b",
        from: "^1.0.0",
        to: "^2.0.0",
      },
      {
        file: "packages/y/package.json",
        name: "b",
        from: "^1.0.0",
        to: "^2.0.0",
      },
    ]);
    expect(errors).toEqual([
      "h: held (peer)",
      "w: no release old enough for minimumReleaseAge",
      "ghost: not a direct dependency",
    ]);
  });
});

const jsonResponse = (
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(body), { status, headers });

const advisoryQuery = async () =>
  new Map([
    ["npm:vite@5.4.0", ["GHSA-1"]],
    ["npm:left-pad@1.0.0", ["GHSA-2", "GHSA-3"]],
    ["npm:dead@1.0.0", ["GHSA-4"]],
  ]);

const latestStub = async (n: string) => ({
  version: n === "dead" ? "1.0.0" : "2.0.0",
});

describe("registry access", () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };

  test("fetchWithBackoff retries 429 and 5xx with exponential delays and honours Retry-After", async () => {
    sleeps.length = 0;
    const seq = [
      jsonResponse(429, {}, { "retry-after": "7" }),
      jsonResponse(503),
      jsonResponse(200, { ok: true }),
    ];
    let i = 0;
    const r = await fetchWithBackoff("https://x", {
      fetcher: async () => seq[i++]!,
      sleep,
      baseMs: 100,
    });
    expect(r?.status).toBe(200);
    expect(sleeps).toEqual([7000, 200]);
  });

  test("fetchWithBackoff gives up after the attempts and returns undefined; 404 is returned immediately", async () => {
    sleeps.length = 0;
    expect(
      await fetchWithBackoff("https://x", {
        fetcher: async () => jsonResponse(500),
        sleep,
        attempts: 3,
        baseMs: 10,
      }),
    ).toBeUndefined();
    expect(sleeps).toEqual([10, 20]);
    const notFound = await fetchWithBackoff("https://x", {
      fetcher: async () => jsonResponse(404),
      sleep,
    });
    expect(notFound?.status).toBe(404);
    expect(
      await fetchWithBackoff("https://x", {
        fetcher: async () => {
          throw new Error("net");
        },
        sleep,
        attempts: 2,
        baseMs: 1,
      }),
    ).toBeUndefined();
  });

  test("npmLatest reads version and deprecation, and survives a 404", async () => {
    const urls: string[] = [];
    const ok = await npmLatest("@scope/pkg", {
      fetcher: async (u) => {
        urls.push(u);
        return jsonResponse(200, { version: "2.0.0", deprecated: "use y" });
      },
      sleep,
    });
    expect(ok).toEqual({ version: "2.0.0", deprecated: "use y" });
    expect(urls).toEqual(["https://registry.npmjs.org/@scope%2fpkg/latest"]);
    expect(
      await npmLatest("gone", {
        fetcher: async () => jsonResponse(404),
        sleep,
      }),
    ).toEqual({});
  });

  test("openAdvisories splits held from open and marks fixable ones", async () => {
    const lock = [
      { ecosystem: "npm" as const, name: "vite", version: "5.4.0" },
      { ecosystem: "npm" as const, name: "left-pad", version: "1.0.0" },
      { ecosystem: "npm" as const, name: "dead", version: "1.0.0" },
    ];
    const r = await openAdvisories(
      lock,
      [{ ecosystem: "npm", name: "vite", reason: "dev server only" }],
      { query: advisoryQuery, fetchLatest: latestStub },
    );
    expect(r.held.map((a) => a.name)).toEqual(["vite"]);
    expect(r.open.map((a) => [a.name, a.fixable])).toEqual([
      ["left-pad", true],
      ["dead", false],
    ]);
  });
});

describe("overrides", () => {
  test("describeOverrides lists resolved versions and flags a missing local tarball", () => {
    const c = new Ctx("/nonexistent-root", false, false);
    const o = describeOverrides(
      c,
      { overrides: { qs: "^6.16.0", "@x/y": "file:.cache/y.tgz" } },
      [
        { ecosystem: "npm", name: "qs", version: "6.16.1" },
        { ecosystem: "npm", name: "qs", version: "6.9.0" },
      ],
      new Map([["qs", { version: "6.16.1" }]]),
    );
    expect(o[0]).toMatchObject({
      name: "qs",
      resolved: ["6.9.0", "6.16.1"],
      latest: "6.16.1",
      local: false,
    });
    expect(o[1]).toMatchObject({ name: "@x/y", local: true, missing: true });
  });
});

describe("arguments", () => {
  test("parseArgs", () => {
    expect(
      parseArgs(
        ["apply", "--majors", "react,react-dom", "--majors=vite", "--offline"],
        resolve("/r"),
      ),
    ).toMatchObject({
      sub: "apply",
      majors: ["react", "react-dom", "vite"],
      offline: true,
      root: resolve("/r"),
    });
    expect(parseArgs([], "/r").sub).toBe("status");
    expect(
      parseArgs(["verify", "--skip-tests", "--root", "/x/y"], "/r"),
    ).toMatchObject({
      sub: "verify",
      skipTests: true,
      root: resolve("/x/y"),
    });
    expect(() => parseArgs(["--bogus"], "/r")).toThrow("unknown argument");
  });
});
