// The game picture in the kiosk session, seen by the compositor (grim) and not by CDP: launches the first game
// from the home page of the Chrome kiosk window, then compares the player's two presenters in the same window,
// the 2D canvas and the WebGPU canvas (`?renderer=2d|webgpu` on the player page). Prints, per presenter, how
// many pixels of the compositor output are not black. The root cause of the black picture is in README.md.
// usage: XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 bun kiosk-game.ts <kiosk-cdp-port> <out-dir> [game-id]
import { join } from "node:path";
import { $ } from "bun";

const [cdp, out, gameId] = process.argv.slice(2);
const list = async () => (await (await fetch(`http://127.0.0.1:${cdp}/json`)).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;

async function connect(url: string) {
  const ws = new WebSocket(url);
  await new Promise(resolve => (ws.onopen = resolve));
  let id = 0;
  const pending = new Map<number, (value: any) => void>();
  // the page's JavaScript contexts: the player iframe shares the browser process (same site), so it is not a
  // CDP target of its own and is reached through its execution context
  const contexts = new Map<number, { id: number; origin: string; auxData?: { isDefault?: boolean; frameId?: string } }>();
  ws.onmessage = event => {
    const message = JSON.parse(String(event.data));
    pending.get(message.id)?.(message);
    if (message.method === "Runtime.executionContextCreated") contexts.set(message.params.context.id, message.params.context);
    else if (message.method === "Runtime.executionContextDestroyed") contexts.delete(message.params.executionContextId);
    else if (message.method === "Runtime.executionContextsCleared") contexts.clear();
  };
  const send = (method: string, params: object = {}) =>
    new Promise<any>(resolve => {
      pending.set(++id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression: string, contextId?: number) =>
    (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) })).result?.result?.value;
  /** The default context of a frame whose origin matches `match`. */
  const frameContext = (match: (origin: string) => boolean) => [...contexts.values()].find(context => context.auxData?.isDefault && match(context.origin))?.id;
  return { send, evaluate, frameContext, close: () => ws.close() };
}

/** Pixels of the compositor output that are not black, and how many distinct colours it holds. */
async function grimStats() {
  const ppm = Buffer.from(await $`grim -t ppm -`.quiet().arrayBuffer());
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.subarray(0, 32).toString("latin1"))!;
  const [width, height] = [Number(header[1]), Number(header[2])];
  const data = ppm.subarray(header[0].length);
  const colors = new Set<number>();
  let lit = 0;
  for (let i = 0; i < width * height; i++) {
    const value = (data[i * 3]! << 16) | (data[i * 3 + 1]! << 8) | data[i * 3 + 2]!;
    if (value) lit++;
    colors.add(value);
  }
  return { width, height, litPercent: Number(((lit / (width * height)) * 100).toFixed(1)), colors: colors.size };
}
const grimShot = async (name: string) =>
  Bun.write(join(out!, name), await new Bun.Image(Buffer.from(await $`grim -`.quiet().arrayBuffer())).png({ palette: true, colors: 128 }).bytes());

/** Under headless Sway on a loaded host the Chrome kiosk window sometimes keeps a stale window geometry: the page is
 * drawn offset by (115, 10) with black bars and the right and bottom cropped (pixel 2,2 of the output is pure black)
 * although Sway reports the window fullscreen at 0,0. Toggling Sway's fullscreen sends a new configure and Chrome
 * redraws in place. Wait for the page's own background at 2,2 (#07090f is not black), toggling every 6 s. */
async function settle(ms = 90_000): Promise<void> {
  const end = Date.now() + ms;
  for (let tries = 0; Date.now() < end; tries++) {
    const ppm = Buffer.from(await $`grim -g "2,2 1x1" -t ppm -`.quiet().arrayBuffer());
    if (ppm.subarray(ppm.length - 3).some(channel => channel > 0)) return;
    if (tries % 12 === 11) {
      await $`swaymsg fullscreen disable`.quiet().nothrow();
      await Bun.sleep(800);
      await $`swaymsg fullscreen enable`.quiet().nothrow();
    }
    await Bun.sleep(500);
  }
  throw new Error("the kiosk window never filled the output");
}

const page = await connect((await list()).find(t => t.type === "page")!.webSocketDebuggerUrl);
await settle();
await page.send("Runtime.enable");
const info = await (await fetch("http://127.0.0.1:" + cdp + "/json/version")).json();
const browser = await connect(info.webSocketDebuggerUrl);
const gpu = (await browser.send("SystemInfo.getInfo")).result?.gpu?.featureStatus ?? {};
console.log("kiosk Chrome feature status:", JSON.stringify({ gpu_compositing: gpu.gpu_compositing, webgl: gpu.webgl, webgpu: gpu.webgpu, "2d_canvas": gpu["2d_canvas"] }));
browser.close();

await page.evaluate(`document.querySelector(${JSON.stringify(gameId ? `.tile[data-play="${gameId}"], [data-play="${gameId}"]` : "[data-play]")}).focus()`);
for (const type of ["rawKeyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
for (let i = 0; i < 100 && !(await page.evaluate(`!!document.querySelector("iframe.player")`)); i++) await Bun.sleep(300);
await Bun.sleep(9000);
const pageOrigin = new URL(await page.evaluate("location.href")).origin;
const inPlayer = (expression: string) => {
  const id = page.frameContext(origin => origin.startsWith("http://127.0.0.1:") && origin !== pageOrigin);
  if (!id) throw new Error("the player frame has no JavaScript context");
  return page.evaluate(expression, id);
};
const state = await inPlayer(`JSON.stringify({ renderer: retroarch.renderer, adapter: retroarch.adapter, frames: retroarch.frames(), url: location.href })`);
console.log("player (default presenter):", state);
const auto = await grimStats();
console.log("compositor output, default presenter:", JSON.stringify(auto));
await grimShot("kiosk-game-default.png");

// the quick menu over the game, as the compositor shows it (the phase 1 capture had to come from CDP)
for (const type of ["rawKeyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "F1", code: "F1", windowsVirtualKeyCode: 112 });
for (let i = 0; i < 30 && !(await page.evaluate(`!!document.querySelector(".overlay.quick")`)); i++) await Bun.sleep(200);
await Bun.sleep(1000);
console.log("quick menu state:", await page.evaluate(`document.querySelector("#quick-state")?.textContent`));
console.log("compositor output with the quick menu:", JSON.stringify(await grimStats()));
await grimShot("kiosk-quick-menu.png");
for (const type of ["rawKeyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await Bun.sleep(800);

// the same game page forced to WebGPU, in the same window
const url = new URL(JSON.parse(state).url);
url.searchParams.set("renderer", "webgpu");
await page.evaluate(`document.querySelector("iframe.player").src = ${JSON.stringify(url.href)}`);
await Bun.sleep(9000);
console.log("player (forced WebGPU):", await inPlayer(`(async () => JSON.stringify({ renderer: retroarch.renderer, frames: retroarch.frames(), capture: await retroarch.capture() }))()`));
const webgpu = await grimStats();
console.log("compositor output, forced WebGPU:", JSON.stringify(webgpu));
await grimShot("kiosk-game-webgpu.png");

// leave the game
for (const type of ["rawKeyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
page.close();
