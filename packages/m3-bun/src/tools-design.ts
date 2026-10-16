// SPDX-License-Identifier: Apache-2.0
// `m3-bun design "<brief>"`: the design compiler of `@aphrody/m3-design`. A natural-language brief becomes an
// `@aphrody/m3-react` layout (`src/index.tsx`), an HCT theme sheet and W3C design tokens, with a self-critique.
import type { GenerationResult } from "@aphrody/m3-design";
import { resolve } from "node:path";
import { loadTool } from "./tools-load.ts";
import { writeFiles } from "./util.ts";

export interface DesignOptions {
  prompt: string;
  /** Seed colour `#rrggbb` (default: from the brief, else the M3 baseline). */
  color?: string;
  /** A design system shipped with `@aphrody/m3-design` (`design-systems/<id>`), e.g. `material`. */
  designSystem?: string;
  /** Validate the generated spec with the native validator of `@aphrody/bun`. */
  validate?: boolean;
  /** Write the files below this directory; without it nothing is written. */
  out?: string;
}

export interface DesignReport {
  brief: GenerationResult["brief"];
  seed: string;
  files: Array<{ path: string; bytes: number }>;
  critique: GenerationResult["critique"];
  /** Absolute paths written (empty without `out`). */
  written: string[];
  result: GenerationResult;
}

/** Compile a design brief and optionally write the generated files. */
export async function designApp(options: DesignOptions): Promise<DesignReport> {
  if (!options.prompt.trim()) throw new Error("m3-bun design: the brief is empty");
  const { DesignCompiler } = await loadTool("@aphrody/m3-design", () => import("@aphrody/m3-design"));
  const { loadDesignSystemFromDisk } = await import("@aphrody/m3-design/src/node.ts");
  const validateSpec = options.validate
    ? (await loadTool("@aphrody/bun", () => import("@aphrody/m3-design/src/native.ts"))).nativeSpecValidator
    : undefined;
  const compiler = new DesignCompiler({
    loadDesignSystem: loadDesignSystemFromDisk,
    ...(validateSpec ? { validateSpec } : {}),
  });
  const result = compiler.compile(options.prompt, options.color, options.designSystem);
  const written = options.out
    ? await writeFiles(
        resolve(options.out),
        result.files.map(file => ({ path: file.path, content: file.content })),
      )
    : [];
  return {
    brief: result.brief,
    seed: result.theme.seed,
    files: result.files.map(file => ({ path: file.path, bytes: Buffer.byteLength(file.content) })),
    critique: result.critique,
    written,
    result,
  };
}
