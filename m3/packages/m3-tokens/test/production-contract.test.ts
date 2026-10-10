// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { schemeFromSeed, type SchemeVariant } from "../src/dynamic-color.ts";

describe("production dynamic colour inputs", () => {
  test("shorthand, unprefixed and padded seeds resolve to the same role set", () => {
    expect(schemeFromSeed(" abc ")).toEqual(schemeFromSeed("#aabbcc"));
    expect(schemeFromSeed("6750A4")).toEqual(schemeFromSeed("#6750a4"));
  });

  test("rejects malformed colours instead of silently deriving a black theme", () => {
    for (const seed of ["", "red", "#12", "#gggggg", "#12345678", "123456junk"]) {
      expect(() => schemeFromSeed(seed)).toThrow("Invalid M3 seed color");
    }
  });

  test("rejects nonfinite or unsupported contrast and variants", () => {
    for (const contrastLevel of [NaN, Infinity, -Infinity, -1.1, 1.1]) {
      expect(() => schemeFromSeed("#6750a4", { contrastLevel })).toThrow(RangeError);
    }
    expect(() => schemeFromSeed("#6750a4", { variant: "unregistered" as SchemeVariant })).toThrow(
      "Unknown M3 scheme variant",
    );
  });
});
