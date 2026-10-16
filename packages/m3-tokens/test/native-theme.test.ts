// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { ROLES } from "../src/dynamic-color";
import {
  nativeThemeColorRoles,
  nativeThemeCss,
  parseNativeThemeExport,
} from "../src/native-theme";

function fixture() {
  return {
    schema_version: 1,
    spec_version: "2021",
    seed: "#8c6c88",
    variant: "tonal-spot",
    contrast_level: 0,
    light: Object.fromEntries(ROLES.map((role) => [role, "#AaBbCc"])),
    dark: Object.fromEntries(ROLES.map((role) => [role, "#123456"])),
  };
}

describe("native theme export adapter", () => {
  test("preserves all native colours in both modes without computing replacements", () => {
    const input = fixture();
    const theme = parseNativeThemeExport(input);
    input.light["primary"] = "#ffffff";
    expect(Object.isFrozen(theme.light)).toBe(true);
    for (const dark of [false, true]) {
      const roles = nativeThemeColorRoles(theme, dark);
      expect(Object.keys(roles)).toHaveLength(49);
      expect(new Set(Object.values(roles))).toEqual(
        new Set([dark ? "#123456" : "#aabbcc"]),
      );
    }
    const css = nativeThemeCss(theme, {
      lightSelector: ".light",
      darkSelector: ".dark",
    });
    expect(css).toContain(".light {\n  color-scheme: light;");
    expect(css).toContain(".dark {\n  color-scheme: dark;");
    expect(css).toContain("--md-sys-color-on-primary-container: #aabbcc;");
  });

  test("rejects incomplete, injected or unsupported native exports", () => {
    expect(() =>
      parseNativeThemeExport({ ...fixture(), schema_version: 2 }),
    ).toThrow("schema");
    expect(() =>
      parseNativeThemeExport({ ...fixture(), spec_version: "2026" }),
    ).toThrow("specification");
    expect(() =>
      parseNativeThemeExport({ ...fixture(), variant: "unknown" }),
    ).toThrow("variant");
    expect(() =>
      parseNativeThemeExport({ ...fixture(), variant: "cmf" }),
    ).toThrow("variant");
    expect(
      parseNativeThemeExport({ ...fixture(), variant: "fidelity" }).variant,
    ).toBe("fidelity");
    expect(
      parseNativeThemeExport({ ...fixture(), variant: "fruit-salad" }).variant,
    ).toBe("fruit-salad");
    expect(() =>
      parseNativeThemeExport({ ...fixture(), contrast_level: NaN }),
    ).toThrow("contrast");
    expect(() =>
      parseNativeThemeExport({ ...fixture(), seed: "red; display:none" }),
    ).toThrow("hex");
    const missing = fixture();
    delete missing.light["primary"];
    expect(() => parseNativeThemeExport(missing)).toThrow("49 roles");
    const injected = fixture();
    injected.dark["onSurface"] = "#123456; display:none";
    expect(() => parseNativeThemeExport(injected)).toThrow("hex");
  });
});
