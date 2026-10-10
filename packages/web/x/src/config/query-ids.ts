// SPDX-License-Identifier: Apache-2.0
//
// The queryId cache of the X client, owned by Rust (crates/web/x/src/runtime_query_ids.rs): a
// disk snapshot refreshed from the live responsive-web bundles, merged (a refresh of one operation
// never drops the others) and coalesced across concurrent callers. This class reads and refreshes
// the cache of one client through the native operations `query_ids_*`.

import type { XClient } from "../core/client";
import { local } from "../core/local";

export interface QueryIdSnapshot {
  fetched_at: number;
  ttl_secs: number;
  ids: Record<string, string>;
  bundles: string[];
  /** Where the snapshot lives on disk. */
  cache_path?: string;
  /** Whether it is younger than its TTL. */
  fresh?: boolean;
  age_secs?: number;
  count?: number;
}

export class QueryIdStore {
  constructor(private readonly client: XClient) {}

  /** The cached queryId of an operation, if the cache knows it. */
  public get(operation: string): string | undefined {
    return local<string | null>("query_ids_get", { operation }, this.client.id) ?? undefined;
  }

  /** The cached snapshot (empty when nothing was fetched yet). */
  public snapshot(): QueryIdSnapshot | null {
    return local<QueryIdSnapshot | null>("query_ids_snapshot", {}, this.client.id);
  }

  public isFresh(snap: QueryIdSnapshot): boolean {
    if (snap.fresh !== undefined) return snap.fresh;
    const age = Math.floor(Date.now() / 1000) - snap.fetched_at;
    return age >= 0 && age <= snap.ttl_secs;
  }

  /** Re-read the live bundles for `targets` (every catalog operation when empty) and persist. */
  public refresh(targets: string[] = [], force = false): Promise<QueryIdSnapshot> {
    return this.client.call("query_ids_refresh", {
      operations: targets.length > 0 ? targets : undefined,
      force,
    });
  }
}
