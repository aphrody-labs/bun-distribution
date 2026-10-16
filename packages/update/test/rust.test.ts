// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  bumpReq,
  classify,
  denyAdvisories,
  lockPinDrift,
  directDeps,
  lockGraph,
  parseChannelManifest,
  parseIndex,
  parseToolchainChannel,
  parseUpdateLines,
  featuresEnabling,
  noBuild,
  readDecls,
  rewriteReq,
  satisfies,
  splitAdvisories,
  touchedMembers,
  buildPlan,
} from "../src/ecosystems/rust.ts";

describe("satisfies (Cargo requirements)", () => {
  test("caret, bare and partial requirements", () => {
    expect(satisfies("1.9.3", "1")).toBe(true);
    expect(satisfies("2.0.0", "1")).toBe(false);
    expect(satisfies("0.7.9", "0.7")).toBe(true);
    expect(satisfies("0.8.0", "0.7")).toBe(false);
    expect(satisfies("0.0.16", "0.0.16")).toBe(true);
    expect(satisfies("0.0.17", "0.0.16")).toBe(false);
    expect(satisfies("1.5.0", "1.5.2")).toBe(false);
    expect(satisfies("1.99.0", "^1.5.2")).toBe(true);
  });
  test("tilde, exact, comparison and wildcard", () => {
    expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfies("1.7.0", "=1.7.0")).toBe(true);
    expect(satisfies("1.7.1", "=1.7.0")).toBe(false);
    expect(satisfies("1.5.0", ">=1.2, <2")).toBe(true);
    expect(satisfies("2.0.0", ">=1.2, <2")).toBe(false);
    expect(satisfies("1.9.0", "1.*")).toBe(true);
    expect(satisfies("9.9.9", "*")).toBe(true);
  });
  test("pre-releases only match a requirement naming them", () => {
    expect(satisfies("2.0.0-rc.12", "=2.0.0-rc.12")).toBe(true);
    expect(satisfies("2.0.0-rc.13", "=2.0.0-rc.12")).toBe(false);
    expect(satisfies("2.0.0-rc.13", "^2.0.0-rc.12")).toBe(true);
    expect(satisfies("2.0.0-rc.11", "^2.0.0-rc.12")).toBe(false);
    expect(satisfies("2.0.0", "^2.0.0-rc.12")).toBe(true);
    expect(satisfies("2.0.0-rc.1", "2")).toBe(false);
  });
});

describe("bumpReq", () => {
  test("keeps the operator and the precision", () => {
    expect(bumpReq("0.7", "0.8.3")).toBe("0.8");
    expect(bumpReq("1", "2.4.1")).toBe("2");
    expect(bumpReq("1.5", "2.0.1")).toBe("2.0");
    expect(bumpReq("0.115.1", "0.116.0")).toBe("0.116.0");
    expect(bumpReq("=1.7.0", "1.21.0")).toBe("=1.21.0");
    expect(bumpReq("=6.0.0-rc.29", "6.0.0-rc.31")).toBe("=6.0.0-rc.31");
    expect(bumpReq("^0.4", "0.5.0")).toBe("^0.5");
  });
  test("refuses compound requirements", () => {
    expect(bumpReq(">=1.2, <2", "3.0.0")).toBeUndefined();
    expect(bumpReq("*", "3.0.0")).toBeUndefined();
  });
});

const MANIFEST = `[package]
name = "demo"
version = "0.1.0"

[dependencies]
serde = "1"
tokio = { version = "1.52", default-features = false, features = ["sync"] }
shared = { workspace = true }
local = { path = "../local", version = "0.1.0" }
fork = { git = "https://example.com/fork.git", rev = "abc" }
renamed = { package = "real-name", version = "2" }

[dev-dependencies]
tempfile = "3.8"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.61", features = [
  "Win32_Foundation",
] }

[dependencies.detailed]
version = "0.3"
optional = true
`;

const ROOT = `[workspace]
members = ["crates/*"]

[workspace.dependencies]
shared = { version = "0.9", default-features = false }
serde = "1"
yara-x = { version = "=1.7.0", default-features = false }
`;

describe("manifest declarations", () => {
  test("registry dependencies only, with renames and workspace inheritance", () => {
    const d = readDecls("crates/x/Cargo.toml", MANIFEST);
    const by = (n: string) => d.find((x) => x.name === n);
    expect(by("serde")).toMatchObject({ req: "1", crate: "serde", pkg: "demo" });
    expect(by("tokio")?.req).toBe("1.52");
    expect(by("shared")).toMatchObject({ workspace: true });
    expect(by("tempfile")?.section).toBe("dev-dependencies");
    expect(by("windows-sys")?.section).toBe("target.dependencies");
    expect(by("renamed")?.crate).toBe("real-name");
    expect(by("detailed")?.req).toBe("0.3");
    expect(by("local")).toBeUndefined();
    expect(by("fork")).toBeUndefined();
  });
  test("direct dependencies join workspace entries with their consumers", () => {
    const decls = [...readDecls("Cargo.toml", ROOT), ...readDecls("crates/x/Cargo.toml", MANIFEST)];
    const rows = directDeps(decls);
    const shared = rows.find((r) => r.crate === "shared")!;
    expect(shared.req).toBe("0.9");
    expect(shared.consumers).toEqual(["demo"]);
    expect(shared.declaredIn).toEqual(["Cargo.toml"]);
    const serde = rows.find((r) => r.crate === "serde")!;
    expect(serde.declaredIn.toSorted()).toEqual(["Cargo.toml", "crates/x/Cargo.toml"]);
    expect(rows.find((r) => r.crate === "yara-x")?.req).toBe("=1.7.0");
  });
});

describe("rewriteReq", () => {
  test("rewrites only the named dependency in dependency sections", () => {
    const a = rewriteReq(MANIFEST, "tokio", "1.52", "1.53");
    expect(a.count).toBe(1);
    expect(a.text).toContain('tokio = { version = "1.53", default-features = false');
    expect(rewriteReq(MANIFEST, "serde", "1", "2").text).toContain('serde = "2"');
    const t = rewriteReq(MANIFEST, "detailed", "0.3", "0.4");
    expect(t.count).toBe(1);
    expect(t.text).toContain('version = "0.4"');
    expect(t.text).toContain('version = "0.1.0"\n\n[dependencies]'); // [package] version untouched
    const w = rewriteReq(MANIFEST, "windows-sys", "0.61", "0.62");
    expect(w.count).toBe(1);
    expect(rewriteReq(ROOT, "yara-x", "=1.7.0", "=1.19.0").text).toContain('version = "=1.19.0"');
  });
  test("does not touch a name that is only a prefix, or a stale requirement", () => {
    expect(rewriteReq(MANIFEST, "tok", "1.52", "1.53").count).toBe(0);
    expect(rewriteReq(MANIFEST, "tokio", "9", "10").count).toBe(0);
  });
});

describe("lock graph", () => {
  const lock = `[[package]]
name = "app"
version = "1.0.0"
dependencies = [
 "lib",
 "serde 1.0.0",
]

[[package]]
name = "lib"
version = "1.0.0"
dependencies = [
 "serde 1.0.0",
 "inner",
]

[[package]]
name = "other"
version = "1.0.0"
dependencies = [
 "tokio",
]

[[package]]
name = "inner"
version = "0.1.0"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "serde"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "tokio"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
`;
  test("members are the source-less packages and touched crates are the reverse closure", () => {
    const g = lockGraph(lock);
    expect([...g.members].toSorted()).toEqual(["app", "lib", "other"]);
    expect(touchedMembers(g, ["serde"])).toEqual(["app", "lib"]);
    expect(touchedMembers(g, ["inner"])).toEqual(["app", "lib"]);
    expect(touchedMembers(g, ["tokio"])).toEqual(["other"]);
    expect(touchedMembers(g, ["unrelated"])).toEqual([]);
  });
});

describe("lock pins", () => {
  test("companions that moved past a held crate are reported", () => {
    const lock = [
      { name: "yara-x-proto", version: "1.21.0" },
      { name: "yara-x-parser", version: "1.7.0" },
      { name: "other", version: "2.0.0" },
    ];
    const holds = [
      { crate: "yara-x-proto", reason: "r", lockVersion: "1.7.0" },
      { crate: "yara-x-parser", reason: "r", lockVersion: "1.7.0" },
      { crate: "other", reason: "r" },
    ];
    expect(lockPinDrift(lock, holds)).toEqual([
      { crate: "yara-x-proto", from: "1.21.0", to: "1.7.0" },
    ]);
  });
});

describe("cargo update output", () => {
  test("parses updates, additions, removals and downgrades", () => {
    const out = [
      "    Updating crates.io index",
      "    Updating syn v2.0.1 -> v2.0.2",
      "      Adding pem v4.0.0",
      "    Removing mio v0.8.11",
      " Downgrading openssl v0.10.81 -> v0.10.78 (available: v0.10.81)",
      "note: pass `--verbose` to see 167 unchanged dependencies behind latest",
    ].join("\n");
    expect(parseUpdateLines(out)).toEqual([
      { action: "Updating", name: "syn", from: "2.0.1", to: "2.0.2" },
      { action: "Adding", name: "pem", from: undefined, to: "4.0.0" },
      { action: "Removing", name: "mio", from: undefined, to: "0.8.11" },
      { action: "Downgrading", name: "openssl", from: "0.10.81", to: "0.10.78" },
    ]);
  });
});

const index = (v: string[], yanked: string[] = []) =>
  v.map((vers) => ({ vers, yanked: yanked.includes(vers) }));

describe("classification", () => {
  const lock = [
    { name: "tokio", version: "1.52.0", source: "registry+x" },
    { name: "rand", version: "0.8.5", source: "registry+x" },
    { name: "rand", version: "0.9.0", source: "registry+x" },
    { name: "yara-x", version: "1.7.0", source: "registry+x" },
    { name: "ort", version: "2.0.0-rc.12", source: "registry+x" },
    { name: "tauri", version: "3.0.0-alpha.4", source: "registry+x" },
    { name: "unused", version: "1.0.0" },
  ];
  const versions = new Map([
    ["tokio", index(["1.52.0", "1.53.1", "1.54.0-beta.1", "2.0.0"])],
    ["rand", index(["0.8.5", "0.9.0", "0.9.2", "0.10.0"], ["0.9.2"])],
    ["yara-x", index(["1.7.0", "1.21.0"])],
    ["ort", index(["2.0.0-rc.12", "2.0.0-rc.13"])],
    ["tauri", index(["3.0.0-alpha.4", "3.0.0-alpha.5"])],
  ]);
  const direct = [
    { crate: "tokio", req: "1.52", declaredIn: ["Cargo.toml"], consumers: ["a", "b"] },
    { crate: "rand", req: "0.8", declaredIn: ["crates/x/Cargo.toml"], consumers: ["x"] },
    { crate: "yara-x", req: "=1.7.0", declaredIn: ["Cargo.toml"], consumers: ["aphrody-re"] },
    { crate: "ort", req: "=2.0.0-rc.12", declaredIn: ["Cargo.toml"], consumers: [] },
    { crate: "unused", req: "1", declaredIn: ["Cargo.toml"], consumers: [] },
    { crate: "tauri", req: "=3.0.0-alpha.4", declaredIn: ["Cargo.toml"], consumers: [] },
  ];
  const rows = classify({
    direct,
    lock,
    versions,
    holds: [{ crate: "yara-x", reason: "wasmtime advisories" }],
    owners: new Map([["tauri", "tauri-sync"]]),
    toolchain: "1.98.1",
  });
  const row = (c: string, r?: string) => rows.find((x) => x.crate === c && (!r || x.req === r))!;

  test("in-range and beyond are separate, pre-releases and yanked releases are skipped", () => {
    expect(row("tokio")).toMatchObject({
      locked: "1.52.0",
      inRange: "1.53.1",
      beyond: "2.0.0",
      consumers: ["a", "b"],
    });
    expect(row("rand")).toMatchObject({ locked: "0.8.5", inRange: undefined, beyond: "0.10.0" });
  });
  test("holds, exact pins and owners are flagged, pre-release trains stay in their train", () => {
    expect(row("yara-x")).toMatchObject({
      held: "wasmtime advisories",
      exactPin: true,
      beyond: "1.21.0",
    });
    expect(row("ort")).toMatchObject({ beyond: "2.0.0-rc.13", exactPin: true, held: undefined });
    expect(row("tauri").owner).toBe("tauri-sync");
  });
  test("a declared but unlocked dependency yields no row", () => {
    expect(rows.find((r) => r.crate === "unused")).toBeUndefined();
  });
  test("plan separates precise updates, majors and held", () => {
    const p = buildPlan(
      [{ ...row("tokio") }, row("yara-x")],
      [{ action: "Updating", name: "tokio", from: "1.52.0", to: "1.53.1" }],
    );
    expect(p.precise).toEqual([]); // the bulk refresh already covers tokio
    const q = buildPlan([row("tokio")], []);
    expect(q.precise).toEqual([{ crate: "tokio", from: "1.52.0", to: "1.53.1" }]);
    expect(q.majors[0]).toMatchObject({ crate: "tokio", to: "2.0.0", newReq: "2.0" });
    expect(p.held.map((h) => h.crate)).toEqual(["yara-x"]);
  });
});

describe("build metadata and quoted keys", () => {
  test("toml_edit style +spec versions compare by their core", () => {
    const lock = [{ name: "toml_edit", version: "0.23.10+spec-1.0.0", source: "registry+x" }];
    const versions = new Map([
      [
        "toml_edit",
        [
          { vers: "0.23.10+spec-1.0.0", yanked: false },
          { vers: "0.25.15+spec-1.1.0", yanked: false },
        ],
      ],
    ]);
    expect(noBuild("1.0.0+spec-1.1.0")).toBe("1.0.0");
    const [row] = classify({
      direct: [
        {
          crate: "toml_edit",
          req: "0.23.9",
          declaredIn: ["Cargo.toml"],
          consumers: [],
          optional: {},
        },
      ],
      lock,
      versions,
      holds: [],
    });
    expect(row).toMatchObject({ locked: "0.23.10", inRange: undefined, beyond: "0.25.15" });
  });
  test("rewriteReq handles a quoted version key", () => {
    const text =
      '[workspace.dependencies]\nresvg = {"version" = "0.47", "default-features" = false}\n';
    const out = rewriteReq(text, "resvg", "0.47", "0.48");
    expect(out.count).toBe(1);
    expect(out.text).toContain('{"version" = "0.48"');
  });
  test("optional dependencies record the features that enable them", () => {
    const m =
      '[package]\nname = "n"\n[features]\nstealth = ["wreq", "dep:other"]\n[dependencies]\nwreq = { version = "=6.0.0-rc.29", optional = true }\nother = { version = "1", optional = true }\n';
    const rows = directDeps(readDecls("n/Cargo.toml", m));
    expect(rows.find((r) => r.crate === "wreq")?.optional).toEqual({ n: ["stealth"] });
    expect(featuresEnabling({ a: ["x/y"], b: ["dep:x"], c: ["z"] }, "x")).toEqual(["a", "b"]);
  });
});

describe("cargo deny output", () => {
  test("collects flagged crates from json diagnostics", () => {
    const out = [
      '{"fields":{"level":"WARN","message":"x"},"type":"log"}',
      '{"fields":{"advisory":{"id":"RUSTSEC-2023-0071","package":"rsa"},"code":"vulnerability"},"type":"diagnostic"}',
      '{"fields":{"advisory":{"id":"RUSTSEC-2025-0141","package":"bincode"}},"type":"diagnostic"}',
      '{"fields":{"advisory":{"id":"RUSTSEC-2025-0142","package":"bincode"}},"type":"diagnostic"}',
      "not json",
    ].join("\n");
    expect([...denyAdvisories(out)]).toEqual([
      ["rsa", ["RUSTSEC-2023-0071"]],
      ["bincode", ["RUSTSEC-2025-0141", "RUSTSEC-2025-0142"]],
    ]);
  });
});

describe("advisories and channels", () => {
  test("held crates are split from open ones", () => {
    const hits = new Map([
      ["crates.io:rsa@0.9.6", ["RUSTSEC-2023-0071"]],
      ["crates.io:foo@1.0.0", ["GHSA-xxxx"]],
      ["npm:esbuild@0.21.0", ["GHSA-yyyy"]],
    ]);
    const s = splitAdvisories(hits, [
      { ecosystem: "crates.io", name: "rsa", reason: "no patched release" },
      { ecosystem: "npm", name: "foo", reason: "other ecosystem" },
    ]);
    expect(s.open).toEqual([{ crate: "foo", version: "1.0.0", ids: ["GHSA-xxxx"] }]);
    expect(s.held[0]).toMatchObject({ crate: "rsa", reason: "no patched release" });
  });
  test("toolchain and channel manifests", () => {
    expect(parseToolchainChannel('[toolchain]\nchannel = "1.98.1"\n')).toBe("1.98.1");
    expect(
      parseChannelManifest(
        'date = "2026-10-01"\n[pkg.rust]\nversion = "1.99.0 (abc 2026-09-30)"\n',
      ),
    ).toEqual({ date: "2026-10-01", version: "1.99.0" });
    expect(
      parseIndex(
        '{"vers":"1.0.0","yanked":false,"rust_version":"1.70"}\n{"vers":"1.0.1","yanked":true}\nbroken',
      ),
    ).toEqual([
      { vers: "1.0.0", yanked: false, rustVersion: "1.70" },
      { vers: "1.0.1", yanked: true, rustVersion: undefined },
    ]);
  });
});
