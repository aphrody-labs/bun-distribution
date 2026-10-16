// SPDX-License-Identifier: Apache-2.0
import { m3Package } from "@aphrody/m3-config/bun-build";

// Four entries with four runtimes: `index` (config, metadata and scheme helpers, safe anywhere),
// `server` (React Server Components, node:fs, next/headers), `client` (the 'use client'
// boundary) and `theme-proxy` (the proxy.ts helper, next/server only; its file is not named proxy.ts because Next scans for that name). No code splitting: server.js reaches client.js through the package name
// (`@aphrody/m3-next/client`, external), so the client directive stays on a module of its own.
export default m3Package({
  entry: [
    "src/index.ts",
    "src/server.tsx",
    "src/client.tsx",
    "src/theme-proxy.ts",
  ],
  target: "node",
  splitting: false,
  useClient: ["client.js"],
  external: ["next", "next/*", "node:*"],
});
