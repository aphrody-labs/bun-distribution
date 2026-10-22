// The gamescope-session stand-in: `bun-engine frontend --session` as a Chrome kiosk window on headless
// sway (no GPU on the VPS, so real gamescope cannot run). grim captures the compositor output, so the
// PNG shows exactly what the session shows: no window chrome. Keys go to the page over CDP (wtype did not
// reach Chrome on a headless seat without a keyboard device).
// usage: XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 bun session-flow.ts <cdp-port> <out-dir> [restart|exit]
import { join } from "node:path";
import { $ } from "bun";

const [cdp, out, action = "restart"] = process.argv.slice(2);
const targets = (await (await fetch(`http://127.0.0.1:${cdp}/json`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
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
const press = async (key: string) => {
  for (const type of ["rawKeyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: key === "Enter" ? 13 : key === "Escape" ? 27 : 0 });
};
const active = () => evaluate(`document.activeElement.tagName + " " + JSON.stringify({ ...document.activeElement.dataset }) + " " + document.activeElement.textContent.trim().slice(0, 30)`);
const chrome = async () => (await $`pgrep -f ${"[k]iosk"}`.nothrow().text()).trim().split("\n")[0];

console.log("kiosk window pid:", await chrome());
console.log("viewport:", await evaluate("innerWidth + 'x' + innerHeight"), "| outer height equals screen:", await evaluate("outerHeight === screen.height"));
await evaluate(`document.querySelector(".power-btn").focus()`);
await press("Enter");
await Bun.sleep(600);
console.log("power menu focus:", await active());
await evaluate(`document.querySelector("[data-power=${action}]").focus()`);
await press("Enter");
await Bun.sleep(600);
console.log("confirm dialog, safe choice focused first:", await active());
await Bun.write(join(out!, "ui-session-confirm.png"), await new Bun.Image(await $`grim -`.quiet().arrayBuffer()).png({ palette: true, colors: 128 }).bytes());
await evaluate(`document.querySelector("[data-confirm=no]").focus()`);
await press("Enter"); // Cancel: nothing happens
await Bun.sleep(400);
console.log("after Cancel the confirm is gone, the power menu stays:", await evaluate("!document.querySelector('.overlay.confirm') && !!document.querySelector('.overlay.power')"), "| window pid unchanged:", await chrome());
ws.close();
