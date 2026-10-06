#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Build the creator.aphrody.com page from the Aphrody M3 sources: static tokens (m3-tokens.css), the colour scheme
 * generated from the logo seed by m3-tokens (material-color-utilities), the Google Sans Flex brand face of m3-fonts.
 * Output: apps/web/creator/dist (build output, not versioned).
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { cssFromSeed } from "../../../m3/packages/m3-tokens/src/dynamic-color.ts";

const here = import.meta.dir;
const m3 = join(here, "../../../m3/packages");
/** Source colour of the logo (QuantizerCelebi + Score of material-color-utilities on assets/icon-256.png). */
export const SEED = "#951ae2";

export async function build(outDir = join(here, "dist")): Promise<string> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "fonts"), { recursive: true });
  const tokens = await Bun.file(join(m3, "m3-tokens/src/m3-tokens.css")).text();
  const scheme = cssFromSeed(SEED, { variant: "fidelity" });
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
    join(m3, "m3-fonts/fonts/web/GoogleSansFlex-latin.woff2"),
    join(outDir, "fonts/GoogleSansFlex-latin.woff2"),
  );
  for (const name of ["index.html", "page.css", "app.js"])
    await cp(join(here, "src", name), join(outDir, name));
  for (const name of ["logo.webp", "favicon-32.png", "favicon-192.png", "apple-touch-icon.png"]) {
    await cp(join(here, "assets", name), join(outDir, name));
  }
  return outDir;
}

if (import.meta.main) console.log(await build());
