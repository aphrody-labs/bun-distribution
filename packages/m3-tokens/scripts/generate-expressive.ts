// SPDX-License-Identifier: Apache-2.0
// Writes src/expressive.css from src/expressive.ts.
import { expressiveCss } from "../src/expressive.ts";

await Bun.write(
  new URL("../src/expressive.css", import.meta.url),
  expressiveCss(),
);
