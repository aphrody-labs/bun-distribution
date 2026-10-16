import { expect, test } from "bun:test";
import { generateBrandCss, parseBrandConfig, scopeNativeSheet } from "./rg-m3";

const theme = {
  id: "achillea",
  seed: "#6d00ce",
  dark: true,
  selectors: [":root.achillea", ".achillea"],
};
const config = {
  schemaVersion: 1,
  generator: "aphrody-m3-tokens",
  variant: "tonal-spot",
  contrast: 0,
  themes: [theme],
};

test("brand configuration rejects duplicate selectors and malformed seeds", () => {
  expect(parseBrandConfig(config).themes).toHaveLength(1);
  expect(() => parseBrandConfig({ ...config, themes: [theme, { ...theme, id: "other" }] })).toThrow("repeated");
  expect(() => parseBrandConfig({ ...config, themes: [{ ...theme, seed: "#wrong" }] })).toThrow("theme");
  expect(() => parseBrandConfig({ ...config, themes: [{ ...theme, selectors: ["body; :root"] }] })).toThrow("selector");
  expect(() => parseBrandConfig({ ...config, contrast: Number.NaN })).toThrow("contract");
});

test("native scheme scoping retains every role, aliases and Tailwind declarations", () => {
  const sheet =
    ":root {\n--md-sys-color-primary: #123456;\n--md-sys-color-on-primary: #ffffff;\n}\n:root {\n--primary: var(--md-sys-color-primary);\n}\n@theme inline {\n--color-primary: var(--md-sys-color-primary);\n}";
  const scoped = scopeNativeSheet(sheet, theme);
  expect(scoped).toContain(":root.achillea,\n.achillea {");
  expect(scoped).toContain("--md-sys-color-on-primary: #ffffff;");
  expect(scoped).toContain("--primary: var(--md-sys-color-primary);");
  expect(scoped).toContain("@theme inline");
  expect(scoped).not.toContain(":root {");
  expect(() => scopeNativeSheet(sheet.replace("--primary:", "--invalid:"), theme)).toThrow("contract");
});

test("generation refuses an unavailable native executable without producing fallback colors", async () => {
  await expect(generateBrandCss(parseBrandConfig(config), "missing-qualified-native-m3-generator")).rejects.toThrow();
});
