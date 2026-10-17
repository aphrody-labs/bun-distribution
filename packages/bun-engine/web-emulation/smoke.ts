#!/usr/bin/env bun
/**
 * Headless browser smoke test per core: serve dist/web-emulation cross-origin isolated, open the
 * smoke page in headless Chrome over the DevTools protocol, boot a free ROM, run 120 frames and
 * require a non-black frame, a frame hash and no console errors. Writes
 * dist/web-emulation/smoke.json and screenshots under build/web-emulation/screens/.
 *
 *   bun packages/bun-engine/web-emulation/smoke.ts [core...] [--threads]
 */
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "./serve.ts";

const root = resolve(import.meta.dir, "../../..");
const dist = join(root, "dist", "web-emulation");
const shots = join(root, "build", "web-emulation", "screens");

/** Free test content per core (bep packs, pinned by sha256 in roms.json). */
const cases: Record<string, { system: string; rom: string; firmware?: string; frames?: number }> = {
  "dust-nds": { system: "nds", rom: "/roms/godmode9i/GodMode9i.nds" },
  melonds: { system: "nds", rom: "/roms/godmode9i/GodMode9i.nds" },
  "zakuro-3ds": { system: "3ds", rom: "/roms/fbi/FBI.3dsx" },
  "tetanes-nes": { system: "nes", rom: "/roms/tetanes-homebrew/alter_ego.nes" },
  "rustboyadvance-gba": { system: "gba", rom: "/roms/gba-tests/arm.gba" },
  "starpsx-psx": {
    system: "psx",
    rom: "/roms/psx/empty.bin",
    firmware: "openbios",
  },
};

function chromePath() {
  const candidates = [
    Bun.env.CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return candidates.find(p => p && Bun.file(p).size > 0);
}

class Cdp {
  #ws: WebSocket;
  #id = 0;
  #pending = new Map<number, (value: any) => void>();
  listeners: Array<(message: any) => void> = [];
  constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.#pending.has(message.id)) {
        this.#pending.get(message.id)!(message);
        this.#pending.delete(message.id);
      } else for (const listener of this.listeners) listener(message);
    };
  }
  static async connect(url: string) {
    const ws = new WebSocket(url);
    await new Promise((ok, fail) => {
      ws.onopen = ok;
      ws.onerror = fail;
    });
    return new Cdp(ws);
  }
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((ok, fail) =>
      this.#pending.set(id, m => (m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result))),
    );
  }
  close() {
    this.#ws.close();
  }
}

export async function smoke(cores: string[], threads: boolean) {
  const server = serve(0);
  const chrome = chromePath();
  if (!chrome) throw new Error("no Chrome/Chromium found (set CHROME)");
  const profile = join(root, "build", "web-emulation", "chrome-profile");
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(shots, { recursive: true });
  const browser = Bun.spawn(
    [
      chrome,
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-unsafe-webgpu",
      // GPU-less Linux hosts (the VPS): WebGPU on SwiftShader's Vulkan.
      ...(process.platform === "linux"
        ? [
            "--enable-features=Vulkan",
            "--use-vulkan=swiftshader",
            "--use-webgpu-adapter=swiftshader",
            "--enable-unsafe-swiftshader",
            ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
          ]
        : []),
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=800,1000",
      "about:blank",
    ],
    { stderr: "pipe", stdout: "ignore" },
  );
  let endpoint = "";
  const reader = browser.stderr.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  while (!endpoint) {
    const { value, done } = await reader.read();
    if (done) throw new Error("Chrome exited before DevTools was ready");
    buffered += decoder.decode(value);
    endpoint = buffered.match(/DevTools listening on (ws:\/\/\S+)/)?.[1] ?? "";
  }
  const cdp = await Cdp.connect(endpoint);
  const results: Record<string, unknown> = (await Bun.file(join(dist, "smoke.json")).exists())
    ? await Bun.file(join(dist, "smoke.json")).json()
    : {};
  try {
    for (const core of cores) {
      const test = cases[core];
      if (!test) throw new Error(`no smoke case for ${core}`);
      const query = new URLSearchParams({
        core,
        system: test.system,
        rom: test.rom,
        frames: String(test.frames ?? 120),
      });
      if (test.firmware) query.set("firmware", test.firmware);
      if (threads) query.set("threads", "1");
      const url = `${server.url}smoke/?${query}`;
      const { targetId } = await cdp.send("Target.createTarget", {
        url: "about:blank",
      });
      const { sessionId } = await cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      const logs: string[] = [];
      const listener = (m: any) => {
        if (m.sessionId !== sessionId) return;
        if (m.method === "Runtime.exceptionThrown")
          logs.push(
            `exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`,
          );
        if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning"))
          logs.push(`${m.params.type}: ${m.params.args.map((a: any) => a.value ?? a.description).join(" ")}`);
        if (m.method === "Log.entryAdded" && m.params.entry.level === "error") logs.push(`log: ${m.params.entry.text}`);
      };
      cdp.listeners.push(listener);
      await cdp.send("Runtime.enable", {}, sessionId);
      await cdp.send("Log.enable", {}, sessionId);
      await cdp.send("Page.enable", {}, sessionId);
      const opened = performance.now();
      await cdp.send("Page.navigate", { url }, sessionId);
      let result: any;
      while (performance.now() - opened < 180_000) {
        await Bun.sleep(500);
        const { result: value } = await cdp.send(
          "Runtime.evaluate",
          {
            expression: "JSON.stringify(window.__smoke ?? null)",
            returnByValue: true,
          },
          sessionId,
        );
        result = JSON.parse(value.value ?? "null");
        if (result) break;
      }
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
      const shotPath = join(shots, `${core}${threads ? "-threads" : ""}.png`);
      await Bun.write(shotPath, Buffer.from(shot.data, "base64"));
      cdp.listeners.splice(cdp.listeners.indexOf(listener), 1);
      await cdp.send("Target.closeTarget", { targetId });
      const entry = {
        ...(result ?? { ok: false, error: "timeout" }),
        browserLog: logs,
        screenshot: shotPath,
        testedAt: new Date().toISOString(),
      };
      results[`${core}${threads ? ":threads" : ""}`] = entry;
      console.log(
        `${core}${threads ? " (threads)" : ""}: ${entry.ok ? "ok" : "FAIL"} frames=${entry.frames} hash=${entry.hash} lit=${entry.lit} ${entry.renderer ?? ""} first=${Math.round(entry.ms?.firstFrame ?? -1)}ms ${entry.error ?? ""}`,
      );
      await Bun.write(join(dist, "smoke.json"), `${JSON.stringify(results, null, 2)}\n`);
    }
  } finally {
    cdp.close();
    browser.kill();
    server.stop(true);
  }
  return results;
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const cores = args.filter(a => !a.startsWith("--"));
  await smoke(cores.length ? cores : ["dust-nds"], args.includes("--threads"));
}
