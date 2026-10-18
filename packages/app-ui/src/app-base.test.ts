// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { appBasePath, normalizeAppBase } from "./app-base";

describe("App UI deployment base", () => {
  test("root and embedded deployment keep the same route prefix", () => {
    expect(normalizeAppBase("/")).toBe("/");
    expect(appBasePath("https://aphrody.com/workspace/")).toBe("/workspace/");
    expect(appBasePath("https://aphrody.com/")).toBe("/");
  });
  test("rejects origins, traversal, ambiguous paths and HTML injection", () => {
    for (const path of [
      "https://example.com/",
      "//example.com/",
      "/workspace",
      "/../",
      "/a/../",
      "/a%2fb/",
      "/a?x/",
      '/a"/',
    ]) {
      expect(() => normalizeAppBase(path)).toThrow();
    }
  });
});
