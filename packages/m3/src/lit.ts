// SPDX-License-Identifier: Apache-2.0
// Vanilla / Lit entry of @aphrody/m3. Importing it registers every Aphrody extension element of
// `@aphrody/material-web` (`aphrody-components`: snackbar, app bars, navigation rail, sheets,
// pickers, adaptive layout, charts, ...) as a side effect.
//
//   import { applyM3Theme, registerM3Components } from "@aphrody/m3/lit";
//   await registerM3Components({ core: true });   // also the upstream md-* catalog
//   applyM3Theme("#6750a4", { variant: "tonalSpot" });
// oxlint-disable-next-line import/no-unassigned-import -- Importing this public entry point registers the Aphrody custom elements.
import "@aphrody/material-web/aphrody-components.js";
import {
  applyDynamicFusionTheme,
  type ApplyDynamicFusionThemeOptions,
} from "@aphrody/m3-theme";

export interface RegisterM3ComponentsOptions {
  /** Also register the upstream `md-*` catalog (`@aphrody/material-web/all.js`). */
  core?: boolean;
}

/**
 * Register the element catalogs. The Aphrody extensions are already defined by importing this
 * module; `core` loads the upstream `md-*` elements on demand (a separate chunk).
 */
export async function registerM3Components(
  options: RegisterM3ComponentsOptions = {},
): Promise<void> {
  if (options.core) await import("@aphrody/material-web/all.js");
}

/** Resolve once every tag in `tags` is defined (`customElements.whenDefined`). */
export async function whenM3Defined(tags: readonly string[]): Promise<void> {
  await Promise.all(tags.map((tag) => customElements.whenDefined(tag)));
}

/**
 * Apply a dynamic Material You scheme from `seed` to `options.target` (default `<html>`):
 * `--md-sys-color-*`, the shadcn/Tailwind aliases, the `dark` class and `color-scheme`.
 */
export function applyM3Theme(
  seed: string,
  options: ApplyDynamicFusionThemeOptions = {},
): void {
  applyDynamicFusionTheme(seed, options);
}

export type { ApplyDynamicFusionThemeOptions };
