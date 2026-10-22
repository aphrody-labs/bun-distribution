// End-to-end frontend flow through headless Chrome (CDP): library home, a system, a game playing in the
// embedded player iframe, and the return to the library after Escape with the focus restored.
// usage: bun flow.ts <frontend-url> <cdp-port> <out-dir> [system=nes]
import { join } from "node:path";

const [base, cdp, out, system = "nes"] = process.argv.slice(2);
const targets = (await (await fetch(`http://127.0.0.1:${cdp}/json`)).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
const ws = new WebSocket(targets.find(t => t.type === "page")!.webSocketDebuggerUrl);
await new Promise(resolve => (ws.onopen = resolve));
let id = 0;
const pending = new Map<number, (value: any) => void>();
ws.onmessage = event => {
  const message = JSON.parse(String(event.data));
  pending.get(message.id)?.(message);
};
const send = (method: string, params: object = {}) =>
  new Promise<any>(resolve => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression: string) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const press = async (key: string, code: number) => {
  for (const type of ["rawKeyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: code });
};
const shot = async (name: string) => {
  const { result } = await send("Page.captureScreenshot", { format: "png" });
  // 128-colour palette keeps every PNG under 150 KB
  await Bun.write(join(out, name), await new Bun.Image(Buffer.from(result.data, "base64")).png({ palette: true, colors: 128 }).bytes());
};
const wait = (selector: string, ms = 20000) =>
  evaluate(`new Promise(ok => { const end = Date.now() + ${ms}; const t = setInterval(() => { if (document.querySelector(${JSON.stringify(selector)}) || Date.now() > end) { clearInterval(t); ok(!!document.querySelector(${JSON.stringify(selector)})); } }, 100); })`);

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: base });
console.log("ready", await wait("[data-ready]"));
await Bun.sleep(800);
await shot("flow-1-library.png");

await evaluate(`document.querySelector('[data-system="${system}"]').focus()`);
await press("Enter", 13);
console.log("system view", await wait(".game"));
await Bun.sleep(500);
await shot("flow-2-system.png");

await press("Enter", 13); // A on the focused game launches it through its default route (embedded:<core>)
console.log("player", await wait("iframe.player", 30000));
await Bun.sleep(Number(process.env.PLAY_MS ?? 8000));
await shot("flow-3-playing.png");

await press("Escape", 27);
await Bun.sleep(800);
console.log("player closed", !(await evaluate(`!!document.querySelector('iframe.player')`)));
console.log("focus", await evaluate(`document.activeElement?.className + ' ' + (document.activeElement?.dataset?.game ?? '')`));
await shot("flow-4-returned.png");
ws.close();
