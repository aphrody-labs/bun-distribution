// SPDX-License-Identifier: Apache-2.0
// Local server: the production Worker code over dist/ (bun serve.ts [port]).
import { join } from "node:path";
import worker from "./worker/index";

const dist = join(import.meta.dir, "dist");
// Local stand-in for the R2 bucket: the ISO that vm.ts cached under build/web-vm.
const isoPath = join(import.meta.dir, "../../build/web-vm/alpine-virt-3.24.2-x86.iso");
const vm = {
  async head() {
    const file = Bun.file(isoPath);
    return (await file.exists()) ? { size: file.size, httpEtag: "local" } : null;
  },
  async get(_key: string, options?: { range?: { offset: number; length?: number } }) {
    const file = Bun.file(isoPath);
    const r = options?.range;
    const slice = r ? file.slice(r.offset, r.offset + (r.length ?? file.size - r.offset)) : file;
    return { body: slice.stream(), size: file.size, httpEtag: "local" };
  },
};
const assets = {
  async fetch(request: Request): Promise<Response> {
    const parts = decodeURIComponent(new URL(request.url).pathname).split("/").filter(Boolean);
    if (parts.includes("..")) return new Response("Bad path", { status: 400 });
    const path = parts.join("/");
    for (const candidate of [path, join(path, "index.html"), "index.html"]) {
      const file = Bun.file(join(dist, candidate));
      if (await file.exists()) return new Response(file);
    }
    return new Response("Not found", { status: 404 });
  },
};

const server = Bun.serve({
  port: Number(Bun.argv[2] ?? 8788),
  hostname: "127.0.0.1",
  fetch: async request => {
    const res = await worker.fetch(request, { ASSETS: assets, VM: vm });
    if (new URL(request.url).pathname.startsWith("/vm/alpine"))
      console.log(request.method, request.headers.get("range"), request.headers.get("if-range"), "->", res.status);
    return res;
  },
});
console.log(`webos: ${server.url}`);
