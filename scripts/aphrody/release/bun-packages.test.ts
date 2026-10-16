// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { auditPayload } from "./bun-packages.ts";

const manifest = {
  name: "@aphrody/example",
  version: "1.0.0",
  license: "Apache-2.0",
  files: ["src"],
  exports: { ".": "./src/index.ts", "./*": "./src/*.ts" },
};

test("accepts a resolved Bun payload and wildcard exports", () => {
  expect(
    auditPayload({ ...manifest, dependencies: { zod: "^4.0.0" } }, [
      "package.json",
      "src/index.ts",
      "src/client.ts",
    ]),
  ).toEqual([]);
});
test("rejects missing entrypoints even if the workspace file exists", () => {
  expect(auditPayload(manifest, ["package.json"])).toEqual([
    "missing entry: ./src/index.ts",
    "missing entry: ./src/*.ts",
  ]);
});
test("rejects local dependencies and protected archive paths", () => {
  const errors = auditPayload({ ...manifest, dependencies: { owner: "workspace:*" } }, [
    "src/index.ts",
    ".env.production",
    "data/store.sqlite",
    "../escape",
    "node_modules/owner/index.js",
  ]);
  expect(errors).toContain("local dependency: owner=workspace:*");
  expect(errors.filter((error) => error.startsWith("protected filename:"))).toHaveLength(4);
});
