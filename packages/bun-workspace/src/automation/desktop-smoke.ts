// SPDX-License-Identifier: Apache-2.0
/**
 * Desktop smoke test: launch the built Aphrody desktop app with the WebView2 remote debugging
 * port open, attach to every webview over CDP and check that each one renders (non-empty body)
 * without uncaught exceptions, and that the process stays alive for the whole run.
 *
 * Usage:
 *   bun scripts/desktop-smoke.ts [--exe <path>] [--port 9333] [--seconds 60]
 *
 * Only the process this script starts is stopped (by PID, with its child tree). The app keeps
 * using the real per-user data directories; it never enables autostart on its own.
 */
import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";

const viewName = (url: string): string => new URL(url).searchParams.get("view") ?? "main";

export async function runDesktopSmoke(args: string[]): Promise<number> {
  let root = process.cwd();
  const option = (name: string, fallback: string): string => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] ? args[index + 1]! : fallback;
  };
  const rootIndex = args.indexOf("--root");
  if (rootIndex >= 0) root = args[rootIndex + 1] ?? "";
  if (!root) throw new Error("--root requires an aphrody-ui repository path");
  root = resolve(root);
  const exe = resolve(
    option("exe", join(root, "target", "release", process.platform === "win32" ? "aphrody-app.exe" : "aphrody-app")),
  );
  const port = Number(option("port", "9333"));
  const seconds = Number(option("seconds", "60"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be a TCP port");
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("--seconds must be positive");
  const logDir = join(root, "target", "desktop-smoke");
  interface ViewReport {
    url: string;
    textLength: number;
    elements: number;
    exceptions: string[];
  }

  const views = new Map<string, ViewReport>();
  const sockets: WebSocket[] = [];
  const exit: { code: number | null } = { code: null };

  async function attach(target: { id: string; url: string; webSocketDebuggerUrl: string }): Promise<void> {
    const name = viewName(target.url);
    const report: ViewReport = {
      url: target.url,
      textLength: 0,
      elements: 0,
      exceptions: [],
    };
    views.set(name, report);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    sockets.push(ws);
    let id = 0;
    const pending = new Map<number, (value: unknown) => void>();
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<any>(done => {
        id += 1;
        pending.set(id, done);
        ws.send(JSON.stringify({ id, method, params }));
      });
    ws.addEventListener("message", message => {
      const data = JSON.parse(String(message.data));
      if (data.id) pending.get(data.id)?.(data.result);
      else if (data.method === "Runtime.exceptionThrown") {
        const details = data.params.exceptionDetails;
        report.exceptions.push(details.exception?.description ?? details.text);
      } else if (data.method === "Runtime.consoleAPICalled" && data.params.type === "error") {
        report.exceptions.push(
          `console.error: ${data.params.args.map((arg: any) => arg.value ?? arg.description).join(" ")}`,
        );
      }
    });
    await new Promise(done => ws.addEventListener("open", () => done(undefined), { once: true }));
    // Enabling the runtime replays exceptions and console errors raised before attaching.
    await send("Runtime.enable");
    const measure = async () => {
      const result = await send("Runtime.evaluate", {
        expression:
          "JSON.stringify({ text: document.body?.innerText.length ?? 0, elements: document.body?.getElementsByTagName('*').length ?? 0 })",
        returnByValue: true,
      });
      const value = result?.result?.value;
      if (typeof value !== "string") return;
      const { text, elements } = JSON.parse(value) as {
        text: number;
        elements: number;
      };
      report.textLength = Math.max(report.textLength, text);
      report.elements = Math.max(report.elements, elements);
    };
    // Short-lived surfaces (the splash) close after startup: sample every second while open.
    const timer = setInterval(() => void measure().catch(() => undefined), 1000);
    ws.addEventListener("close", () => clearInterval(timer));
    for (let i = 0; i < 5; i++) {
      // Retries are sequential by design: each sample must follow the previous one after a delay.
      // oxlint-disable-next-line no-await-in-loop -- bounded retry loop that waits for the page to render
      await measure();
      if (report.elements > 0) break;
      // oxlint-disable-next-line no-await-in-loop -- fixed delay between sequential retries
      await Bun.sleep(200);
    }
  }

  await mkdir(logDir, { recursive: true });
  const stdout = await open(join(logDir, "stdout.log"), "w");
  const stderr = await open(join(logDir, "stderr.log"), "w");
  const started = Date.now();
  const child = Bun.spawn([exe], {
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`,
    },
    stdin: "ignore",
    stdout: stdout.fd,
    stderr: stderr.fd,
    onExit(_process, code, signal) {
      exit.code = code ?? -1;
      console.log(
        `process exited after ${((Date.now() - started) / 1000).toFixed(1)}s (code ${code}, signal ${signal})`,
      );
    },
  });
  console.log(`started ${exe} (pid ${child.pid}); logs in ${logDir}`);

  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline && exit.code === null) {
    try {
      // Polling the debugging endpoint is sequential by design: one probe per tick.
      // oxlint-disable-next-line no-await-in-loop -- sequential polling of the debugging endpoint
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as any[];
      for (const target of targets) {
        if (target.type === "page" && target.url.startsWith("http") && !views.has(viewName(target.url)))
          void attach(target).catch(() => undefined);
      }
    } catch {
      // The debugging endpoint is not up yet.
    }
    // oxlint-disable-next-line no-await-in-loop -- fixed tick between sequential polls
    await Bun.sleep(400);
  }
  const alive = exit.code === null;

  for (const ws of sockets) ws.close();
  if (alive) {
    if (process.platform === "win32")
      Bun.spawnSync(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      });
    else child.kill("SIGTERM");
  }
  await stdout.close();
  await stderr.close();

  const expected = ["main", "splash", "pet", "widget", "quickbar"];
  const failures: string[] = [];
  if (!alive) failures.push(`process exited early with code ${exit.code} (see stderr.log)`);
  for (const name of expected) {
    const view = views.get(name);
    if (!view) failures.push(`${name}: no webview seen`);
    else if (view.elements === 0) failures.push(`${name}: empty body`);
  }
  for (const [name, view] of views) {
    for (const exception of view.exceptions) failures.push(`${name}: ${exception.split("\n")[0]}`);
  }

  console.log(JSON.stringify({ alive, seconds, views: Object.fromEntries(views) }, null, 2));
  if (failures.length > 0) {
    console.error(`desktop smoke: ${failures.length} failure(s)\n- ${failures.join("\n- ")}`);
    return 1;
  }
  console.log(`desktop smoke: ${views.size} webviews rendered, no exceptions, alive for ${seconds}s`);
  return 0;
}

if (import.meta.main) process.exit(await runDesktopSmoke(process.argv.slice(2)));
