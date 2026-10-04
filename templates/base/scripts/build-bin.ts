// Compiles the server into one executable (Bun embedded) at dist/__NAME__.
import { runtimeBundlerPlugin } from "@aphrody/runtime-sdk/bundler";

const result = await Bun.build({
  entrypoints: ["src/server.ts"],
  plugins: [runtimeBundlerPlugin],
  target: "bun",
  minify: true,
  // Dependencies branch on NODE_ENV (React embeds a much larger development build with warnings unless it
  // is "production"). Bake it into the server and the embedded HTML bundles whatever the build environment.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  compile: {
    outfile: "dist/__NAME__",
    // Standalone executables auto-load a bunfig.toml from the current directory at runtime by default. This
    // project's bunfig.toml declares a dev-only `preload` (the runtime SDK's node_modules fallback), which a
    // deployed binary must never depend on: `pack:deploy` ships no bunfig.toml, but the binary could still be run
    // from a directory that happens to have one (the scaffold itself, a CI cache...). Keep it deterministic.
    autoloadBunfig: false,
  },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("built dist/__NAME__");
