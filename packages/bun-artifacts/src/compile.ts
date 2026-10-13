import { isObject, parseArtifactTarget } from "./manifest.ts";
import { compileStandaloneApp } from "./compiler.ts";

/** Private compiler child: its parent owns timeout, output and process-tree cancellation. */
const input: unknown = await Bun.file(process.argv[2] ?? "").json();
if (
  !isObject(input) ||
  typeof input.entry !== "string" ||
  typeof input.output !== "string" ||
  typeof input.target !== "string" ||
  typeof input.executablePath !== "string"
) {
  throw new Error("Invalid application compilation plan.");
}
await compileStandaloneApp({
  entrypoint: input.entry,
  target: parseArtifactTarget(input.target),
  executablePath: input.executablePath,
  outfile: input.output,
});
