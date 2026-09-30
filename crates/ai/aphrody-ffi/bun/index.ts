// SPDX-License-Identifier: Apache-2.0
// Compatibility entry point; package bindings own the implementation.
export * from "../../../../packages/bun/aphrody/src/engine";

import { CString } from "bun:ffi";
import { loadLib } from "../../../../packages/bun/aphrody/src/engine";

/** The last native boundary error on this thread; Aphrody and Shenron share it. */
export function shenronLastError(): string | null {
  const ptr = loadLib().symbols.aphrody_last_error();
  if (!ptr) return null;
  const text = new CString(ptr).toString();
  return text.length > 0 ? text : null;
}
