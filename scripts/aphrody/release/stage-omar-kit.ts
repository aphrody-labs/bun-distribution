#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Compatibility command: build the complete Aphrody product, including its administrator module.
import { resolve } from "node:path";
import { stageSetup } from "./stage-setup.ts";
export { guideHtml } from "@aphrody/product/admin/guide";

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const at = args.indexOf("--out");
  await stageSetup(resolve(at >= 0 ? (args[at + 1] ?? "") : "packages/infra/product/dist"), args.includes("--smoke"));
}
