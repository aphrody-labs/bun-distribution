// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { rolesFor } from "../src/color.ts";
import { generate } from "../src/index.ts";
import { ROLES } from "@aphrody/m3-tokens/dynamic-color";
import { parseNativeThemeExport } from "@aphrody/m3-tokens/native-theme";

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
    expect(rolesFor({ ...input, seed: "#00ff88" }, "light").roles["primary"]).not.toBe(light.roles["primary"]);
    expect(rolesFor({ ...input, variant: "vibrant" }, "light").roles["primary"]).not.toBe(light.roles["primary"]);
    expect(rolesFor({ ...input, seed: "#6750A4" }, "light")).toBe(light);
  });

  it("still validates the seed before consulting the cache", () => {
    expect(() => rolesFor({ ...input, seed: "nope" }, "light")).toThrow("invalid seed colour");
  });

  it("keeps contrast variants distinct without splitting equivalent defaults", () => {
    const standard = rolesFor(input, "light");
    expect(rolesFor({ ...input, contrastLevel: 0, variant: "tonalSpot" }, "light")).toBe(standard);
    const high = rolesFor({ ...input, contrastLevel: 1 }, "light");
    expect(high).not.toBe(standard);
    expect(high.roles["primary"]).not.toBe(standard.roles["primary"]);
    for (const contrastLevel of [NaN, Infinity, -1.1, 1.1])
      expect(() => rolesFor({ ...input, contrastLevel }, "light")).toThrow("M3 contrast");
  });

  it("generates identical files on repeated calls", () => {
    const first = generate(input);
    const again = generate(input);
    expect(again.map(f => [f.path, f.content])).toEqual(first.map(f => [f.path, f.content]));
  });
  it("consumes native roles and refuses metadata drift or stale cached colours", () => {
    const source = {
      schema_version: 1,
      spec_version: "2021",
      seed: input.seed,
      variant: "tonal-spot",
      contrast_level: 0,
      light: Object.fromEntries(ROLES.map(role => [role, "#aabbcc"])),
      dark: Object.fromEntries(ROLES.map(role => [role, "#112233"])),
    };
    const nativeTheme = parseNativeThemeExport(source);
    expect(rolesFor({ ...input, nativeTheme }, "light").roles["primary"]).toBe("#aabbcc");
    expect(rolesFor({ ...input, nativeTheme }, "dark").roles["onSurface"]).toBe("#112233");
    expect(() => rolesFor({ ...input, seed: "#123456", nativeTheme }, "light")).toThrow("does not match");
    source.light["primary"] = "#ff0000";
    const changed = parseNativeThemeExport(source);
    expect(rolesFor({ ...input, nativeTheme: changed }, "light").roles["primary"]).toBe("#ff0000");
  });
});
