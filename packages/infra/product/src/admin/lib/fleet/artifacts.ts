// SPDX-License-Identifier: Apache-2.0
// Private pinned model delivery; no directory listing, prompts or provider stores.
import { timingSafeEqual } from "node:crypto";
import { isAbsolute, join } from "node:path";

const files = new Set([
  "model.safetensors",
  "config.json",
  "generation_config.json",
  "processor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "chat_template.jinja",
  "README.md",
  ".gitattributes",
]);

export function artifactHandler(root: string, token: string) {
  if (!isAbsolute(root) || !/^[a-f0-9]{64}$/.test(token))
    throw new Error("absolute pinned depot and protected token required");
  const expected = Buffer.from(`Bearer ${token}`);
  return async (request: Request) => {
    const provided = Buffer.from(request.headers.get("authorization") ?? "");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
      return new Response("Unauthorized", { status: 401 });
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", { status: 405 });
    const name = new URL(request.url).pathname.slice(1);
    if (!files.has(name)) return new Response("Not found", { status: 404 });
    const file = Bun.file(join(root, name));
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    const headers = {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/octet-stream",
    };
    const range = request.headers.get("range");
    let offset = 0;
    if (range) {
      const match = /^bytes=(\d+)-$/.exec(range);
      offset = match ? Number(match[1]) : -1;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= file.size)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${file.size}` },
        });
    }
    return new Response(request.method === "HEAD" ? null : file.slice(offset), {
      status: range ? 206 : 200,
      headers: {
        ...headers,
        "Accept-Ranges": "bytes",
        "Content-Length": String(file.size - offset),
        ...(range ? { "Content-Range": `bytes ${offset}-${file.size - 1}/${file.size}` } : {}),
      },
    });
  };
}

export async function serveArtifacts(argv: string[]) {
  const [root, tokenPath, address] = argv;
  if (!root || !tokenPath || !isAbsolute(tokenPath) || address !== "10.200.77.1")
    throw new Error(
      "usage: aphrody-product admin flotte depot <pinned depot> <protected token file> 10.200.77.1",
    );
  Bun.serve({
    hostname: address,
    port: 8182,
    idleTimeout: 255,
    fetch: artifactHandler(root, (await Bun.file(tokenPath).text()).trim()),
  });
  console.log("Private artifact delivery listening on declared mesh address");
}
