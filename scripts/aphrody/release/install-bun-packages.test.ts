// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { installSpecs } from "./install-bun-packages.ts";

const packages = [
  { name: "@aphrody/fuzzy", version: "0.1.1", status: "published" },
  { name: "@aphrody/bun", version: "3.3.7", status: "blocked" },
];
test("pins only qualified registry versions", () => {
  expect(installSpecs(packages)).toEqual(["@aphrody/fuzzy@0.1.1"]);
});
test("refuses an explicitly requested blocked or unknown package", () => {
  expect(() => installSpecs(packages, ["@aphrody/bun"])).toThrow(
    "not qualified and published",
  );
  expect(() => installSpecs(packages, ["@aphrody/missing"])).toThrow(
    "not qualified and published",
  );
});
