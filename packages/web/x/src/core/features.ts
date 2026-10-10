// SPDX-License-Identifier: Apache-2.0
//
// The GraphQL feature switches of an operation. The table (about 150 flags and the known-good
// CreateTweet set) lives in aphrody-x (crates/web/x/src/features.rs); this returns what the native
// operation `features_for` computes for one catalog operation.

import type { Operation } from "../config/catalog";
import { local } from "./local";

export type FeatureFlags = Record<string, boolean | number | string>;

/** The features X expects for an operation: its declared switches over the shared defaults. */
export function featuresFor(op: Operation | string): FeatureFlags {
  return local<FeatureFlags>("features_for", { operation: typeof op === "string" ? op : op.name });
}
