// SPDX-License-Identifier: Apache-2.0
// Real browser: write through the worker, reload the page, then read the same OPFS file.
// Requires the generated WASM package and APHRODY_CHROME (same gate as browser.test.ts).
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

const chrome = process.env.APHRODY_CHROME;
const pkg = new URL("../pkg/", import.meta.url);
const ready =
  !!chrome && existsSync(chrome) && existsSync(new URL("aphrody_shell_web_bg.wasm", pkg));

const page = `<!doctype html><title>pending</title><pre id="result">pending</pre><script type="module">
import init, { opfs_vfs_conformance } from "/pkg/aphrody_shell_web.js";
import { workerTransport } from "/src/index.js";
try { await init(); opfs_vfs_conformance(); }
catch (error) { document.title = "error"; document.getElementById("result").textContent = String(error); throw error; }
const phase = sessionStorage.getItem("opfs-phase") ?? "write";
const worker = new Worker("/src/worker.js", { type: "module" });
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let greeted = false;
worker.addEventListener("message", ({ data }) => {
  if (data.type === "error") {
    document.title = "error";
    document.getElementById("result").textContent = data.message;
  } else if (data.type === "closed") {
    sessionStorage.setItem("opfs-phase", "read");
    location.reload();
  }
});
const transport = workerTransport(80, 20, worker);
transport.onOutput((bytes) => {
  if (!greeted) {
    greeted = true;
    transport.send(encoder.encode(phase === "write" ? "echo persisted > testfile\\r" : "cat testfile\\r"));
  } else if (phase === "write") transport.close();
  else {
    const text = decoder.decode(bytes);
    document.title = text.includes("persisted\\r\\n") ? "done" : "error";
    document.getElementById("result").textContent = text;
  }
});
</script>`;

test.skipIf(!ready)(
  "OPFS shell file survives a page reload",
  async () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const http = Bun.serve({
      port: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/")
          return new Response(page, { headers: { "content-type": "text/html" } });
        if (pathname === "/src/worker.js") {
          const source = await Bun.file(new URL("../src/worker.ts", import.meta.url)).text();
          return new Response(transpiler.transformSync(source), {
            headers: { "content-type": "text/javascript" },
          });
        }
        if (pathname === "/src/index.js") {
          const source = await Bun.file(new URL("../src/index.ts", import.meta.url)).text();
          return new Response(transpiler.transformSync(source), {
            headers: { "content-type": "text/javascript" },
          });
        }
        if (pathname.startsWith("/pkg/")) {
          const file = Bun.file(new URL(`.${pathname.slice(4)}`, pkg));
          return (await file.exists())
            ? new Response(file)
            : new Response("missing", { status: 404 });
        }
        return new Response("missing", { status: 404 });
      },
    });
    const cdpPort = 30000 + Math.floor(Math.random() * 10000);
    let profile = `/tmp/aphrody-opfs-chrome-${cdpPort}`;
    if (chrome!.endsWith(".exe")) {
      const command = existsSync("/mnt/c/Windows/System32/cmd.exe")
        ? "/mnt/c/Windows/System32/cmd.exe"
        : "cmd.exe";
      const tempOutput = Bun.spawnSync([command, "/c", "echo", "%TEMP%"], {
        windowsHide: true,
      }).stdout.toString();
      const windowsTemp = tempOutput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .findLast((line) => /^[A-Za-z]:\\/.test(line));
      if (!windowsTemp) throw new Error("Could not find a Windows temporary directory");
      profile = `${windowsTemp}\\aphrody-opfs-chrome-${cdpPort}`;
    }
    const browser = Bun.spawn(
      [
        chrome!,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { windowsHide: true, stdout: "ignore", stderr: "ignore" },
    );
    try {
      let wsUrl = "";
      for (let i = 0; i < 50 && !wsUrl; i++) {
        // oxlint-disable-next-line no-await-in-loop -- sondage voulu : attendre le démarrage de Chrome, tentative après tentative.
        await Bun.sleep(200);
        try {
          // oxlint-disable-next-line no-await-in-loop -- sondage voulu : chaque tentative dépend du démarrage de Chrome.
          const tabs = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()) as {
            type: string;
            webSocketDebuggerUrl: string;
          }[];
          wsUrl = tabs.find((tab) => tab.type === "page")?.webSocketDebuggerUrl ?? "";
        } catch {
          /* Chrome is still starting. */
        }
      }
      expect(wsUrl).not.toBe("");
      const cdp = new WebSocket(wsUrl);
      await new Promise<void>((resolve) => {
        cdp.addEventListener("open", () => resolve());
      });
      let id = 0;
      const pending = new Map<number, (message: any) => void>();
      cdp.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        pending.get(message.id)?.(message);
      });
      const evaluate = (expression: string) =>
        new Promise<string>((resolve) => {
          const next = ++id;
          pending.set(next, (message) => resolve(message.result?.result?.value ?? ""));
          cdp.send(
            JSON.stringify({ id: next, method: "Runtime.evaluate", params: { expression } }),
          );
        });
      await evaluate(`location.href = "http://127.0.0.1:${http.port}/"`);
      let title = "";
      for (let i = 0; i < 100 && title !== "done" && title !== "error"; i++) {
        // oxlint-disable-next-line no-await-in-loop -- sondage voulu : attendre que la page signale son état dans document.title.
        await Bun.sleep(250);
        // oxlint-disable-next-line no-await-in-loop -- sondage voulu : chaque lecture de title suit le délai ci-dessus.
        title = await evaluate("document.title");
      }
      const result = await evaluate("document.body.innerText");
      expect(`${title} ${result}`).toContain("done");
      expect(result).toContain("persisted");
      cdp.close();
    } finally {
      browser.kill();
      http.stop(true);
    }
  },
  60000,
);
