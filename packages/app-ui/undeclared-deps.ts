// SPDX-License-Identifier: Apache-2.0
// Resolver for the undeclared dependencies of react-selecto@1.26: it imports `react`,
// `framework-utils` and `@daybrush/utils` without declaring them (only `selecto` is a dependency).
// The workspace uses Bun's isolated linker without hoisting, so those bare imports do not resolve
// from its store directory. They are resolved from the sibling `selecto` package (which declares
// the two utilities) and from this package (which declares React), so the bundle keeps a single
// React copy. Shared by `build.ts` (Bun.build) and `bunfig.toml` (`m3 dev`, Bun.serve).
import { dirname } from "node:path";
import type { BunPlugin } from "bun";

const here = import.meta.dir;

/** Resolve a bare import made by a package that forgot to declare it. */
export const undeclaredDependencies: BunPlugin = {
  name: "app-ui-undeclared-dependencies",
  setup(build) {
    build.onResolve({ filter: /^(react(\/.*)?|framework-utils|@daybrush\/utils)$/ }, (args) => {
      if (!args.importer.includes("/react-selecto/")) return undefined;
      const selectoDir = dirname(Bun.resolveSync("selecto/package.json", args.importer));
      for (const from of [selectoDir, here]) {
        try {
          return { path: Bun.resolveSync(args.path, from) };
        } catch {
          // try the next base directory
        }
      }
      return undefined;
    });
  },
};

export default undeclaredDependencies;
