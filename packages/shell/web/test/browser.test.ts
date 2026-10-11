// SPDX-License-Identifier: Apache-2.0
// Real browser: headless Chrome loads the WASM shell from a page, runs the local shell and talks
// to a live PTY backend over a browser WebSocket. Needs the built pkg, APHRODY_SHELL_LIVE_BIN and
// APHRODY_CHROME (browser binary); skipped otherwise.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

const bin = process.env.APHRODY_SHELL_LIVE_BIN;
const chrome = process.env.APHRODY_CHROME;
const pkg = new URL("../pkg/", import.meta.url);
const ready = !!bin && !!chrome && existsSync(new URL("aphrody_shell_web_bg.wasm", pkg));

const page = (port: number) => `<!doctype html><body><pre id=out>pending</pre><script type=module>
import init, * as w from "/pkg/aphrody_shell_web.js";
import { attach, localTransport, webSocketTransport } from "/src/index.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await init();
const local = localTransport(w, 60, 10);
attach(w, local, 60, 10);
local.send(new TextEncoder().encode("echo browser-wasm\\r"));
const t = webSocketTransport(w, "ws://127.0.0.1:${port}/?token=t0k3n");
const term = attach(w, t, 100, 20);
await sleep(600);
term.type("echo live-$((20+22))\\r");
await sleep(1500);
document.getElementById("out").textContent =
  "LOCAL[" + local.snapshot().lines.join("|") + "] REMOTE[" + term.snapshot().lines.join("|") + "]";
document.title = "done";
</script>`;

test.skipIf(!ready)(
  "WASM shell works in a real browser, local and over WebSocket",
  async () => {
    const ptyPort = 20000 + Math.floor(Math.random() * 10000);
    const server = Bun.spawn([bin!, `127.0.0.1:${ptyPort}`], {
      windowsHide: true,
      env: { ...process.env, APHRODY_OS_AUTH_TOKEN: "t0k3n" },
      stdout: "ignore",
      stderr: "ignore",
    });
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const http = Bun.serve({
      port: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/")
          return new Response(page(ptyPort), { headers: { "content-type": "text/html" } });
        if (pathname === "/src/index.js") {
          const src = await Bun.file(new URL("../src/index.ts", import.meta.url)).text();
          return new Response(transpiler.transformSync(src), {
            headers: { "content-type": "text/javascript" },
          });
        }
        if (pathname.startsWith("/pkg/")) {
          const f = Bun.file(new URL(`.${pathname.slice(4)}`, pkg));
          return (await f.exists()) ? new Response(f) : new Response("nf", { status: 404 });
        }
        return new Response("nf", { status: 404 });
      },
    });
    try {
      await Bun.sleep(400);
      const cdpPort = 30000 + Math.floor(Math.random() * 10000);
      const proc = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--no-sandbox",
          "--disable-gpu",
          `--remote-debugging-port=${cdpPort}`,
          `--user-data-dir=/tmp/aphrody-shell-chrome-${cdpPort}`,
          "about:blank",
        ],
        { windowsHide: true, stdout: "ignore", stderr: "ignore" },
      );
      try {
        let wsUrl = "";
        for (let i = 0; i < 50 && !wsUrl; i++) {
          // oxlint-disable-next-line no-await-in-loop -- polls the DevTools endpoint until the page target appears; each attempt is a fresh request
          await Bun.sleep(200);
          try {
            // oxlint-disable-next-line no-await-in-loop -- polls the DevTools endpoint until the page target appears; each attempt is a fresh request
            const tabs = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()) as {
              type: string;
              url: string;
              webSocketDebuggerUrl: string;
            }[];
            wsUrl = tabs.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
          } catch {}
        }
        expect(wsUrl).not.toBe("");
        const cdp = new WebSocket(wsUrl);
        await new Promise((r) => cdp.addEventListener("open", r, { once: true }));
        let id = 0;
        const pending = new Map<number, (v: any) => void>();
        cdp.addEventListener("message", (e) => {
          const m = JSON.parse(String(e.data));
          pending.get(m.id)?.(m);
        });
        const evalJs = (expression: string) =>
          new Promise<string>((res) => {
            const n = ++id;
            pending.set(n, (m) => res(m.result?.result?.value ?? JSON.stringify(m)));
            cdp.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression } }));
          });
        await evalJs(`location.href = "http://127.0.0.1:${http.port}/"`);
        let title = "";
        for (let i = 0; i < 60 && title !== "done"; i++) {
          // oxlint-disable-next-line no-await-in-loop -- polls the page title at a fixed interval until the page reports done
          await Bun.sleep(250);
          // oxlint-disable-next-line no-await-in-loop -- polls the page title at a fixed interval until the page reports done
          title = await evalJs("document.title");
        }
        const out = `${title} ${await evalJs("location.href")} ${await evalJs("document.body.innerText")}`;
        expect(out).toContain("browser-wasm");
        expect(out).toMatch(/REMOTE\[[^\]]*live-42/);
        cdp.close();
      } finally {
        proc.kill();
      }
    } finally {
      http.stop(true);
      server.kill();
    }
  },
  60000,
);
