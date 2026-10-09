// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  FUSION_ALIAS_MAP,
  ALIASES,
  exportShadcnAliases,
  exportTailwindTheme,
  exportFusionCss,
} from "../src/index.ts";
import { Hct, argbFromHex, hexFromArgb } from "@aphrody/m3-tokens/dynamic-color";

describe("Token fusion contracts (M3, Tailwind v4, shadcn/ui)", () => {
  test("FUSION_ALIAS_MAP matches the canonical 19-role map in Rust crates/ui/m3-tokens", () => {
    expect(FUSION_ALIAS_MAP.length).toBe(19);
    expect(ALIASES).toBe(FUSION_ALIAS_MAP);

    const map = new Map(FUSION_ALIAS_MAP);
    expect(map.get("primary")).toBe("primary");
    expect(map.get("primary-foreground")).toBe("on-primary");
    expect(map.get("secondary")).toBe("secondary-container");
    expect(map.get("secondary-foreground")).toBe("on-secondary-container");
    expect(map.get("background")).toBe("surface");
    expect(map.get("foreground")).toBe("on-surface");
    expect(map.get("card")).toBe("surface-container-low");
    expect(map.get("card-foreground")).toBe("on-surface");
    expect(map.get("popover")).toBe("surface-container");
    expect(map.get("popover-foreground")).toBe("on-surface");
    expect(map.get("muted")).toBe("surface-variant");
    expect(map.get("muted-foreground")).toBe("on-surface-variant");
    expect(map.get("accent")).toBe("tertiary-container");
    expect(map.get("accent-foreground")).toBe("on-tertiary-container");
    expect(map.get("destructive")).toBe("error");
    expect(map.get("destructive-foreground")).toBe("on-error");
    expect(map.get("border")).toBe("outline-variant");
    expect(map.get("input")).toBe("outline-variant");
    expect(map.get("ring")).toBe("primary");
  });

  test("exportShadcnAliases outputs valid :root block with var(--md-sys-color-*) references", () => {
    const css = exportShadcnAliases();
    expect(css.startsWith(":root {\n")).toBe(true);
    expect(css.endsWith("}\n")).toBe(true);

    for (const [name, role] of FUSION_ALIAS_MAP) {
      expect(css).toContain(`  --${name}: var(--md-sys-color-${role});`);
    }
  });

  test("exportTailwindTheme outputs valid @theme inline block with --color-* tokens", () => {
    const css = exportTailwindTheme();
    expect(css.startsWith("@theme inline {\n")).toBe(true);
    expect(css.endsWith("}\n")).toBe(true);

    for (const [name, role] of FUSION_ALIAS_MAP) {
      expect(css).toContain(`  --color-${name}: var(--md-sys-color-${role});`);
    }
  });

  test("exportFusionCss combines M3 system colors, shadcn aliases, and tailwind theme", () => {
    const css = exportFusionCss("#6750a4");
    expect(css).toContain("--md-sys-color-primary:");
    expect(css).toContain("--primary: var(--md-sys-color-primary);");
    expect(css).toContain("@theme inline {");
    expect(css).toContain("--color-primary: var(--md-sys-color-primary);");
  });

  test("HCT color token utilities are exported and functional", () => {
    const hct = Hct.fromInt(argbFromHex("#6750a4"));
    expect(typeof hct.hue).toBe("number");
    expect(typeof hct.chroma).toBe("number");
    expect(typeof hct.tone).toBe("number");
    expect(hexFromArgb(hct.toInt()).toLowerCase()).toBe("#6750a4");
  });
});
