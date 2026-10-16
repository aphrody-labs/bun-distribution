import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Recompile only when a source file is newer than the compiled marker.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const marker = join(root, "dist", "recordedCatalogDigests.js");
const built = await stat(marker).then(
  (info) => info.mtimeMs,
  () => 0,
);
let newest = 0;
for (const pattern of [
  "src/**/*.ts",
  "scripts/compile.mjs",
  "scripts/bundle-runtime.mjs",
  "package.json",
])
  for await (const path of new Bun.Glob(pattern).scan({ cwd: root }))
    newest = Math.max(newest, (await stat(join(root, path))).mtimeMs);
if (newest > built) {
  const proc = Bun.spawn(["bun", "run", "compile"], {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exitCode = await proc.exited;
}
