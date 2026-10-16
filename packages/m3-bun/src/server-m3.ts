// SPDX-License-Identifier: Apache-2.0
// The route assembly of `@aphrody/m3/server` (proxy prefixes, `.html` pages, React pages of a `pagesDir`) reused for
// `startM3Server({ routes })`, so an m3-bun server serves the same routes as `serveM3` next to its build and API.
import type { M3SocketData } from "./server-realtime.ts";
import { loadOptional } from "./server-optional.ts";

type M3Server = typeof import("@aphrody/m3/server");

export interface M3ServerRoutesOptions {
  /** Proxy prefixes: `"/rpc" -> "http://localhost:8080"`. */
  proxy?: Record<string, string>;
  /** Directory of React `.tsx`/`.jsx` pages (`index.tsx` is `/`, `[id].tsx` is `/:id`). */
  pagesDir?: string;
  /** Extra routes; a string value is the path of an `.html` page (bundled by `Bun.serve`). */
  routes?: Record<string, Bun.Serve.Routes<undefined, string>[string] | string>;
  /** Base directory of relative paths (default: working directory). */
  cwd?: string;
}

/** `Bun.serve` routes of `@aphrody/m3/server`'s `buildRoutes`, for `startM3Server({ routes })`. */
export async function m3ServerRoutes(options: M3ServerRoutesOptions): Promise<Bun.Serve.Routes<M3SocketData, string>> {
  const server = await loadOptional<M3Server>("@aphrody/m3/server", "m3 server routes");
  const { proxy, pagesDir, routes, cwd } = options;
  return (await server.buildRoutes({ proxy, pagesDir, routes, cwd })) as Bun.Serve.Routes<M3SocketData, string>;
}
