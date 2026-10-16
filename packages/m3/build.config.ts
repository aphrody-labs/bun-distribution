import { m3Package } from "@aphrody/m3-config/bun-build";

export default m3Package({
  entry: [
    "src/index.ts",
    "src/plugin.ts",
    "src/server.ts",
    "src/build.ts",
    "src/config.ts",
    "src/cli.ts",
    "src/react.tsx",
    "src/lit.ts",
    "src/i18n.ts",
  ],
  target: "node",
  useClient: ["react.js"],
  external: ["bun", "bun:*", "@tailwindcss/node", "@tailwindcss/oxide"],
});
