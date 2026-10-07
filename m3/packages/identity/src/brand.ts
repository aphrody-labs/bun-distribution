// SPDX-License-Identifier: Apache-2.0
// Brand emblem of Aphrody (crates/ui/identity/assets/brand), inlined as `data:` URLs by the
// `?url` loader of the @aphrody/m3 plugin (`m3 dev`, `m3 build`). Import this entry only from
// an app bundled by @aphrody/m3; the pure pet logic lives in `@aphrody/identity/pet`.
import icon64 from "../assets/icon-64.png?url";
import icon128 from "../assets/icon-128.png?url";
import icon192 from "../assets/icon-192.png?url";

/** The emblem at 64, 128 and 192 px, for `srcSet` on high-DPI screens. */
export const BRAND_ICONS = { 64: icon64, 128: icon128, 192: icon192 } as const;

/** Smallest emblem URL that covers `px` CSS pixels at `dpr`. */
export function brandIcon(px: number, dpr = 1): string {
  const need = px * dpr;
  if (need <= 64) return icon64;
  if (need <= 128) return icon128;
  return icon192;
}

/** `srcSet` for an `<img>` of `px` CSS pixels (distinct URLs only). */
export function brandSrcSet(px: number): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const dpr of [1, 2, 3]) {
    const url = brandIcon(px, dpr);
    if (seen.has(url)) continue;
    seen.add(url);
    parts.push(`${url} ${dpr}x`);
  }
  return parts.join(", ");
}
