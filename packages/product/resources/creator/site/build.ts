#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Build the creator.aphrody.com page from the shared Material packages: static tokens (m3-tokens.css), the colour scheme
 * of the logo seed (theme.json, the Rust `fidelity` export of aphrody-m3-tokens, kept current by its
 * creator_theme_golden test), the Google Sans Flex brand face of m3-fonts.
 * Output: packages/infra/product/site/dist (build output, not versioned).
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { nativeThemeColorRoles, parseNativeThemeExport } from "@aphrody/m3-tokens/native-theme";

const here = import.meta.dir;
/** Source colour of the logo (QuantizerCelebi + Score of material-color-utilities on assets/icon-256.png). */
export const SEED = "#951ae2";
const THEME = join(here, "theme.json");

const declarations = (roles: Record<string, string>, indent = "  ") =>
  Object.entries(roles)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join("\n");

/** Colour scheme CSS of the Rust export: OS preference by default, `data-theme` overrides. */
export async function schemeCss(path = THEME): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists()))
    throw new Error(
      `${path} is missing; from the Material checkout, run APHRODY_UPDATE_TOKENS=1 cargo test --manifest-path crates/m3-tokens/Cargo.toml --test creator_theme_golden`,
    );
  const theme = parseNativeThemeExport(await file.json());
  if (theme.seed !== SEED || theme.variant !== "fidelity")
    throw new Error(`${path} is not the ${SEED} fidelity export (got ${theme.seed} ${theme.variant})`);
  const light = nativeThemeColorRoles(theme);
  const dark = nativeThemeColorRoles(theme, true);
  return [
    `:root {
  color-scheme: light dark;
${declarations(light)}
}
`,
    `@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
${declarations(dark, "    ")}
  }
}
`,
    `:root[data-theme="light"] {
  color-scheme: light;
}
`,
    `:root[data-theme="dark"] {
  color-scheme: dark;
${declarations(dark)}
}
`,
  ].join("\n");
}

export async function build(outDir = join(here, "dist")): Promise<string> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "fonts"), { recursive: true });
  const tokens = await Bun.file(fileURLToPath(import.meta.resolve("@aphrody/m3-tokens/m3-tokens.css"))).text();
  const scheme = await schemeCss();
  const font = `@font-face {
  font-family: "Google Sans Flex";
  src: url("/fonts/GoogleSansFlex-latin.woff2") format("woff2");
  font-weight: 1 1000;
  font-stretch: 25% 151%;
  font-display: swap;
}
`;
  await Bun.write(join(outDir, "theme.css"), `${font}\n${tokens}\n${scheme}`);
  await cp(
    fileURLToPath(import.meta.resolve("@aphrody/m3-fonts/fonts/web/GoogleSansFlex-latin.woff2")),
    join(outDir, "fonts/GoogleSansFlex-latin.woff2"),
  );
  await Promise.all(["index.html", "page.css", "app.js"].map(name => cp(join(here, "src", name), join(outDir, name))));
  await Promise.all(
    ["logo.webp", "favicon-32.png", "favicon-192.png", "apple-touch-icon.png"].map(name =>
      cp(join(here, "assets", name), join(outDir, name)),
    ),
  );
  return outDir;
}

if (import.meta.main) console.log(await build());
