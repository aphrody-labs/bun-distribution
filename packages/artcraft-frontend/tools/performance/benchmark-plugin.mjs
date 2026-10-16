import { relative, resolve } from "node:path";

// Bun build instrumentation used only by the existing performance tool.
export function benchmarkPlugin({ baselineRef, frontend } = {}) {
  const baseline = new Map();
  if (baselineRef) {
    for (const path of ["pages/MainApp.tsx", "pages/Stores/TabState.ts"]) {
      const result = Bun.spawnSync(
        [
          "git",
          "show",
          `${baselineRef}:frontend/apps/artcraft/app/src/${path}`,
        ],
        { cwd: frontend },
      );
      if (result.exitCode !== 0)
        throw new Error(`Cannot read baseline module ${path}`);
      baseline.set(
        `/apps/artcraft/app/src/${path}`,
        new TextDecoder().decode(result.stdout),
      );
    }
  }
  const exports = new Map([
    ["/pages/Stores/TabState.ts", ["tabs", "useTabStore"]],
    ["/pagedraw/src/lib/stores/SceneState.ts", ["scene", "useSceneStore"]],
    ["/pagedraw/src/lib/Node.ts", ["Node", "Node"]],
  ]);
  return {
    name: "artcraft-performance-fixtures",
    setup(build) {
      build.onLoad(
        { filter: /(MainApp\.tsx|TabState\.ts|SceneState\.ts|Node\.ts)$/ },
        async (args) => {
          const normalized = args.path.replaceAll("\\", "/");
          const source = [...baseline].find(([suffix]) =>
            normalized.endsWith(suffix),
          );
          let code = source?.[1] ?? (await Bun.file(args.path).text());
          for (const [suffix, [key, value]] of exports) {
            if (normalized.endsWith(suffix))
              code += `\nwindow.__ARTCRAFT_BENCH__ ??= {};\nwindow.__ARTCRAFT_BENCH__.${key} = ${value};\n`;
          }
          return {
            contents: code,
            loader: args.path.endsWith(".tsx") ? "tsx" : "ts",
          };
        },
      );
    },
  };
}

export async function writeBundleReport(result, outdir, frontend) {
  await Bun.write(
    resolve(outdir, "performance-bundle.json"),
    JSON.stringify(
      Object.entries(result.metafile.outputs)
        .filter(([file]) => file.endsWith(".js"))
        .map(([file, output]) => ({
          file: file.replace(/^\.\//, ""),
          entry: !!output.entryPoint,
          bytes: output.bytes,
          imports: output.imports,
          largestModules: Object.entries(output.inputs)
            .sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput)
            .slice(0, 25)
            .map(([path, input]) => ({
              module: relative(frontend, path),
              renderedBytes: input.bytesInOutput,
            })),
        })),
      null,
      2,
    ),
  );
}
