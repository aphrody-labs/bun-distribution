// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubSlug, nonVital, renderDocs } from "../src/sources/upstream.ts";
import { parseManifest } from "../src/sources/restore.ts";

const sha = (c: string) => c.repeat(40);

const text = JSON.stringify({
  schemaVersion: 1,
  root: "../source",
  sources: [
    {
      id: "dep",
      kind: "crate",
      crate: "dep",
      version: "1.0.0",
      role: "dependency",
      pinned: true,
      cargoPathDep: "",
      hold: "consumer needs 1.0.0",
      patches: [],
    },
  ],
  reference: [
    {
      id: "alpha",
      kind: "git",
      tier: "reference",
      url: "https://github.com/o/alpha.git",
      ref: "main",
      observedCommit: sha("a"),
      purpose: "reads alpha",
      consumers: "docs/a.md",
    },
    {
      id: "beta",
      kind: "git",
      tier: "build",
      url: "https://github.com/o/beta",
      purpose: "build input",
      consumers: "config/b.json",
    },
  ],
});

describe("reference catalogue", () => {
  test("parses vital sources (with hold) and reference entries", () => {
    const m = parseManifest(text);
    expect(m.sources[0]!.hold).toBe("consumer needs 1.0.0");
    expect(m.reference?.map(r => r.id)).toEqual(["alpha", "beta"]);
  });

  test("rejects unknown tier, duplicate ids, bad observed commit and missing purpose", () => {
    const base = JSON.parse(text);
    const bad = (mutate: (m: any) => void) => {
      const m = structuredClone(base);
      mutate(m);
      return () => parseManifest(JSON.stringify(m));
    };
    expect(bad(m => (m.reference[0].tier = "cache"))).toThrow("tier");
    expect(bad(m => (m.reference[1].id = "alpha"))).toThrow("duplicate");
    expect(bad(m => (m.reference[0].id = "dep"))).toThrow("duplicate");
    expect(bad(m => (m.reference[0].observedCommit = "abc"))).toThrow("observedCommit");
    expect(bad(m => delete m.reference[0].purpose)).toThrow("purpose");
  });

  test("githubSlug accepts github urls only", () => {
    expect(githubSlug("https://github.com/o/alpha.git")).toBe("o/alpha");
    expect(githubSlug("https://github.com/o/alpha/")).toBe("o/alpha");
    expect(githubSlug("https://gitlab.com/o/alpha")).toBeUndefined();
  });

  test("renderDocs lists every tier and is deterministic", () => {
    const m = parseManifest(text);
    const doc = renderDocs(m);
    expect(doc).toContain("## Vital checkouts (1)");
    expect(doc).toContain("held: consumer needs 1.0.0");
    expect(doc).toContain("[o/alpha](https://github.com/o/alpha)");
    expect(doc).toContain("## Build-on-demand upstreams (1)");
    expect(doc).toContain("crates/infra/aphrody-command/src/wsl");
    expect(doc).not.toContain("crates/os/aphrody-wsl");
    expect(doc).toContain("(not in repo), an untracked machine-local cache");
    expect(renderDocs(m)).toBe(doc);
  });
});

describe("nonVital", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  test("lists directories that are not vital sources and skips pre-bump leftovers", () => {
    dir = mkdtempSync(join(tmpdir(), "aphrody-nonvital-"));
    for (const d of ["dep", "alpha", "zeta", "dep.pre-bump-1"]) mkdirSync(join(dir, d));
    expect(nonVital(dir, parseManifest(text))).toEqual(["alpha", "zeta"]);
    expect(nonVital(join(dir, "missing"), parseManifest(text))).toEqual([]);
  });
});
