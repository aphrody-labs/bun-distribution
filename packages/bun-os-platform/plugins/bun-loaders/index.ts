// SPDX-License-Identifier: Apache-2.0
/** Built-in plugin over @aphrody/bun-loaders (inspection-only loaders), loaded by path. */
import { join } from "node:path";
import { definePlugin } from "../../src/plugins";
import { repoRoot } from "../../src/paths";

type Loaders = typeof import("../../../bun-loaders/src/index.ts");
let loaders: Promise<Loaders> | null = null;
const load = () =>
  (loaders ??= import(
    join(repoRoot, "packages", "bun-loaders", "src", "index.ts")
  ) as Promise<Loaders>);

export default definePlugin({
  name: "bun-loaders",
  setup(build) {
    build.onPreview({ kind: "executable", format: "pe" }, async ({ path }) => ({
      kind: "executable",
      metadata: (await (await load()).inspectPe(path)) as unknown as Record<
        string,
        unknown
      >,
    }));
    build.onPreview({ kind: "package", format: "apk" }, async ({ path }) => ({
      kind: "package",
      metadata: (await (await load()).inspectApk(path)) as unknown as Record<
        string,
        unknown
      >,
    }));
    build.onPreview({ kind: "model" }, async ({ path }) => ({
      kind: "model",
      metadata: (await (await load()).inspectScene(path)) as unknown as Record<
        string,
        unknown
      >,
    }));
    // The runtime loaders (`import info from "./game.nds"`) for hosts that opt in.
    build.onCommand("register-runtime-loaders", async () => {
      build.bunPlugin((await load()).loadersPlugin);
      return { registered: true };
    });
  },
});
