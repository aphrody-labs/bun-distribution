#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Sync the TypeScript and shared Rust X GraphQL catalogs from live bundles. */
import { join } from "node:path";
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

const rustCatalog = pathArg(
  "--rust-catalog-path",
  join(import.meta.dir, "../../../crates/web/aphrody-x/data/x-graphql-catalog.json"),
);
const catalogPath = pathArg("--catalog-path", DEFAULT_CATALOG_PATH);
const report = await syncCatalogFromBundles({ catalogPath, rustCatalogPath: rustCatalog });
console.log(JSON.stringify(report, null, 2));
