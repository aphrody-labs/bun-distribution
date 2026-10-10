// SPDX-License-Identifier: Apache-2.0
//! Regenerate src/brand.css: the Aphrody brand M3 colour roles.
//
// The roles are the Rust ThemeExport (aphrody_m3_tokens::theme) of the pet seed
// (PET_COLORS.seed in @aphrody/identity) at contrast 0 and 1, committed as
// src/generated/brand-theme{,-high-contrast}.json; the springs come from
// @aphrody/m3-tokens/m3-tokens.css. The app is dark by default and toggles
// `.dark` / `.light` on <html>, so the dark roles land on `:root, .dark`.
//
//   bun run brand
//   bun run brand -- --native-theme a.json --high-contrast-theme b.json

import { join } from "node:path";
import { parseNativeThemeExport } from "@aphrody/m3-tokens/native-theme";
import { BRAND_THEME_REGENERATE, brandCss } from "../src/brand-theme";

const generated = join(import.meta.dir, "..", "src", "generated");
const flags: Record<string, string> = {
  "--native-theme": join(generated, "brand-theme.json"),
  "--high-contrast-theme": join(generated, "brand-theme-high-contrast.json"),
};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const flag = args[index]!;
  if (!Object.hasOwn(flags, flag)) throw new Error(`Unknown brand theme option: ${flag}`);
  const value = args[++index];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  flags[flag] = value;
}

async function readExport(path: string) {
  const file = Bun.file(path);
  if (!(await file.exists()))
    throw new Error(
      `Missing Rust theme export ${path}; regenerate with: ${BRAND_THEME_REGENERATE}`,
    );
  return parseNativeThemeExport(await file.json());
}

const nativeTheme = await readExport(flags["--native-theme"]!);
const highContrastTheme = await readExport(flags["--high-contrast-theme"]!);
const tokensCss = await Bun.file(
  Bun.fileURLToPath(import.meta.resolve("@aphrody/m3-tokens/m3-tokens.css")),
).text();
await Bun.write(
  join(import.meta.dir, "..", "src", "brand.css"),
  brandCss(tokensCss, { nativeTheme, highContrastTheme }),
);
console.log(`wrote src/brand.css from the Rust export of ${nativeTheme.seed}`);
