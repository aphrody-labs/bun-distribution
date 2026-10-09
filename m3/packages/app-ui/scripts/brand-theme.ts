// SPDX-License-Identifier: Apache-2.0
//! Regenerate src/brand.css: the Aphrody brand M3 colour roles.
//
// The seed is the Aphrody pet sock mauve (PET_COLORS.seed in @aphrody/identity);
// the roles come from @aphrody/m3-tokens (Material Color
// Utilities, tonal spot) and the springs from @aphrody/m3-tokens/m3-tokens.css.
// The app is dark by default and toggles `.dark` / `.light` on <html>, so the
// dark roles land on `:root, .dark`.
//
//   bun run brand                 # seed #8c6c88
//   bun run brand -- '#8c6c88'    # explicit seed

import { join } from "node:path";
import {
  nativeThemeVariant,
  parseNativeThemeExport,
  type NativeSchemeVariant,
} from "@aphrody/m3-tokens/native-theme";
import type { SchemeVariant } from "@aphrody/m3-tokens/dynamic-color";
import { BRAND_SEED, brandCss } from "../src/brand-theme";

const args = process.argv.slice(2);
const explicitSeed = args[0] && !args[0].startsWith("--") ? args.shift() : undefined;
const flags: Record<string, string> = {};
for (let index = 0; index < args.length; index++) {
  const flag = args[index]!;
  if (!["--variant", "--contrast", "--native-theme", "--high-contrast-theme"].includes(flag))
    throw new Error(`Unknown brand theme option: ${flag}`);
  const value = args[++index];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  flags[flag] = value;
}
const nativeTheme = flags["--native-theme"]
  ? parseNativeThemeExport(await Bun.file(flags["--native-theme"]).json())
  : undefined;
const highContrastTheme = flags["--high-contrast-theme"]
  ? parseNativeThemeExport(await Bun.file(flags["--high-contrast-theme"]).json())
  : undefined;
const seed = explicitSeed ?? nativeTheme?.seed ?? BRAND_SEED;
const tokensCss = await Bun.file(
  Bun.fileURLToPath(import.meta.resolve("@aphrody/m3-tokens/m3-tokens.css")),
).text();
const target = join(import.meta.dir, "..", "src", "brand.css");
await Bun.write(
  target,
  brandCss(tokensCss, seed, {
    variant: (flags["--variant"] ?? (nativeTheme && nativeThemeVariant(nativeTheme))) as
      | SchemeVariant
      | NativeSchemeVariant
      | undefined,
    contrastLevel: flags["--contrast"] === undefined ? undefined : Number(flags["--contrast"]),
    nativeTheme,
    highContrastTheme,
  }),
);
console.log(`wrote src/brand.css from seed ${seed}`);
