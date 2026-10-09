// SPDX-License-Identifier: Apache-2.0
// Tailwind v4 for M3 applications comes from `@aphrody/bun-plugin-tailwind` (the
// fork of Bun publishes it): CSS roots compiled by `@tailwindcss/node`,
// candidates from the Oxide scanner and from every module of the build, and
// recompilation when a stylesheet, plugin or config changes. The M3 sheets
// themselves are the `m3:*` modules of `m3Plugin`.
import { tailwind, type BunTailwindOptions } from "@aphrody/bun-plugin-tailwind";
import { TailwindRoot } from "@aphrody/bun-plugin-tailwind/core";
import type { BunPlugin } from "bun";
import { join } from "node:path";

export type { BunTailwindOptions };

export function tailwindM3Plugin(options: BunTailwindOptions = {}): BunPlugin {
  return tailwind(options);
}

/**
 * A sheet no Tailwind root inlined (imported from JS, or by a conditional `@import`), compiled on its own
 * so its `@theme inline` block does not reach Bun's CSS parser. CSS without Tailwind features is returned as is.
 */
export async function compileSheet(name: string, css: string, base: string): Promise<string> {
  return (await new TailwindRoot(join(base, name), base).generate(css))?.css ?? css;
}
