import { m3Package } from "@aphrody/m3-config/bun-build";

export default m3Package({
  entry: [
    "index.ts",
    "transitions/index.ts",
    "adaptive/index.ts",
    "state/index.ts",
    "adapters/tanstack.ts",
    "data/index.ts",
    "wrappers/*.ts",
  ],
});
