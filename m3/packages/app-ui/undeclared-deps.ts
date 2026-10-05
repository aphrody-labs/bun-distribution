// SPDX-License-Identifier: Apache-2.0
// Keep host and nested M3 workspaces on the application's React instance.
// The same resolver runs in production, development and behavioral tests.
import { dirname } from "node:path";
import type { BunPlugin } from "bun";

const here = import.meta.dir;

export const undeclaredDependencies: BunPlugin = {
  name: "app-ui-shared-dependencies",
  setup(build) {
    build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => ({
      path: Bun.resolveSync(args.path, here),
    }));
    build.onResolve({ filter: /^(framework-utils|@daybrush\/utils)$/ }, (args) => {
      if (!args.importer.includes("/react-selecto/")) return undefined;
      const selectoDir = dirname(Bun.resolveSync("selecto/package.json", args.importer));
      for (const from of [selectoDir, here]) {
        try {
          return { path: Bun.resolveSync(args.path, from) };
        } catch {
          // Try the next declared dependency owner.
        }
      }
      return undefined;
    });
  },
};

export default undeclaredDependencies;
