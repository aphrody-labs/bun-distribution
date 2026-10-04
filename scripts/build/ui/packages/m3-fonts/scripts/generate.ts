// SPDX-License-Identifier: Apache-2.0
// Regenerates src/fonts.css, src/fonts-jp.css and src/fonts-symbols.css from the manifest.
import { join } from "node:path";
import { renderStylesheet, SHEET_FILES, type FontSheet } from "../../../../../../m3/packages/m3-fonts/src/index";

for (const [sheet, file] of Object.entries(SHEET_FILES) as [FontSheet, string][]) {
  const out = join(import.meta.dir, "..", "src", file);
  await Bun.write(out, renderStylesheet("../", sheet));
  console.log(out);
}
