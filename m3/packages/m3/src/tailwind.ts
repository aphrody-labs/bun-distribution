// SPDX-License-Identifier: Apache-2.0
// Tailwind v4 for M3 applications comes from `@aphrody/bun-plugin-tailwind` (the
// fork of Bun publishes it): CSS roots compiled by `@tailwindcss/node`,
// candidates from the Oxide scanner and from every module of the build, and
// recompilation when a stylesheet, plugin or config changes. The M3 sheets
// themselves are the `m3:*` modules of `m3Plugin`.
import { tailwind, type BunTailwindOptions } from "@aphrody/bun-plugin-tailwind";
import type { BunPlugin } from "bun";

export type { BunTailwindOptions };

export function tailwindM3Plugin(options: BunTailwindOptions = {}): BunPlugin {
  return tailwind(options);
}
