// SPDX-License-Identifier: Apache-2.0
import { m3Tsup } from "@aphrody/m3-config/tsup";

// One config: the Bun-side entries (plugin, server, build, config, CLI) and the browser entries
// (react, lit) only import externals, so a single `node` platform build serves both.
export default m3Tsup({
  entry: [
    "src/index.ts",
    "src/plugin.ts",
    "src/server.ts",
    "src/build.ts",
    "src/config.ts",
    "src/cli.ts",
    "src/react.tsx",
    "src/lit.ts",
  ],
  platform: "node",
  useClient: ["react.js"],
  external: [/^bun(:|$)/, "@tailwindcss/node", "@tailwindcss/oxide"],
});
