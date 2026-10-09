// SPDX-License-Identifier: MIT
import type { Program } from "@oxc-project/types";
import { parseProgram as nativeParseProgram } from "./native.ts";

/** Oxc runs only in the shared native provider. Bun owns ordinary transformation/bundling. */
export { analyzeModule, formatSource, minifySource, lintSource } from "./native.ts";
export type { ModuleAnalysis } from "./native.ts";
export type * from "@oxc-project/types";

/** Oxc's official JSON representation leaves runtime BigInt/RegExp values null. */
export type ESTreeJson<T> = T extends bigint | RegExp
  ? null
  : T extends readonly (infer Item)[]
    ? ESTreeJson<Item>[]
    : T extends object
      ? { [Key in keyof T]: ESTreeJson<T[Key]> }
      : T;
export type ESTreeProgram = ESTreeJson<Program>;

/** Official ESTree JSON, without a second N-API parser instance. */
export function parseProgram(source: string, filename = "input.js"): ESTreeProgram {
  return nativeParseProgram<ESTreeProgram>(source, filename);
}
