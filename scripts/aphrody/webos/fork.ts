// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Resolve the capability owner's source without copying its runtime into Aphrody. */
export function webosOwnerModule(
  relativePath: string,
  checkout = process.env.APHRODY_BUN_CHECKOUT,
): string {
  if (!checkout) throw new Error("Set APHRODY_BUN_CHECKOUT to the selected Bun fork checkout.");
  const path = resolve(checkout, "apps/desktop", relativePath);
  if (!existsSync(path)) throw new Error(`Configured Bun fork has no WebOS owner module: ${path}`);
  return pathToFileURL(path).href;
}
