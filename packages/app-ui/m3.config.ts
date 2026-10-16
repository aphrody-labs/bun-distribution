// SPDX-License-Identifier: Apache-2.0
// The Tauri webview of crates/ui/app.
//   m3 dev            -> http://localhost:1421 (tauri.conf.json build.devUrl)
//   m3 build --tauri  -> crates/ui/app/ui-dist (index.html, app.js, app.css, fonts/)
import { defineM3Config } from "@aphrody/m3/config";
import { productBuildContext } from "@aphrody/product/build-inputs";

import { appServerProxy } from "./backend";

export default defineM3Config({
  proxy: appServerProxy(),
  entry: "src/index.html",
  port: 1421,
  tauri: { uiDist: productBuildContext().uiDist },
  drop: ["debugger"],
  optimizeImports: [
    "@phosphor-icons/react",
    "@tanstack/react-query",
    "@tanstack/react-table",
    "@tanstack/react-virtual",
  ],
});
