// SPDX-License-Identifier: Apache-2.0
// Local server: the production Worker code over dist/ (bun serve.ts [port]).
import { join, relative, resolve, isAbsolute } from "node:path";
import worker from "./worker/index";

const dist = join(import.meta.dir, "dist");
const apiOrigin = Bun.env.BUN_OS_API_ORIGIN ? new URL(Bun.env.BUN_OS_API_ORIGIN) : undefined;
if (apiOrigin && (!/^https?:$/.test(apiOrigin.protocol) || apiOrigin.username || apiOrigin.password ||
  apiOrigin.pathname !== "/" || apiOrigin.search || apiOrigin.hash))
  throw new Error("BUN_OS_API_ORIGIN must be an HTTP(S) origin without credentials, path, query or fragment.");
const api = {
  async fetch(request: Request): Promise<Response> {
    if (!apiOrigin) return Response.json({ error: "API backend unavailable." }, { status: 503 });
    const url = new URL(request.url);
    return fetch(new Request(new URL(url.pathname + url.search, apiOrigin), request), { redirect: "manual" });
  },
};
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
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(request.url).pathname); }
    catch { return new Response("Bad path", { status: 400 }); }
    const parts = pathname.split("/").filter(Boolean);
    if (parts.some(part => part === ".." || /[\\:\0]/.test(part))) return new Response("Bad path", { status: 400 });
    const path = parts.join("/");
    const candidates = [path, join(path, "index.html"), ...(!parts.at(-1)?.includes(".") ? ["index.html"] : [])];
    for (const candidate of candidates) {
      const full = resolve(dist, candidate);
      const within = relative(dist, full);
      if (within.startsWith("..") || isAbsolute(within)) return new Response("Bad path", { status: 400 });
      const file = Bun.file(full);
      if (await file.exists()) {
        const etag = `W/"${file.size.toString(16)}-${Math.trunc(file.lastModified).toString(16)}"`;
        const headers = { "content-type": file.type, etag, "cache-control": "no-cache" };
        const matches = request.headers.get("if-none-match")?.split(",").some(value => value.trim() === etag || value.trim() === "*");
        if (matches) return new Response(null, { status: 304, headers });
        return new Response(request.method === "HEAD" ? null : file, { headers });
      }
    }
    return new Response("Not found", { status: 404 });
  },
};

const server = Bun.serve({
  port: Number(Bun.argv[2] ?? 8788),
  hostname: "127.0.0.1",
  fetch: async request => {
    const res = await worker.fetch(request, { ASSETS: assets, VM: vm, LEGACY: api });
    if (new URL(request.url).pathname.startsWith("/vm/alpine"))
      console.log(request.method, request.headers.get("range"), request.headers.get("if-range"), "->", res.status);
    return res;
  },
});
console.log(`webos: ${server.url}`);
