import type { BunPlugin } from "bun";
import { join } from "node:path";
import { info } from "./headless.ts";

const HEADLESS = join(import.meta.dir, "headless.ts");

/** `import scene from "./x.blend"` gives a BlendScene; `import run from "./x.blender.py"` gives a runner. */
export const blenderPlugin: BunPlugin = {
  name: "bun-blender",
  setup(build) {
    build.onLoad({ filter: /\.blend$/ }, async ({ path }) => ({
      contents: `export default ${JSON.stringify(await info(path))};`,
      loader: "js",
    }));
    build.onLoad({ filter: /\.blender\.py$/ }, ({ path }) => ({
      contents: `import { runScript } from ${JSON.stringify(HEADLESS)};
export const script = ${JSON.stringify(path)};
export default (blend, args) => runScript(script, blend, args);`,
      loader: "js",
    }));
  },
};

export function registerBlenderPlugin(): void {
  Bun.plugin(blenderPlugin);
}

export default blenderPlugin;
