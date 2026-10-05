import { defineM3Config } from "@aphrody/m3/config";
import { defineM3Bun } from "../../../src/config.ts";

export default defineM3Config({
  entry: "src/index.html",
  theme: { seed: "#6750a4" },
});

export const bun = defineM3Bun({
  api: "src/api.ts",
  port: 3456,
  deploy: { domain: "hello.example.com", namespace: "aphrody" },
});
