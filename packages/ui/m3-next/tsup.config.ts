// SPDX-License-Identifier: Apache-2.0
import { m3Tsup } from "@aphrody/m3-config/tsup";

// Three entries with three runtimes: `index` (config, metadata and scheme helpers, safe anywhere),
// `server` (React Server Components, node:fs, next/headers) and `client` (the 'use client'
// boundary). No code splitting: server.js reaches client.js through the package name
// (`@aphrody/m3-next/client`, external), so the client directive stays on a module of its own.
export default m3Tsup({
  entry: ["src/index.ts", "src/server.tsx", "src/client.tsx"],
  platform: "node",
  splitting: false,
  useClient: ["client.js"],
  external: [/^next($|\/)/, /^node:/],
});
