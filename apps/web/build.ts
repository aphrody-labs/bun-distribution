#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
let tailwind: any;
try {
  tailwind = (await import('@aphrody/bun-plugin-tailwind')).tailwind;
} catch {
  tailwind = (await import('C:/bun/packages/bun-plugin-tailwind/src/index.ts')).tailwind;
}

const outdir = join(import.meta.dir, 'dist');
mkdirSync(outdir, { recursive: true });

const start = performance.now();
console.log('⚡ Building apps/web with Bun.build & @aphrody/bun-plugin-tailwind...');

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, 'src/index.tsx')],
  outdir,
  naming: 'bundle.[ext]',
  target: 'browser',
  format: 'esm',
  minify: true,
  sourcemap: 'external',
  plugins: [tailwind({ theme: 'm3' })],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});

if (!result.success) {
  console.error('Build failed:', result.logs);
  process.exit(1);
}

const elapsed = (performance.now() - start).toFixed(1);
console.log(`✅ apps/web built in ${elapsed}ms -> dist/`);
for (const output of result.outputs) {
  console.log(`   - ${output.path} (${(output.size / 1024).toFixed(1)} KB)`);
}

const workers = await Bun.build({
  entrypoints: [
    join(import.meta.dir, "src/os/wasm/fs-worker.ts"),
    join(import.meta.dir, "src/os/wasm/repl-worker.ts"),
  ],
  outdir: join(outdir, "workers"),
  naming: "[name].[ext]",
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "external",
});
if (!workers.success) {
  console.error("Worker build failed:", workers.logs);
  process.exit(1);
}
for (const output of workers.outputs) console.log(`   - ${output.path} (${(output.size / 1024).toFixed(1)} KB)`);
