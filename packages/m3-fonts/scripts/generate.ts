// SPDX-License-Identifier: Apache-2.0
// Regenerates src/fonts.css, src/fonts-jp.css and src/fonts-symbols.css from the manifest.
import { join } from "node:path";
import { renderStylesheet, SHEET_FILES, type FontSheet } from "../src/index";

for (const [sheet, file] of Object.entries(SHEET_FILES) as [FontSheet, string][]) {
  const out = join(import.meta.dir, "..", "src", file);
  // oxlint-disable-next-line no-await-in-loop -- Write each of the three sheets before reporting its completed path.
  await Bun.write(out, renderStylesheet("../", sheet));
  console.log(out);
}
