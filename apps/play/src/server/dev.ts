// SPDX-License-Identifier: Apache-2.0
/**
 * Development entry: `bun --hot src/server/dev.ts`. Bun.serve serves the client through HTML
 * imports (bundled on demand with the M3 plugin from bunfig.toml) and the same API; no NGINX.
 */
import index from "../client/index.html";
import { createServer } from "./app";

const server = createServer({
  development: true,
  staticRoutes: {
    "/": index,
    "/library": index,
    "/steam": index,
    "/stream": index,
    "/play/*": index,
    "/engine": index,
  },
});
console.log(`[play] dev ${server.url}`);
