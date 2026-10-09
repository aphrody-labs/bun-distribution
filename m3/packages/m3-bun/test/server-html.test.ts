// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createM3App, DEFAULT_CSP, dirSource, startM3Server } from "../src/server.ts";
import { pagePath } from "../src/server-crawl.ts";
import { cspWithNonce } from "../src/server-html.ts";
import { m3ServerRoutes } from "../src/server-m3.ts";
import { renderMarkdown } from "../src/server-markdown.ts";
import { publish } from "../src/server-realtime.ts";
import { cleanup, tmp } from "./helpers.ts";

const resolvable = (specifier: string): boolean => {
  try {
    Bun.resolveSync(specifier, import.meta.dir);
    return true;
  } catch {
    return false;
  }
};
const hasM3Next = resolvable("@aphrody/m3-next");

let dir = "";
beforeAll(() => {
  dir = tmp();
  mkdirSync(join(dir, "docs"));
  writeFileSync(
    join(dir, "index.html"),
    '<!doctype html><html class="m3"><head><title>home</title></head><body><script src="/app.js"></script><script>boot()</script></body></html>',
  );
  writeFileSync(join(dir, "about.html"), "<!doctype html><html><head></head><body>about</body></html>");
  writeFileSync(
    join(dir, "docs", "guide.md"),
    "---\ntitle: The guide\ndescription: How to\n---\n# Heading\n\nSee https://example.com <script>alert(1)</script>\n",
  );
  writeFileSync(join(dir, "app.js"), "boot = () => {};");
});
afterAll(cleanup);

const get = (app: ReturnType<typeof createM3App>, path: string, headers: Record<string, string> = {}) =>
  app.fetch(new Request(`http://m3.test${path}`, { headers }));

const themedApp = () => createM3App({ files: dirSource(dir), theme: true, nonce: true });

const open = (url: string): Promise<{ socket: WebSocket; next(): Promise<unknown> }> => {
  const socket = new WebSocket(url);
  const queue: unknown[] = [];
  const waiting: ((value: unknown) => void)[] = [];
  socket.addEventListener("message", event => {
    const data = JSON.parse(String(event.data));
    const resolve = waiting.shift();
    if (resolve) resolve(data);
    else queue.push(data);
  });
  const next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiting.push(resolve)));
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve({ socket, next }));
    socket.addEventListener("error", () => reject(new Error(`cannot open ${url}`)));
  });
};

describe("CSP nonce (HTMLRewriter)", () => {
  test("cspWithNonce extends script-src, or derives it from default-src", () => {
    expect(cspWithNonce("default-src 'self'; script-src 'self'", "abc")).toBe(
      "default-src 'self'; script-src 'self' 'nonce-abc'",
    );
    expect(cspWithNonce("default-src 'self' https:", "abc")).toBe(
      "default-src 'self' https:; script-src 'self' https: 'nonce-abc'",
    );
  });

  test("every served page gets a fresh nonce on its scripts and in its CSP", async () => {
    const app = createM3App({ files: dirSource(dir), nonce: true });
    const first = await get(app, "/");
    const html = await first.text();
    const nonces = [...html.matchAll(/<script[^>]* nonce="([^"]+)"/g)].map(match => match[1]);
    expect(nonces).toHaveLength(2);
    expect(new Set(nonces).size).toBe(1);
    expect(first.headers.get("content-security-policy")).toBe(cspWithNonce(DEFAULT_CSP, nonces[0]!));
    const second = await (await get(app, "/")).text();
    expect(second).not.toContain(nonces[0]!);
    expect((await get(app, "/app.js")).headers.get("content-security-policy")).toBe(DEFAULT_CSP);
  });
});

describe.skipIf(!hasM3Next)("theme (@aphrody/m3-next)", () => {
  test("the m3-theme cookie sets the class, color-scheme and one theme-color", async () => {
    const res = await get(themedApp(), "/", { cookie: "m3-theme=dark" });
    const html = await res.text();
    expect(html).toContain('<html class="m3 dark"');
    expect(html).toContain('data-m3-theme="dark"');
    expect(html).toContain('style="color-scheme:dark"');
    expect(html.match(/<meta name="theme-color" content="#[0-9a-f]{6}">/gi)).toHaveLength(1);
    expect(res.headers.get("vary")).toBe("Cookie");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("without a cookie: system mode, the pre-paint script with the nonce, both metas, and the cookie set", async () => {
    const res = await get(themedApp(), "/about.html");
    const html = await res.text();
    const nonce = /'nonce-([^']+)'/.exec(res.headers.get("content-security-policy")!)![1];
    expect(html).toContain(`<head><script nonce="${nonce}">`);
    expect(html).toContain('data-m3-theme="system"');
    expect(html.match(/<meta name="theme-color" media=/g)).toHaveLength(2);
    expect(res.headers.getSetCookie()[0]).toStartWith("m3-theme=system");
  });
});

describe("Markdown pages (Bun.markdown, Bun.YAML)", () => {
  test("renderMarkdown: front matter title, heading ids, GFM tag filter, autolinks", () => {
    const page = renderMarkdown("---\ntitle: T & co\nlang: fr\n---\n# Hi\n\nwww.bun.sh <style>x</style>\n");
    expect(page.data).toEqual({ title: "T & co", lang: "fr" });
    expect(page.title).toBe("T &amp; co");
    expect(page.html).toContain('<html lang="fr">');
    expect(page.html).toContain('<h1 id="hi">Hi</h1>');
    expect(page.html).toContain('<a href="http://www.bun.sh">');
    expect(page.html).toContain("&lt;style>");
    expect(renderMarkdown("# Only *heading*").title).toBe("Only heading");
  });

  test("browsers get the page, other clients the source; /docs/guide finds guide.md", async () => {
    const app = createM3App({ files: dirSource(dir), markdown: { stylesheet: "/md.css" } });
    const page = await get(app, "/docs/guide.md", { accept: "text/html" });
    expect(page.headers.get("content-type")).toStartWith("text/html");
    const html = await page.text();
    expect(html).toContain("<title>The guide</title>");
    expect(html).toContain('<meta name="description" content="How to">');
    expect(html).toContain('<link rel="stylesheet" href="/md.css">');
    expect(html).not.toContain("<script>alert");
    expect(await (await get(app, "/docs/guide")).text()).toContain('<main class="m3-markdown">');
    expect(await (await get(app, "/docs/guide.md")).text()).toStartWith("---\ntitle: The guide");
  });
});

describe("crawler files", () => {
  test("pagePath maps the build's files to public URLs", () => {
    expect(["/index.html", "/a/index.html", "/b.html", "/c.md", "/d.js"].map(pagePath)).toEqual([
      "/",
      "/a/",
      "/b",
      "/c.md",
      undefined,
    ]);
  });

  test.skipIf(!hasM3Next)("sitemap.xml, robots.txt and llms.txt from the file list", async () => {
    const app = createM3App({
      name: "site",
      files: dirSource(dir),
      crawl: { origin: "https://m3.example", summary: "A site.", disallow: ["/about"] },
    });
    const sitemap = await (await get(app, "/sitemap.xml")).text();
    expect(sitemap).toContain("<loc>https://m3.example/</loc>");
    expect(sitemap).toContain("<loc>https://m3.example/docs/guide.md</loc>");
    expect(sitemap).not.toContain("/about");
    const robots = await (await get(app, "/robots.txt")).text();
    expect(robots).toContain("Disallow: /about");
    expect(robots).toContain("Sitemap: https://m3.example/sitemap.xml");
    const llms = await (await get(app, "/llms.txt")).text();
    expect(llms).toStartWith("# site\n\n> A site.");
    expect(llms).toContain("## Docs\n\n- [/docs/guide.md](https://m3.example/docs/guide.md)");
  });
});

describe("realtime (Bun WebSocket, server.publish)", () => {
  test("subscribers of a topic receive what the server publishes, and relayed client messages", async () => {
    const server = startM3Server({ port: 0, hostname: "127.0.0.1", files: dirSource(dir), realtime: { relay: true } });
    try {
      const ws = `ws://127.0.0.1:${server.port}/api/m3/ws`;
      const a = await open(`${ws}?topic=news&topic=chat`);
      const b = await open(`${ws}?topic=chat`);
      expect(publish(server, "news", { n: 1 })).toBeGreaterThan(0);
      expect(await a.next()).toEqual({ topic: "news", data: { n: 1 } });
      a.socket.send(JSON.stringify({ topic: "chat", data: "hello" }));
      expect(await b.next()).toEqual({ topic: "chat", data: "hello" });
      b.socket.send(JSON.stringify({ topic: "news", data: "not subscribed" }));
      publish(server, "chat", "from server");
      expect(await a.next()).toEqual({ topic: "chat", data: "from server" });
      a.socket.close();
      b.socket.close();
      const http = `http://127.0.0.1:${server.port}/api/m3/ws`;
      expect((await fetch(`${http}?topic=a%20b`)).status).toBe(400);
      expect((await fetch(`${http}?topic=ok`)).status).toBe(426);
      expect((await fetch(`http://127.0.0.1:${server.port}/`)).status).toBe(200);
    } finally {
      await server.stop(true);
    }
  });

  test("the topics option can refuse a connection", async () => {
    const server = startM3Server({ port: 0, hostname: "127.0.0.1", realtime: { topics: () => undefined } });
    try {
      expect((await fetch(`http://127.0.0.1:${server.port}/api/m3/ws?topic=x`)).status).toBe(403);
    } finally {
      await server.stop(true);
    }
  });
});

describe("Bun.serve routes from @aphrody/m3/server", () => {
  test("m3ServerRoutes: an .html page bundled by Bun.serve and a proxy prefix, next to the file server", async () => {
    const upstream = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: request => new Response(`upstream ${new URL(request.url).pathname}`),
    });
    const routes = await m3ServerRoutes({
      cwd: dir,
      routes: { "/about-page": "about.html" },
      proxy: { "/rpc": `http://127.0.0.1:${upstream.port}` },
    });
    const server = startM3Server({ port: 0, hostname: "127.0.0.1", files: dirSource(dir), routes });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      expect(await (await fetch(`${base}/about-page`)).text()).toContain("about");
      expect(await (await fetch(`${base}/rpc/x?y=1`)).text()).toBe("upstream /rpc/x");
      expect(await (await fetch(`${base}/`)).text()).toContain("<title>home</title>");
    } finally {
      await server.stop(true);
      await upstream.stop(true);
    }
  });
});
