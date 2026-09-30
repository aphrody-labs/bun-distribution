// SPDX-License-Identifier: Apache-2.0
// Same app without the generated theme sheet: exercises the CLI without the native bun_rs library.
import { defineM3Config } from "../../../src/config.ts";

export default defineM3Config({
  entry: "plain.html",
  root: "../../../../../..",
});
