/**
 * Builds the unified API as a Vercel Build Output (v3) for `vercel deploy --prebuilt`.
 *
 * The API imports workspace packages through Bun workspace links, which file
 * tracing does not follow reliably from a nested monorepo root. The function
 * is therefore one self-contained Bun bundle: nothing is resolved at runtime,
 * and no source, test or binary of the bot is ever published as static files.
 */
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const output = join(root, ".vercel", "output");
const fn = join(output, "functions", "index.func");

await rm(output, { recursive: true, force: true });
await mkdir(join(output, "static"), { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, "src", "api", "vercel.ts")],
  outdir: fn,
  // Lazy routes (Discord interactions, canvas cards and their native addon)
  // stay in separate chunks, so a cold start only parses the HTTP API.
  naming: { entry: "index.js", chunk: "chunks/[name]-[hash].js", asset: "assets/[name]-[hash].[ext]" },
  splitting: true,
  target: "bun",
  format: "esm",
  sourcemap: "linked",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await Bun.write(
  join(fn, ".vc-config.json"),
  JSON.stringify(
    {
      handler: "index.js",
      runtime: "bun1.4.x",
      architecture: "x86_64",
      launcherType: "Nodejs",
      shouldAddHelpers: true,
      shouldAddSourcemapSupport: false,
      supportsResponseStreaming: true,
      maxDuration: 60,
      // Same region as Supabase and Neon (eu-central-1), carried by the function
      // itself so the prebuilt output never falls back to the default region.
      regions: ["fra1"],
    },
    null,
    2,
  ),
);
await Bun.write(join(fn, "package.json"), JSON.stringify({ type: "module" }));
await Bun.write(
  join(output, "config.json"),
  JSON.stringify({ version: 3, routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/index" }] }, null, 2),
);

const size = result.outputs.reduce((total, artifact) => total + artifact.size, 0);
console.info(`[build-vercel] ${result.outputs.length} artifacts, ${(size / 1_048_576).toFixed(1)} MiB in ${fn}`);
