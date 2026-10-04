// SPDX-License-Identifier: Apache-2.0
import { m3Tsup } from "@aphrody/m3-config/tsup";

export default m3Tsup({
  entry: ["index.ts","transitions/index.ts","adaptive/index.ts","state/index.ts","adapters/tanstack.ts","wrappers/*.ts"],
});
