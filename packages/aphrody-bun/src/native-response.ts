// SPDX-License-Identifier: Apache-2.0
import { CString, type Pointer } from "bun:ffi";

/** Validate before loading native code: C strings cannot carry embedded NULs. */
export function cString(value: string): Uint8Array {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Expected a string without NUL bytes");
  }
  return new TextEncoder().encode(`${value}\0`);
}

/** Decode one owned JSON response and always invoke its original destructor. */
export function ownedJson(
  pointer: Pointer | bigint | null,
  free: (pointer: Pointer | bigint) => void,
  name: string,
): unknown {
  if (!pointer) throw new Error(`${name} returned a null pointer`);
  try {
    return JSON.parse(new CString(pointer).toString()) as unknown;
  } finally {
    free(pointer);
  }
}

export function envelope(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name}: invalid native response`);
  }
  const result = value as Record<string, unknown>;
  if (result.ok !== true) {
    throw new Error(
      `${name}: ${typeof result.error === "string" ? result.error : "native operation failed"}`,
    );
  }
  return result;
}
