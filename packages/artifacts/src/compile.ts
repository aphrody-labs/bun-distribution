import { isObject, parseArtifactTarget } from "./manifest.ts";

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
const result = await Bun.build({
  entrypoints: [input.entry],
  target: "bun",
  format: "esm",
  minify: true,
  compile: {
    target: parseArtifactTarget(input.target),
    executablePath: input.executablePath,
    outfile: input.output,
    autoloadDotenv: false,
    autoloadBunfig: false,
    autoloadPackageJson: false,
    autoloadTsconfig: false,
  },
});
if (!result.success) {
  for (const diagnostic of result.logs) console.error(diagnostic.message);
  process.exitCode = 1;
}
