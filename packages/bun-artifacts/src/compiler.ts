// SPDX-License-Identifier: MIT
import { isBuiltin } from "node:module";
import { isAbsolute } from "node:path";

export interface StandaloneCompileOptions {
  entrypoint: string;
  target: Bun.Build.CompileTarget;
  executablePath: string;
  outfile: string;
  assets?: string[];
  define?: Record<string, string>;
  onInput?: (path: string) => void | Promise<void>;
}

/** Shared Bun standalone compiler; callers retain input policy and artifact receipts. */
export async function compileStandaloneApp(
  options: StandaloneCompileOptions,
): Promise<Awaited<ReturnType<typeof Bun.build>>> {
  for (const path of [options.entrypoint, options.executablePath, options.outfile, ...(options.assets ?? [])]) {
    if (!path || !isAbsolute(path)) throw new Error("Standalone compiler paths must be absolute.");
  }
  if (!options.target.startsWith("bun-")) throw new Error("Select an explicit Bun compile target.");

  const result = await Bun.build({
    entrypoints: [options.entrypoint],
    target: "bun",
    format: "esm",
    packages: "bundle",
    allowUnresolved: [],
    splitting: false,
    env: "disable",
    minify: true,
    metafile: true,
    ...(options.define ? { define: options.define } : {}),
    compile: {
      target: options.target,
      executablePath: options.executablePath,
      outfile: options.outfile,
      assets: options.assets ?? [],
      autoloadDotenv: false,
      autoloadBunfig: false,
      autoloadPackageJson: false,
      autoloadTsconfig: false,
    },
    ...(options.onInput
      ? {
          plugins: [
            {
              name: "standalone-input-owner",
              setup(build) {
                build.onLoad({ filter: /.*/, namespace: "file" }, async args => {
                  await options.onInput!(args.path);
                  return undefined;
                });
              },
            },
          ],
        }
      : {}),
  });

  if (!result.success || !result.metafile) {
    for (const diagnostic of result.logs) console.error(diagnostic.message);
    throw new Error("Standalone compilation failed or emitted no source graph.");
  }

  const unresolved = Object.values(result.metafile.inputs)
    .flatMap(input => input.imports)
    .filter(item => item.external && !item.path.startsWith("bun:") && item.path !== "bun" && !isBuiltin(item.path));
  if (unresolved.length) throw new Error("Standalone artifact has unresolved JavaScript imports.");
  return result;
}
