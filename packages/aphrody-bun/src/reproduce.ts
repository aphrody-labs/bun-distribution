// SPDX-License-Identifier: Apache-2.0

import { CString } from "bun:ffi";
import { nativeSymbols as lib } from "./library";

/** Where a {@link ReproductionPlan} came from. */
export type ReproductionSource =
  | { kind: "image"; byteLen: number }
  | { kind: "url"; url: string }
  | { kind: "html" };

/** A seed color and dynamic-scheme choice, with the rendered CSS token sheet. */
export interface ThemePlan {
  seedArgb: number;
  seedHex: string;
  variant: string;
  dark: boolean;
  contrast: number;
  rationale: string;
  tokensCss: string;
}

/** A node in the reproduced (flat, document-order) component tree. */
export interface ComponentNode {
  component: string;
  sourceHint: string;
  text: string | null;
  children: ComponentNode[];
}

/** An asset the reproduction references. */
export interface AssetRef {
  url: string;
  role: string;
}

/** The full plan `crates/aphrody-m3-reproduce` produces: theme, fonts, shape, component tree and
 *  assets. Mirrors `aphrody_m3_reproduce::ReproductionPlan`. */
export interface ReproductionPlan {
  source: ReproductionSource;
  theme: ThemePlan;
  fontStacks: string[];
  cornerRadiusDp: number | null;
  components: ComponentNode[];
  assets: AssetRef[];
}

interface Envelope {
  ok: boolean;
  plan?: ReproductionPlan;
  error?: string;
}

function callReproduce(kind: 0 | 1 | 2, input: Uint8Array): ReproductionPlan {
  const rawPtr = lib.bun_rs_m3_reproduce(
    kind,
    input.length > 0 ? input : null,
    input.length,
  );
  if (!rawPtr) throw new Error("bun_rs_m3_reproduce returned a null pointer");
  let envelope: Envelope;
  try {
    envelope = JSON.parse(new CString(rawPtr).toString()) as Envelope;
  } finally {
    lib.bun_rs_free_string(rawPtr);
  }
  if (!envelope.ok || !envelope.plan)
    throw new Error(`m3Reproduce: ${envelope.error ?? "unknown error"}`);
  return envelope.plan;
}

/** Reproduces a site in M3 from a URL (fetched and crawled), a PNG/JPEG screenshot, or
 *  already-fetched HTML. Exactly one of `url`, `image` or `html` must be set. */
export function m3Reproduce(
  opts:
    { url: string } | { image: Uint8Array | ArrayBuffer } | { html: string },
): ReproductionPlan {
  if ("url" in opts) {
    return callReproduce(0, new TextEncoder().encode(opts.url));
  }
  if ("image" in opts) {
    const bytes =
      opts.image instanceof ArrayBuffer
        ? new Uint8Array(opts.image)
        : opts.image;
    return callReproduce(1, bytes);
  }
  return callReproduce(2, new TextEncoder().encode(opts.html));
}

/** The color most suitable for a UI theme (`sourceColorFromImage`-equivalent) from PNG/JPEG
 *  bytes, as opaque ARGB (`0xAARRGGBB`). Falls back to Google Blue (`0xFF4285F4`, the reference's
 *  own fallback) on decode failure rather than throwing. */
export function m3SeedFromImage(image: Uint8Array | ArrayBuffer): number {
  const bytes = image instanceof ArrayBuffer ? new Uint8Array(image) : image;
  if (bytes.length === 0) return 0xff4285f4;
  return lib.bun_rs_m3_seed_from_image(bytes, bytes.length);
}
