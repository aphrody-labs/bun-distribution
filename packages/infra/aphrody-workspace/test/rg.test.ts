import { expect, test } from "bun:test";
import { rgRoots } from "../src/rg.ts";

test("RG paths are anchored to the Aphrody workspace layout", () => {
  expect(rgRoots("/workspace/aphrody")).toEqual([
    "/workspace/aphrody/apps/rg",
    "/workspace/aphrody/packages/rg",
  ]);
});
