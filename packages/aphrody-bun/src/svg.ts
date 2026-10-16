// SPDX-License-Identifier: Apache-2.0

import { CString } from "bun:ffi";
import { nativeSymbols as lib } from "./library";

export interface SvgRequest {
  op:
    | "sanitize"
    | "geometry"
    | "normalize"
    | "theme"
    | "sprite"
    | "optimize"
    | "render"
    | "ico"
    | "diff"
    | "glyph";
  [key: string]: unknown;
}

/** Dispatch an aphrody-svg JSON request and return its operation-specific JSON value. */
export function svg(request: SvgRequest): unknown {
  if (
    request === null ||
    typeof request !== "object" ||
    typeof request.op !== "string"
  ) {
    throw new TypeError("svg request must be an object with an operation name");
  }
  const input = Buffer.from(JSON.stringify(request));
  const ptr = lib.bun_rs_svg(input, input.length);
  if (!ptr) throw new Error("bun_rs_svg returned a null pointer");

  let envelope: { ok: boolean; value?: unknown; error?: string };
  try {
    envelope = JSON.parse(new CString(ptr).toString()) as typeof envelope;
  } finally {
    lib.bun_rs_free_string(ptr);
  }
  if (envelope.ok !== true)
    throw new Error(`svg: ${envelope.error ?? "native operation failed"}`);
  if (!("value" in envelope))
    throw new Error("svg: native response omitted its value");
  return envelope.value;
}
