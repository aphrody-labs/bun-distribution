// SPDX-License-Identifier: Apache-2.0
// Errors of the app's API in `m3-bun dev` go to Bun's own error overlay (the `bun-error` page that `Bun.serve` renders
// in development for an uncaught handler error, with the source-mapped stack). An API module that fails to load does
// not stop the dev server: its routes rethrow the load error, so the overlay shows it on every API request until the
// file is fixed.
import { pathToFileURL } from "node:url";
import type { M3ApiModule } from "./api.ts";

/** An API whose every route under `prefix` (default `/api`) rethrows `error`. */
export function failingApi(error: unknown, prefix = "/api"): M3ApiModule {
  const fail = (): never => {
    throw error;
  };
  const base = prefix.replace(/\/+$/, "");
  return { routes: { [base]: fail, [`${base}/*`]: fail } };
}

/** The default export of the API module at `path`, or a `failingApi` carrying its load error. */
export async function loadDevApi(path: string): Promise<M3ApiModule> {
  try {
    const module = (await import(pathToFileURL(path).href)) as { default?: M3ApiModule };
    return module.default ?? {};
  } catch (error) {
    return failingApi(error);
  }
}
