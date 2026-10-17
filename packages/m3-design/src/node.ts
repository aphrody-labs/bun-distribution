// SPDX-License-Identifier: Apache-2.0
//! Node/Bun filesystem design-system loader. Import only from server-side code;
//! the package index and browser bundles must not reach this module.

import { existsSync, readFileSync } from "node:fs";
import type { DesignSystemLoader } from "./types.ts";

/** Resolves `design-systems/<id>/tokens.css` shipped with the package. */
export const loadDesignSystemFromDisk: DesignSystemLoader = id => {
  // Reject path traversal: ids are directory names, never paths.
  if (!/^[\w.-]+$/.test(id) || id.startsWith(".")) return undefined;
  const path = new URL(`../design-systems/${id}/tokens.css`, import.meta.url);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
};
