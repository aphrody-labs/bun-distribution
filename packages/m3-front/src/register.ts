// SPDX-License-Identifier: Apache-2.0
// Lazy registration of the @aphrody/material-web element catalogs. Nothing is imported until asked,
// so the front layer stays SSR-safe and tree-shakable.

export type M3Catalog = "all" | "aphrody";

const CATALOGS: Record<M3Catalog, () => Promise<unknown>> = {
  all: () => import("@aphrody/material-web/all.js"),
  aphrody: () => import("@aphrody/material-web/aphrody-components.js"),
};

/** Load whole catalogs: `all` (upstream md-*) and `aphrody` (Aphrody extension elements). */
export async function registerM3(...catalogs: M3Catalog[]): Promise<void> {
  await Promise.all(catalogs.map((c) => CATALOGS[c]()));
}

/**
 * Load single components by material-web path, e.g. `"button/filled-button"` or `"switch/switch"`.
 * Only a-z, 0-9, `-` and one `/` are accepted.
 */
export async function registerM3Component(...paths: string[]): Promise<void> {
  await Promise.all(
    paths.map((p) => {
      if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(p)) throw new Error(`invalid component path "${p}"`);
      return import(/* @vite-ignore */ `@aphrody/material-web/${p}.js`);
    }),
  );
}

/** Resolve once every tag is defined. */
export async function whenDefined(tags: readonly string[]): Promise<void> {
  await Promise.all(tags.map((t) => customElements.whenDefined(t)));
}
