// SPDX-License-Identifier: Apache-2.0

import { CString } from "bun:ffi";
import { nativeSymbols as lib } from "./library";

/** Material Symbols style: the three variable fonts embedded by the `icons` module of `aphrody-bun`. */
export type M3IconStyle = "outlined" | "rounded" | "sharp";

export interface M3IconOptions {
  /** Icon name, e.g. `"home"`, `"favorite"` (see `m3IconNames`). */
  name: string;
  /** Defaults to `"outlined"`. */
  style?: M3IconStyle;
  /** `FILL` axis, `0..1`. Defaults to `0`. */
  fill?: number;
  /** `wght` axis, `100..700`. Defaults to `400`. */
  weight?: number;
  /** `GRAD` axis, `-25..200`. Defaults to `0`. */
  grade?: number;
  /** `opsz` axis, `20..48`. Defaults to `24`. */
  opticalSize?: number;
  /** `width`/`height` in CSS pixels. Defaults to `24`. */
  size?: number;
}

interface IconEnvelope {
  ok: boolean;
  svg?: string;
  names?: string[];
  error?: string;
}

function callJson(
  symbol: (ptr: Buffer, len: number) => number | bigint | null,
  payload: string,
): IconEnvelope {
  const buf = Buffer.from(payload);
  const ptr = symbol(buf, buf.length);
  if (!ptr)
    throw new Error("aphrody-bun icons FFI call returned a null pointer");
  let envelope: IconEnvelope;
  try {
    envelope = JSON.parse(new CString(ptr as any).toString()) as IconEnvelope;
  } finally {
    lib.bun_rs_free_string(ptr as any);
  }
  if (typeof envelope.ok !== "boolean")
    throw new Error("aphrody-bun icons returned an invalid response");
  return envelope;
}

/**
 * Renders a Material Symbols icon as a standalone SVG document string, generated from the
 * variable font outlines by the `icons` module of `aphrody-bun` (no icon font shipped or loaded by the caller).
 */
export function m3Icon(options: M3IconOptions): string {
  const envelope = callJson(
    lib.bun_rs_icon_svg as any,
    JSON.stringify(options),
  );
  if (!envelope.ok) throw new Error(`m3Icon: ${envelope.error}`);
  if (typeof envelope.svg !== "string")
    throw new Error("m3Icon: native response omitted SVG");
  return envelope.svg;
}

/** Lists every known Material Symbols icon name for `style` (defaults to `"outlined"`). */
export function m3IconNames(style: M3IconStyle = "outlined"): string[] {
  const envelope = callJson(lib.bun_rs_icon_names as any, style);
  if (!envelope.ok) throw new Error(`m3IconNames: ${envelope.error}`);
  if (
    !Array.isArray(envelope.names) ||
    envelope.names.some((name) => typeof name !== "string")
  ) {
    throw new Error("m3IconNames: native response omitted icon names");
  }
  return envelope.names;
}
