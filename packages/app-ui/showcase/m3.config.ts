import { defineM3Config } from "@aphrody/m3/config";
import { defineM3Bun } from "@aphrody/m3-bun/config";
import pkg from "../package.json";

export default defineM3Config({
  entry: "src/index.html",
  theme: { seed: "#8c6c88", variant: "tonalSpot" },
  port: 3300,
  tauri: { uiDist: "dist" },
});

// m3-bun: the API lives in src/api and is served next to the UI by the same Bun process; the deploy section only
// names the targets' inputs (nothing here is applied by any command).
export const bun = defineM3Bun({
  name: "m3-showcase",
  version: pkg.version,
  api: "src/api/index.ts",
  port: 3300,
  splitting: true,

  compile: {
    windows: {
      title: "Aphrody M3 Showcase",
      publisher: "Aphrody",
      description: "Every @aphrody/m3 package in one adaptive app",
      version: "3.3.3.0",
      copyright: "Apache-2.0",
    },
  },
  deploy: {
    domain: "m3-showcase.example.com",
    namespace: "aphrody",
    image: "ghcr.io/aphrody-labs/m3-showcase",
  },
});
