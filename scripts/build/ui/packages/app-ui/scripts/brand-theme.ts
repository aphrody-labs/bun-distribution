// SPDX-License-Identifier: Apache-2.0
//! Regenerate src/brand.css: the Aphrody brand M3 colour roles.
//
// The seed is the one `aphrody-identity` derives from its measured palette
// (`design --m3-seed`); the roles come from @aphrody/m3-tokens (Material Color
// Utilities, tonal spot). The app is dark by default and toggles `.dark` /
// `.light` on <html>, so the dark roles land on `:root, .dark`.
//
//   bun run brand                 # seed from aphrody-identity (cargo)
//   bun run brand -- '#17335C'    # explicit seed, no cargo

import { join } from "node:path";
import { brandCss } from "../../../../../../design/aphrody-m3/packages/app-ui/src/brand-theme";

const repo = join(import.meta.dir, "..", "..", "..");

async function identitySeed(): Promise<string> {
  const proc = Bun.spawn(
    ["cargo", "run", "-q", "-p", "aphrody-identity", "--bin", "design", "--", "--m3-seed"],
    { cwd: repo, stdout: "pipe", stderr: "inherit" },
  );
  const out = (await new Response(proc.stdout).text()).trim();
  if ((await proc.exited) !== 0) throw new Error("aphrody-identity design --m3-seed failed");
  return out;
}

const seed = process.argv[2] ?? (await identitySeed());
const target = join(import.meta.dir, "..", "src", "brand.css");
await Bun.write(target, brandCss(seed));
console.log(`wrote src/brand.css from seed ${seed}`);
