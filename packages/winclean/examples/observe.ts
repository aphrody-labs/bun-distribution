#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// bun packages/winclean/examples/observe.ts — observe the foreground window.
import { Winclean } from "../src";

using wc = Winclean.open();
const obs = (await wc.computerObserve({ windowHandle: 0, maxElements: 40 })).ok();
const png = obs.images[0];
if (png) await Bun.write("foreground.png", png.bytes);
console.log(obs.text);
