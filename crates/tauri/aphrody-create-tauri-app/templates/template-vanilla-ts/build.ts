import { rmSync } from "node:fs";

// Start from an empty dist/ (as `vite build` did) so `tauri build` never embeds stale hashed files.
rmSync("dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  minify: true,
  // Dependencies branch on NODE_ENV and Bun.build defaults it to development.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
