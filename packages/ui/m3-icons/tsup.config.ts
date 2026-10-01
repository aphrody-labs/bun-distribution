// SPDX-License-Identifier: Apache-2.0
import { m3Tsup } from "@aphrody/m3-config/tsup";

export default m3Tsup({
  entry: [
    "src/index.ts",
    "src/browser.tsx",
    "src/browser-lit.ts",
    "src/plugin.ts",
    "src/codegen.ts",
  ],
});
