// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate, nearestGnomeAccent, registryValues, themeManifest } from "../src/index.ts";
import { run } from "../src/cli.ts";

const input = { name: "Test", seed: "#6750a4", mode: "auto" as const };
const text = (path: string): string => {
  const f = generate(input).find((x) => x.path === path);
  if (!f) throw new Error(`missing ${path}`);
  return typeof f.content === "string" ? f.content : new TextDecoder().decode(f.content);
};

describe("generate", () => {
  it("is deterministic and covers every target", () => {
    const a = generate(input);
    expect(a).toEqual(generate(input));
    expect(new Set(a.map((f) => f.target))).toEqual(
      new Set(["windows", "gnome", "cosmic", "chromium"]),
    );
  });
  it("rejects bad seeds and names", () => {
    expect(() => generate({ ...input, seed: "nope" })).toThrow();
    expect(() => generate({ ...input, name: "a b" })).toThrow();
  });
});

describe("windows", () => {
  it("derives Personalize and DWM values from the roles", () => {
    const light = registryValues(input, "light");
    const dark = registryValues(input, "dark");
    expect(light.find((v) => v.name === "AppsUseLightTheme")?.value).toBe(1);
    expect(dark.find((v) => v.name === "SystemUsesLightTheme")?.value).toBe(0);
    const accent = light.find((v) => v.name === "AccentColor")!.value as number;
    expect(accent >>> 24).toBe(255);
    const pal = light.find((v) => v.name === "AccentPalette")!.value as number[];
    expect(pal).toHaveLength(32);
  });
  it("emits theme files and a reversible idempotent script", () => {
    expect(text("windows/M3-Test-dark.theme")).toContain("[VisualStyles]");
    const ps = text("windows/install-windows.ps1");
    expect(ps).toContain("Themes\\Personalize");
    expect(ps).toContain("AccentColor");
    expect(ps).toContain("-Uninstall");
    expect(ps).toContain("SupportsShouldProcess");
    expect(ps).toContain("if (-not (Test-Path $Backup))");
  });
});

describe("gnome", () => {
  it("writes shell, gtk-3.0 and gtk-4.0 css plus the gsettings installer", () => {
    const paths = generate(input, ["gnome"]).map((f) => f.path);
    for (const p of [
      "gnome-shell/gnome-shell.css",
      "gtk-3.0/gtk.css",
      "gtk-4.0/gtk.css",
      "gtk-4.0/gtk-dark.css",
      "index.theme",
    ]) {
      expect(paths).toContain(`gnome/themes/M3-Test/${p}`);
    }
    const sh = text("gnome/install-gnome.sh");
    expect(sh).toContain("gsettings set");
    expect(sh).toContain("--uninstall");
    expect(text("gnome/themes/M3-Test/gtk-4.0/gtk.css")).toContain("@define-color accent_bg_color");
  });
  it("maps a seed to the nearest GNOME accent", () => {
    expect(nearestGnomeAccent("#3584e4")).toBe("blue");
    expect(nearestGnomeAccent("#e62d42")).toBe("red");
  });
});

describe("cosmic", () => {
  it("writes RON builder keys for both modes", () => {
    expect(text("cosmic/config/com.system76.CosmicTheme.Dark.Builder/v1/accent")).toMatch(
      /^Some\(\(red: 0\.\d+, green: 0\.\d+, blue: 0\.\d+\)\)$/,
    );
    expect(text("cosmic/config/com.system76.CosmicTheme.Light.Builder/v1/bg_color")).toContain(
      "alpha: 1.000000",
    );
    expect(text("cosmic/M3-Test-dark.ron")).toContain("accent: Some(");
    expect(text("cosmic/install-cosmic.sh")).toContain("--uninstall");
  });
});

describe("chromium", () => {
  it("builds a valid MV3 theme manifest with colors, tints and images", () => {
    const m = themeManifest(input, "dark");
    expect(m.manifest_version).toBe(3);
    expect(m.theme.colors["frame"]).toHaveLength(3);
    expect(m.theme.tints["buttons"]).toEqual([-1, -1, -1]);
    expect(m.theme.images["theme_ntp_background"]).toBe("images/ntp.png");
    expect(JSON.parse(text("chromium/light/manifest.json")).theme.colors.toolbar).toHaveLength(3);
  });
  it("emits a PNG and BrowserThemeColor policies", () => {
    const png = generate(input, ["chromium"]).find(
      (f) => f.path === "chromium/dark/images/ntp.png",
    )!.content as Uint8Array;
    expect(Array.from(png.slice(0, 4))).toEqual([137, 80, 78, 71]);
    expect(
      JSON.parse(text("chromium/policies/managed/m3-theme-dark.json")).BrowserThemeColor,
    ).toMatch(/^#[0-9a-f]{6}$/);
    expect(text("chromium/policies/windows/m3-theme-light.reg")).toContain("BraveSoftware\\Brave");
  });
});

describe("cli", () => {
  it("install is dry-run by default and never executes", () => {
    const calls: string[][] = [];
    const r = run(
      ["install", "--target", "all", "--seed", "#336699", "--mode", "dark"],
      (c) => (calls.push(c), 0),
    );
    expect(r.code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(r.out.join("\n")).toContain("dry-run");
  });
  it("generate writes only into --out", () => {
    const dir = mkdtempSync(join(tmpdir(), "m3os-"));
    try {
      const r = run(["generate", "--target", "chromium", "--seed", "#336699", "--out", dir]);
      expect(r.code).toBe(0);
      expect(existsSync(join(dir, "chromium/dark/manifest.json"))).toBe(true);
      expect(readdirSync(dir)).toEqual(["chromium"]);
      expect(readFileSync(join(dir, "chromium/install-chromium.md"), "utf8")).toContain(
        "Load unpacked",
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it("rejects bad input", () => {
    expect(run(["generate", "--target", "mac"]).code).toBe(2);
    expect(run(["generate", "--seed", "zz"]).code).toBe(2);
  });
});
