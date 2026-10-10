// SPDX-License-Identifier: Apache-2.0
//
// Synchronous calls of the native operations that need no network: parsers, catalog, ranking,
// store. `client` is 0 for the ones that need no session. Every implementation lives in
// aphrody-x (crates/web/x/src/ops.rs); this file only marshals. The native library is opened on
// the first call, never on import.

import { xCall } from "@aphrody/bun/x";
import { xErrorFromInfo } from "./error";

/** Run a local native operation and return its data, or throw its failure as an `XError`. */
export function local<T = unknown>(op: string, args: Record<string, unknown> = {}, client = 0): T {
  const envelope = xCall<T>(client, op, args);
  if (!envelope.ok) throw xErrorFromInfo(envelope.error);
  return envelope.data;
}

/** Drop the undefined entries of an argument object (JSON would drop them anyway; this is explicit). */
export function defined(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
}
