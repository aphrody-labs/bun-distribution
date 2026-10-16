// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { docDescription, forkLicense, versionPathDeps } from "./crates-io-prepare.ts";

describe("crates-io-prepare", () => {
  test("description comes from the first crate doc sentence", () => {
    expect(
      docDescription("// SPDX\n//! Native **RAG** engine for `aphrody`.\n//! More.\nuse x;"),
    ).toBe("Native RAG engine for aphrody.");
    expect(docDescription("#![allow(x)]\n\n//! Hello")).toBe("Hello");
    expect(docDescription("use x;\n//! late")).toBeUndefined();
  });

  test("forks keep their upstream licence", () => {
    expect(forkLicense("bun/packages/bun-tauri/crates/aphrody-tauri-cli")).toBe("Apache-2.0 OR MIT");
    expect(forkLicense("crates/ai/rag")).toBe("");
  });

  test("path dependencies get the version of their target, others are untouched", () => {
    const toml = [
      `yolo-core = { path = "../yolo-core", default-features = false }`,
      `serde = { workspace = true }`,
      `a = { path = "../a", version = "1.0.0" }`,
      `b = { path = "../missing" }`,
    ].join("\n");
    const out = versionPathDeps(toml, (p) => (p === "../yolo-core" ? "0.1.0" : undefined));
    expect(out.split("\n")).toEqual([
      `yolo-core = { path = "../yolo-core", default-features = false, version = "0.1.0" }`,
      `serde = { workspace = true }`,
      `a = { path = "../a", version = "1.0.0" }`,
      `b = { path = "../missing" }`,
    ]);
  });
});
