// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNextBunServer } from "../src/shims/server";

let directory: string | undefined;
let server: ReturnType<typeof createNextBunServer> | undefined;

afterEach(async () => {
  await server?.stop(true);
  server = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function fixture() {
  directory = await mkdtemp(join(tmpdir(), "m3-next-server-"));
  const assets = join(directory, "public");
  await mkdir(assets);
  await writeFile(join(assets, "index.html"), "<main>SPA</main>");
  await writeFile(join(assets, "app.js"), "export default 1;");
  await writeFile(join(directory, "private.txt"), "private fixture");
  return assets;
}

describe("migrated Bun host boundary", () => {
  test("serves assets and navigation without turning missing assets into HTML", async () => {
    server = createNextBunServer({ port: 0, staticDir: await fixture() });
    expect(await (await fetch(new URL("/app.js", server.url))).text()).toBe("export default 1;");
    expect(await (await fetch(new URL("/dashboard", server.url))).text()).toBe("<main>SPA</main>");
    expect((await fetch(new URL("/missing.js", server.url))).status).toBe(404);
    const head = await fetch(new URL("/app.js", server.url), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("17");
    expect(await head.text()).toBe("");
    const post = await fetch(server.url, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });

  test("rejects decoded traversal and symlink escapes from the static root", async () => {
    const assets = await fixture();
    await symlink(join(directory!, "private.txt"), join(assets, "leak.txt"));
    server = createNextBunServer({ port: 0, staticDir: assets });
    await Promise.all(
      ["/%2e%2e%2fprivate.txt", "/..%5cprivate.txt", "/leak.txt"].map(async (path) => {
        const response = await fetch(new URL(path, server!.url));
        expect(response.status).toBe(403);
        expect(await response.text()).not.toContain("private fixture");
      }),
    );
    expect((await fetch(new URL("/%E0%A4", server.url))).status).toBe(400);
  });

  test("route methods expose Allow, HEAD and OPTIONS without leaking failures", async () => {
    server = createNextBunServer({
      port: 0,
      staticDir: await fixture(),
      routes: {
        "/api/data": { GET: () => Response.json({ ready: true }) },
        "/api/failure": {
          GET: () => {
            throw new Error("private exception detail");
          },
        },
      },
    });
    const head = await fetch(new URL("/api/data", server.url), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const options = await fetch(new URL("/api/data", server.url), { method: "OPTIONS" });
    expect(options.status).toBe(204);
    expect(options.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    const post = await fetch(new URL("/api/data", server.url), { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    const failure = await fetch(new URL("/api/failure", server.url));
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ error: "Internal Server Error" });
  });
});
