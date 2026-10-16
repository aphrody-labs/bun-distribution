import { expect, test } from "bun:test";
import {
  cargoPathFor,
  cargoProblems,
  parseArgs,
  parseManifest,
  type Manifest,
} from "../src/sources/restore.ts";

const base = {
  schemaVersion: 1,
  root: "../source",
  sources: [
    {
      id: "a",
      kind: "git",
      url: "https://x/a",
      commit: "a".repeat(40),
      pinned: true,
      role: "dependency",
      cargoPathDep: "pkg",
    },
    {
      id: "b",
      kind: "crate",
      crate: "b",
      version: "1.0.0",
      pinned: true,
      role: "dependency",
      cargoPathDep: "",
    },
  ],
};
const text = (patch: object = {}) => JSON.stringify({ ...base, ...patch });

test("parseManifest accepts a valid manifest and rejects bad ones", () => {
  expect(parseManifest(text()).sources).toHaveLength(2);
  expect(() => parseManifest(text({ schemaVersion: 2 }))).toThrow();
  expect(() =>
    parseManifest(text({ sources: [base.sources[0], base.sources[0]] })),
  ).toThrow(/duplicate/);
  expect(() =>
    parseManifest(text({ sources: [{ ...base.sources[0], commit: "abc" }] })),
  ).toThrow(/40-hex/);
  expect(() =>
    parseManifest(
      text({
        sources: [{ id: "../x", kind: "crate", crate: "x", version: "1" }],
      }),
    ),
  ).toThrow(/invalid id/);
});

test("cargo path dependencies are derived relative to the repository", () => {
  const manifest = base as unknown as Manifest;
  expect(cargoPathFor("/h/aphrody", "/h/source", manifest.sources[0]!)).toBe(
    "../source/a/pkg",
  );
  expect(cargoPathFor("/h/aphrody", "/h/source", manifest.sources[1]!)).toBe(
    "../source/b",
  );
  const ok = `a = { path = "../source/a/pkg" }\nb = { path = "../source/b" }`;
  expect(cargoProblems(ok, "/h/aphrody", "/h/source", manifest)).toEqual([]);
  expect(
    cargoProblems(
      `b = { path = "../source/b" }`,
      "/h/aphrody",
      "/h/source",
      manifest,
    ),
  ).toHaveLength(1);
  expect(
    cargoProblems(
      `${ok}\nx = { path = "upstream/simdutf-rio" }`,
      "/h/aphrody",
      "/h/source",
      manifest,
    ),
  ).toHaveLength(1);
});

test("parseArgs", () => {
  expect(parseArgs(["sync", "--apply", "--only", "a"])).toMatchObject({
    action: "sync",
    apply: true,
    only: "a",
  });
  expect(() => parseArgs(["nope"])).toThrow();
});

test("integrated crates cannot escape their owner and must be wired into Cargo", () => {
  const integrated = [
    { ...base.sources[1], id: "owned", integratedPath: "crates/native/owned" },
  ];
  const manifest = parseManifest(text({ sources: [], integrated }));
  expect(
    cargoProblems(
      'owned = { path = "crates/native/owned" }',
      "/repo",
      "/source",
      manifest,
    ),
  ).toEqual([]);
  expect(cargoProblems("", "/repo", "/source", manifest)).toHaveLength(1);
  expect(() =>
    parseManifest(
      text({
        sources: [],
        integrated: [
          { ...integrated[0], integratedPath: "crates/../../source/owned" },
        ],
      }),
    ),
  ).toThrow("under crates");
});
