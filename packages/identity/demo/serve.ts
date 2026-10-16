// SPDX-License-Identifier: Apache-2.0
// <aphrody-pet> demo under Bun: the HTML route is bundled by Bun on the fly (element + runtime),
// the atlas is served from the package.
//   bun demo/serve.ts            (PORT=0 by default: a free port)
import { join } from "node:path";
import page from "./index.html";

export function serveDemo(port = 0, development = true) {
  const atlas = Bun.file(join(import.meta.dir, "../assets/spritesheet.webp"));
  return Bun.serve({
    port,
    routes: {
      "/": page,
      "/spritesheet.webp": () =>
        new Response(atlas, { headers: { "cache-control": "max-age=3600" } }),
    },
    development,
  });
}

if (import.meta.main) {
  const server = serveDemo(
    Number(process.env.PORT ?? 0),
    process.env.NODE_ENV !== "production",
  );
  console.log(`<aphrody-pet> : ${server.url}`);
}
