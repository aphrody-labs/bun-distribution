import { m3Package } from "@aphrody/m3-config/bun-build";

export default m3Package({
  entry: [
    "src/index.ts",
    "src/transitions/index.ts",
    "src/adaptive/index.ts",
    "src/video/index.ts",
    "src/state/index.ts",
    "src/adapters/tanstack.ts",
    "src/data/index.ts",
    "src/wrappers/*.ts",
  ],
});
