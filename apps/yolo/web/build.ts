import { watch } from "node:fs";
import { resolve } from "node:path";

const isDev = process.argv.includes("--dev");
const outdir = resolve(import.meta.dir, "dist");

async function bundle() {
  const t0 = Bun.nanoseconds();
  const buildResult = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "src/main.ts")],
    outdir,
    target: "browser",
    minify: !isDev,
    sourcemap: isDev ? "inline" : "none",
    naming: "[name].[ext]",
  });

  if (!buildResult.success) {
    console.error("Build failed:");
    for (const message of buildResult.logs) {
      console.error(message);
    }
    return false;
  }

  // Copy HTML template & assets (the favicon is the 32px icon of crates/engine/yolo-desktop)
  const htmlSrc = await Bun.file(resolve(import.meta.dir, "index.html")).text();
  await Bun.write(resolve(outdir, "index.html"), htmlSrc);
  await Bun.write(resolve(outdir, "favicon.png"), Bun.file(resolve(import.meta.dir, "favicon.png")));

  const elapsedMs = ((Bun.nanoseconds() - t0) / 1_000_000).toFixed(2);
  console.log(`[Bun+OXC] Built in ${elapsedMs}ms -> dist/`);
  return true;
}

await bundle();

if (isDev) {
  console.log("[Bun+OXC] Serving dev server at http://localhost:1420...");
  Bun.serve({
    port: 1420,
    async fetch(req) {
      const url = new URL(req.url);
      let path = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = Bun.file(resolve(outdir, `.${path}`));
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  // Watch src/ for re-bundles
  watch(resolve(import.meta.dir, "src"), { recursive: true }, async () => {
    console.log("[Bun+OXC] Re-building changes...");
    await bundle();
  });
}
