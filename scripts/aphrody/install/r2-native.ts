#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";
import { defaultContext } from "@aphrody/product/admin/context";
import { r2Plan, stageR2 } from "@aphrody/product/setup/r2";

const args = process.argv.slice(2);
if (args.some((arg) => !["--stage", "--help"].includes(arg)))
  throw new Error("Usage: bun scripts/install/r2-native.ts [--stage]");
if (args.includes("--help")) {
  console.log(
    "Native Windows Bun + Aphrody R2 installer staging. Default: manifest/checksum plan. --stage: verify archives, extract allowlisted binaries, qualify --version/--help and create multicall aliases. Installed PATH binaries are preserved.",
  );
} else {
  const ctx = defaultContext();
  const plans = await Promise.all([
    r2Plan("bun", ctx.fetchImpl),
    r2Plan("aphrody", ctx.fetchImpl),
  ]);
  if (!args.includes("--stage"))
    console.log(
      JSON.stringify(
        {
          plans,
          activation:
            "Not applied; stage verified artifacts before selecting a PATH activation target",
        },
        null,
        2,
      ),
    );
  else {
    const root = join(ctx.paths.localAppData, "Aphrody", "Native", "verified");
    const staged = [];
    for (const plan of plans) {
      // Each archive is qualified before starting the next product.
      // eslint-disable-next-line no-await-in-loop
      staged.push(await stageR2(ctx, plan, root));
    }
    console.log(
      JSON.stringify(
        {
          staged,
          activation: "Verified stage ready; existing PATH binaries preserved",
        },
        null,
        2,
      ),
    );
  }
}
