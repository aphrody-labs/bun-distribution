// SPDX-License-Identifier: Apache-2.0
//! Regenerate src/brand.css: the Aphrody brand M3 colour roles.
//
// The seed is the Gemini brand blue (GEMINI_BLUE in crates/ui/m3-tokens/src/
// gemini_brand.rs); the roles come from @aphrody/m3-tokens (Material Color
// Utilities, tonal spot) and the springs from @aphrody/m3-tokens/m3-tokens.css.
// The app is dark by default and toggles `.dark` / `.light` on <html>, so the
// dark roles land on `:root, .dark`.
//
//   bun run brand                 # seed #3186ff
//   bun run brand -- '#3186ff'    # explicit seed

import { join } from "node:path";
import { BRAND_SEED, brandCss } from "../src/brand-theme";

const seed = process.argv[2] ?? BRAND_SEED;
const tokensCss = await Bun.file(Bun.fileURLToPath(import.meta.resolve("@aphrody/m3-tokens/m3-tokens.css"))).text();
const target = join(import.meta.dir, "..", "src", "brand.css");
await Bun.write(target, brandCss(tokensCss, seed));
console.log(`wrote src/brand.css from seed ${seed}`);
