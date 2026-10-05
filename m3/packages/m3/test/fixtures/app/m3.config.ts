// SPDX-License-Identifier: Apache-2.0
import { defineM3Config } from "../../../src/config.ts";

export default defineM3Config({
  entry: "index.html",
  outdir: "dist",
  port: 0,
  proxy: { "/rpc": "http://127.0.0.1:9" },
  tauri: { uiDist: "ui-dist" },
  theme: { seed: "#336699", variant: "vibrant", contrast: 0.5 },
});
