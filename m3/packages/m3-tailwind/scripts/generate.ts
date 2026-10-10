// SPDX-License-Identifier: Apache-2.0
import { presetCss } from "../src/index.ts";

await Bun.write(new URL("../preset.css", import.meta.url), presetCss());
