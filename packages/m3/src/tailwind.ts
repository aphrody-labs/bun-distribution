// SPDX-License-Identifier: Apache-2.0
// Compile Tailwind with the separately installed engine and Oxide scanner so
// Bun resolves the same Tailwind packages selected for the M3 workspace.
import { compile } from "@tailwindcss/node";
import { Scanner, type SourceEntry } from "@tailwindcss/oxide";
import type { BunPlugin } from "bun";
import { dirname } from "node:path";

const TAILWIND_DIRECTIVE =
  /@import\s*(?:url\()?['"]tailwindcss(?:['"/]|$)|@(?:tailwind|apply|theme|source|utility|variant|custom-variant|config|plugin)\b/;

export function tailwindM3Plugin(): BunPlugin {
  return {
    name: "@aphrody/m3-tailwind",
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async ({ path, defer }) => {
        const input = await Bun.file(path).text();
        if (!TAILWIND_DIRECTIVE.test(input)) return undefined;

        // Let Bun finish loading sources before Oxide scans them. This also
        // avoids racing another plugin's generated CSS in the same build.
        await defer();
        const base = dirname(path);
        const compiler = await compile(input, { base, onDependency() {} });
        const sources: SourceEntry[] =
          compiler.root === "none"
            ? []
            : compiler.root === null
              ? [
                  {
                    base: build.config?.root ?? base,
                    pattern: "**/*",
                    negated: false,
                  },
                ]
              : [{ ...compiler.root, negated: false }];
        sources.push(
          ...compiler.sources.map((source) => ({ ...source, negated: false })),
        );
        const candidates = new Scanner({ sources }).scan();
        return { contents: compiler.build(candidates), loader: "css" };
      });
    },
  };
}
