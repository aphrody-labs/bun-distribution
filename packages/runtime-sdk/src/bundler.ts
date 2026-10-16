/**
 * `Bun.build` plugin that resolves the `runtime:*` specifiers at bundle time, so applications
 * using runtime modules can be bundled or compiled into one executable
 * (`Bun.build({ compile: ... })`). At run time the module still loads the native library.
 */
import type { BunPlugin } from "bun";

const EXPORTS: Record<string, string> = {
  "runtime:system": "system",
  "runtime:process": "processes",
  "runtime:desktop": "desktop",
  "runtime:browser": "browser, BrowserRuntime",
};

export const runtimeBundlerPlugin: BunPlugin = {
  name: "yolo-runtime",
  setup(build) {
    build.onResolve({ filter: /^runtime:/ }, (args) => {
      if (EXPORTS[args.path] === undefined) {
        throw new Error(
          `${args.path} is not available yet (see docs/decisions/runtime/DECISIONS.md)`,
        );
      }
      return { path: args.path, namespace: "yolo-runtime" };
    });
    build.onLoad({ filter: /.*/, namespace: "yolo-runtime" }, (args) => ({
      contents: `export { ${EXPORTS[args.path]} } from "@aphrody/runtime-sdk/modules";`,
      loader: "ts",
    }));
  },
};
