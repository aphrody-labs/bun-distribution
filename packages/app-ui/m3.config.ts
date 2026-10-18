// SPDX-License-Identifier: Apache-2.0
// The Bun OS web app: `m3 dev` serves it, `bun build.ts` writes the static site to dist/.
import { defineM3Config } from "@aphrody/m3/config";

import { appServerProxy } from "./backend";

export default defineM3Config({
  proxy: appServerProxy(),
  entry: "src/index.html",
  port: 1420,
  drop: ["debugger"],
  optimizeImports: [
    "@phosphor-icons/react",
    "@tanstack/react-query",
    "@tanstack/react-table",
    "@tanstack/react-virtual",
  ],
});
