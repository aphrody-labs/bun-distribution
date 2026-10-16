import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await mkdir(new URL("../dist", import.meta.url), { recursive: true });
const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL("../src/main.ts", import.meta.url))],
  outdir: fileURLToPath(new URL("../dist", import.meta.url)),
  target: "browser",
  minify: true,
  sourcemap: "external",
});
if (!result.success)
  throw new AggregateError(result.logs, "Browser bundle failed");
await Bun.write(
  new URL("../dist/index.html", import.meta.url),
  Bun.file(new URL("../src/index.html", import.meta.url)),
);
console.log(
  `Built ${result.outputs.length} browser artifacts with Bun ${Bun.version} (${Bun.revision})`,
);
