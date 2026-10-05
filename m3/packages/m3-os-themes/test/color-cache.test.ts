// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { rolesFor } from "../src/color.ts";
import { generate } from "../src/index.ts";

const input = { name: "Cache", seed: "#6750a4", mode: "auto" as const };

describe("rolesFor memoisation", () => {
  it("returns the same frozen object for the same seed, variant and mode", () => {
    const a = rolesFor(input, "light");
    expect(rolesFor({ ...input, name: "Other" }, "light")).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.roles)).toBe(true);
  });

  it("keys on seed, variant and mode", () => {
    const light = rolesFor(input, "light");
    expect(rolesFor(input, "dark")).not.toBe(light);
    expect(rolesFor({ ...input, seed: "#00ff88" }, "light").roles["primary"]).not.toBe(
      light.roles["primary"],
    );
    expect(rolesFor({ ...input, variant: "vibrant" }, "light").roles["primary"]).not.toBe(
      light.roles["primary"],
    );
    expect(rolesFor({ ...input, seed: "#6750A4" }, "light")).toBe(light);
  });

  it("still validates the seed before consulting the cache", () => {
    expect(() => rolesFor({ ...input, seed: "nope" }, "light")).toThrow("invalid seed colour");
  });

  it("generates identical files on repeated calls", () => {
    const first = generate(input);
    const again = generate(input);
    expect(again.map((f) => [f.path, f.content])).toEqual(first.map((f) => [f.path, f.content]));
  });
});
