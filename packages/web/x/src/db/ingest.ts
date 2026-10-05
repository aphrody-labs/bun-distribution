// SPDX-License-Identifier: Apache-2.0

import type { Store } from "./store";

/** Walk a payload for `user_results.result` nodes and upsert each distinct user; returns how many. */
export function findAndUpsertUsers(root: unknown, store: Store): number {
  return store.ingestUsers(root);
}
