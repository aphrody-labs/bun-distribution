// SPDX-License-Identifier: Apache-2.0
// `next/cache`: invalidation of prerendered routes. m3 has no fetch data cache; pages are either
// prerendered at build time or rendered per request, so revalidation drops prerendered output.
import { markDynamic, requestStorage } from "./runtime/store";

const KEY = Symbol.for("@aphrody/m3/app/revalidate");
type Revalidator = { paths: Set<string>; tags: Set<string>; listeners: Set<(path?: string, tag?: string) => void> };
const g = globalThis as typeof globalThis & { [KEY]?: Revalidator };
/** Shared with the host, which drops the prerendered output of revalidated paths. */
export const revalidator: Revalidator = (g[KEY] ??= { paths: new Set(), tags: new Set(), listeners: new Set() });

/** Re-render `path` on its next request (and refresh the current page after an action). */
export function revalidatePath(path: string, _type?: "page" | "layout"): void {
  const store = requestStorage.getStore();
  if (store) store.revalidated = true;
  revalidator.paths.add(path);
  for (const listener of revalidator.listeners) listener(path, undefined);
}

/** Re-render the prerendered routes; tags are not tracked per route, so every route is dropped. */
export function revalidateTag(tag: string): void {
  const store = requestStorage.getStore();
  if (store) store.revalidated = true;
  revalidator.tags.add(tag);
  for (const listener of revalidator.listeners) listener(undefined, tag);
}

/** Opt the current render out of prerendering. */
export function unstable_noStore(): void {
  if (requestStorage.getStore()) markDynamic("unstable_noStore()");
}
