// SPDX-License-Identifier: Apache-2.0
//
// Extraction of GraphQL operation descriptors from the X responsive-web bundles and the sync of the
// shared catalog (crates/web/x/data/x-graphql-catalog.json). Discovery, extraction and the catalog
// merge are aphrody-x (crates/web/x/src/runtime_query_ids.rs, catalog_sync.rs); this file keeps the
// public names over the native operations.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { xSubmit } from "@aphrody/bun/x";
import { xErrorFromInfo } from "../core/error";
import { local } from "../core/local";

export interface BundleOperation {
  queryId: string;
  operationName: string;
  operationType: "query" | "mutation" | "subscription";
}

export interface CatalogFile {
  extracted_from?: string;
  operation_count?: number;
  operations: Record<string, { queryId: string; operationType: string; featureSwitches: string[] }>;
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
export const DEFAULT_CATALOG_PATH = join(REPO_ROOT, "crates/web/x/data/x-graphql-catalog.json");

/** Run a network operation that needs no session as a native job. */
async function open<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const envelope = await xSubmit<T>(0, op, args);
  if (!envelope.ok) throw xErrorFromInfo(envelope.error);
  return envelope.data;
}

/** Discover the client-web bundle URLs from the public X pages. */
export function discoverBundleUrls(): Promise<string[]> {
  return open<string[]>("bundles_discover");
}

/** Parse all `{queryId, operationName}` pairs from bundle JS. */
export function extractAllOperationsFromJs(js: string): Map<string, string> {
  return new Map(Object.entries(local<Record<string, string>>("bundle_extract", { js })));
}

/** Fetch the live bundles and return the operation to queryId map (restricted to `targets`). */
export function fetchLiveQueryIds(
  targets?: string[],
): Promise<{ ids: Record<string, string>; bundles: string[] }> {
  return open("query_ids_live", targets ? { operations: targets } : {});
}

/** Full sync: scrape the bundles and update the shared catalog file in place. */
export function syncCatalogFromBundles(opts?: {
  catalogPath?: string;
}): Promise<Record<string, unknown>> {
  return open("catalog_sync", { path: opts?.catalogPath ?? DEFAULT_CATALOG_PATH });
}
