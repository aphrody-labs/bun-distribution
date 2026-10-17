import { m3Package } from "@aphrody/m3-config/bun-build";

export default m3Package({
  entry: ["src/index.ts", "src/browser.tsx", "src/browser-lit.ts", "src/plugin.ts", "src/codegen.ts"],
});
