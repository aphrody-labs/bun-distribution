// SPDX-License-Identifier: Apache-2.0
import { m3Tsup } from "@aphrody/m3-config/tsup";

export default m3Tsup({
  entry: ["src/index.ts","src/react.tsx","src/tauri.tsx"],
  useClient: ["react.js", "tauri.js"],
});
