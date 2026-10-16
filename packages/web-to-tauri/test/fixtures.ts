// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { solidIconPng } from "@aphrody/scaffold";

export interface Site {
  a: string;
  b: string;
  stop(): void;
}

/** Two loopback origins: `a` is the site, `b` is another origin that the page redirects through and posts to. */
export function startSite(): Site {
  const servers: ReturnType<typeof Bun.serve>[] = [];
  let aOrigin = "";
  let bOrigin = "";
  const b = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/hop")
        return Response.redirect(`${aOrigin}/home`, 302);
      return new Response("b", { headers: { "content-type": "text/plain" } });
    },
  });
  servers.push(b);
  bOrigin = `http://127.0.0.1:${b.port}`;
  const a = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      switch (url.pathname) {
        case "/start":
          return Response.redirect(`${bOrigin}/hop`, 302);
        case "/home": {
          const headers = new Headers({
            "content-type": "text/html; charset=utf-8",
          });
          headers.append(
            "set-cookie",
            "sid=abc123; Path=/; Secure; HttpOnly; SameSite=None",
          );
          headers.append("set-cookie", "__Host-t=1; Secure; Path=/");
          return new Response(
            `<!doctype html><html lang="fr"><head><title>Demo Site</title>
<meta name="theme-color" content="#336699"><meta name="description" content="A demo">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon-512.png" sizes="512x512" type="image/png">
<script src="/app.js"></script>
<script>if (/Chrome/.test(navigator.userAgent)) { document.title += "!"; }</script>
</head><body>
<a href="/about">About</a> <a href="/pricing?x=1#frag">Pricing</a> <a href="/logo.png">logo</a>
<a href="https://accounts.google.com/o/oauth2/v2/auth" target="_blank">Sign in</a>
<form action="${bOrigin}/pay" method="post"></form>
<iframe src="https://www.youtube.com/embed/abc"></iframe>
<script id="__NEXT_DATA__" type="application/json">{}</script></body></html>`,
            { headers },
          );
        }
        case "/footer":
          return new Response(
            `<!doctype html><title>Footer</title><a href="https://github.com/aphrody-code">GitHub</a> <a href="https://www.youtube.com/@aphrody">YouTube</a> <a href="https://www.facebook.com/aphrody">Facebook</a>`,
            { headers: { "content-type": "text/html" } },
          );
        case "/app.js":
          return new Response(
            `navigator.serviceWorker.register("/sw.js"); const s = new WebSocket("wss://api.demo.test/ws"); fetch("/api/me"); window.open("/x");`,
            { headers: { "content-type": "text/javascript" } },
          );
        case "/manifest.webmanifest":
          return Response.json({
            name: "Demo App",
            short_name: "Demo",
            start_url: "/home",
            display: "standalone",
            theme_color: "#336699",
            icons: [
              { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
            ],
          });
        case "/icon-512.png":
          return new Response(
            solidIconPng(512, [10, 20, 30, 255]).slice().buffer as ArrayBuffer,
            {
              headers: { "content-type": "image/png" },
            },
          );
        default:
          return new Response("not found", { status: 404 });
      }
    },
  });
  servers.push(a);
  aOrigin = `http://127.0.0.1:${a.port}`;
  return {
    a: aOrigin,
    b: bOrigin,
    stop: () => servers.forEach((server) => server.stop(true)),
  };
}

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function writeTree(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}
