// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { aphrodyClosure, exportTargets } from "../src/aphrody-packages.ts";

const root = join(import.meta.dir, "../../../..");

test("export targets cover every condition, main and module, but not patterns", () => {
  expect(
    exportTargets({
      version: "1.0.0",
      exports: {
        ".": { types: "./dist/index.d.mts", import: "./dist/index.mjs" },
        "./*": "./src/*.ts",
      },
      main: "./main.js",
    }).toSorted(),
  ).toEqual(["dist/index.d.mts", "dist/index.mjs", "main.js"]);
});

test("the RG closure includes transitive workspace packages and reports the Yolo SDK as external", async () => {
  const { members, external } = await aphrodyClosure(root, ["@aphrody/agent-browser"]);
  expect(members.map((member) => member.name)).toContain("@aphrody/agent-browser");
  expect(external).toContain("@aphrody/runtime-sdk");
});
