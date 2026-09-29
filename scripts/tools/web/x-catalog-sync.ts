#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Sync the shared Rust X GraphQL catalog from live bundles. */
import {
  DEFAULT_CATALOG_PATH,
  syncCatalogFromBundles,
} from "../../../packages/web/x/src/tools/bundle-catalog.ts";

function pathArg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
  return value;
}

const rustCatalog = pathArg("--rust-catalog-path", DEFAULT_CATALOG_PATH);
const catalogPath = pathArg("--catalog-path", rustCatalog);
const report = await syncCatalogFromBundles({
  catalogPath,
  ...(catalogPath !== rustCatalog ? { rustCatalogPath: rustCatalog } : {}),
});
console.log(JSON.stringify(report, null, 2));
