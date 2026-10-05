// SPDX-License-Identifier: Apache-2.0
// oxlint-disable-next-line import/no-unassigned-import -- installs browser globals before React DOM is loaded
import "@aphrody/m3-config/test/dom";
import { describe, expect, test } from "bun:test";
import { applyDynamicFusionTheme, ALIASES } from "../src/index.ts";
import { schemeFromSeed } from "@aphrody/m3-tokens/dynamic-color";

describe("production fusion theme application", () => {
  test("an invalid update leaves the existing theme intact", () => {
    const target = document.createElement("section");
    applyDynamicFusionTheme("#6750a4", { dark: false, target });
    const previous = target.outerHTML;
    expect(() => applyDynamicFusionTheme("invalid", { dark: true, target })).toThrow();
    expect(target.outerHTML).toBe(previous);
    expect(() =>
      applyDynamicFusionTheme("#6750a4", { contrastLevel: NaN, dark: true, target }),
    ).toThrow();
    expect(target.outerHTML).toBe(previous);
  });

  test("React/Tailwind aliases and Lit inherited roles share the same runtime scheme", () => {
    const target = document.createElement("section");
    for (const dark of [false, true]) {
      applyDynamicFusionTheme(" abc ", { dark, target, contrastLevel: 1, variant: "fidelity" });
      const roles = schemeFromSeed("#aabbcc", { dark, contrastLevel: 1, variant: "fidelity" });
      for (const [role, value] of Object.entries(roles))
        expect(target.style.getPropertyValue(role)).toBe(value);
      for (const [alias, role] of ALIASES) {
        expect(target.style.getPropertyValue(`--${alias}`)).toBe(`var(--md-sys-color-${role})`);
        expect(target.style.getPropertyValue(`--color-${alias}`)).toBe(
          `var(--md-sys-color-${role})`,
        );
      }
      expect(target.classList.contains("dark")).toBe(dark);
    }
  });
});
