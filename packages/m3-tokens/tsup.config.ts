// SPDX-License-Identifier: Apache-2.0
// Self-contained build: settings mirror the preset without React.
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/theme-to-tokens.ts", "src/dynamic-color.ts", "src/breakpoints.ts", "src/platform-contract.ts"],
  format: ["esm"],
  target: "es2022",
  platform: "neutral",
  outDir: "dist",
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  external: [/^@aphrody\//, /^@material\//],
});
