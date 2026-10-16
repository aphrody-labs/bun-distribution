#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// App UI output adapter for the canonical product inventory collector.
import { join } from "node:path";
import { collect, ROOT } from "../../../../apps/m3-showcase/scripts/inventory.ts";

export { collect, ROOT };
export type { InventoryEntry } from "../../../../apps/m3-showcase/scripts/inventory.ts";
export const OUT = join(import.meta.dir, "../../src/material/generated/inventory.json");

if (import.meta.main) {
  const entries = collect();
  await Bun.write(OUT, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`inventory: ${entries.length} packages and apps -> ${OUT}`);
}
