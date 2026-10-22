// Sleep in the kiosk session stand-in (headless Sway + Chrome kiosk window, `bun-engine frontend --session`):
// the power menu's "Sleep display" turns the Sway output off, the page holds a black cover, and the first key
// wakes it. Everything is checked against Sway itself (`swaymsg -t get_outputs`), not against the page.
// Input reaches Chrome over CDP: the headless seat has no keyboard device, so this proves the page and the
// host chain, not the compositor's routing of a real key to a powered-off output.
// usage: SWAYSOCK=... XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 bun session-flow2.ts <kiosk-cdp-port> <session-url> <out-dir>
import { join } from "node:path";
import { $ } from "bun";

const [cdp, base, out] = process.argv.slice(2);
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
const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const press = async (key: string) => {
  for (const type of ["rawKeyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: key === "Enter" ? 13 : key === "Escape" ? 27 : key.charCodeAt(0) });
};
const outputs = async () => (JSON.parse(await $`swaymsg -t get_outputs -r`.text()) as Array<{ name: string; power: boolean; active: boolean }>).filter(o => o.active);
const session = async () => (await (await fetch(new URL("/api/session", base!))).json()) as any;
const wait = (selector: string, ms = 8000) =>
  evaluate(`new Promise(ok => { const end = Date.now() + ${ms}; const t = setInterval(() => { const f = !!document.querySelector(${JSON.stringify(selector)}); if (f || Date.now() > end) { clearInterval(t); ok(f); } }, 50); })`);
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
const checks: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean, detail = "") => {
  checks.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` | ${detail}` : ""}`);
};

await send("Page.enable");
await send("Runtime.enable");
await settle();
const before = await session();
check("the service finds the Sway socket and offers Sleep", before.sleep.available === true && before.sleep.mechanism === "sway", JSON.stringify(before.sleep));
check("outputs are on before", (await outputs()).every(o => o.power));

await evaluate(`document.querySelector(".power-btn").focus()`);
await press("Enter");
await wait(".overlay.power");
await Bun.sleep(300);
await Bun.write(join(out!, "ui-power-sleep.png"), await new Bun.Image(Buffer.from(await $`grim -`.quiet().arrayBuffer())).png({ palette: true, colors: 128 }).bytes());
await evaluate(`document.querySelector("[data-power=sleep]").focus()`);
await press("Enter");
await Bun.sleep(1200);
check("Sway reports every output powered off", (await outputs()).every(o => !o.power), (await outputs()).map(o => `${o.name} power=${o.power}`).join(" "));
check("the page shows its cover and the service knows it sleeps", (await evaluate(`!!document.querySelector("#sleep-cover")`)) === true && (await session()).asleep === true);
const grim = await $`timeout 4 grim /dev/null`.nothrow();
check("the compositor really stopped drawing: grim cannot read the output (blocks, killed after 4 s)", grim.exitCode === 124, `exit ${grim.exitCode}`);

await press("a");
await Bun.sleep(1500);
check("the first key wakes the output (Sway reports power on)", (await outputs()).every(o => o.power));
check("the cover is gone, the service is awake, focus is back on a control", (await evaluate(`!document.querySelector("#sleep-cover") && document.activeElement.matches("[data-nav]")`)) === true && (await session()).asleep === false);

// a page that was reloaded while asleep must not leave the screen dark
await evaluate(`document.querySelector(".power-btn").focus()`);
await press("Enter");
await wait(".overlay.power");
await evaluate(`document.querySelector("[data-power=sleep]").focus()`);
await press("Enter");
await Bun.sleep(1200);
check("asleep again", (await outputs()).every(o => !o.power));
await send("Page.reload");
await wait("body[data-ready]", 15000);
await Bun.sleep(800);
check("a reload while asleep wakes the display at boot", (await outputs()).every(o => o.power) && (await session()).asleep === false);

const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? `; failed: ${failed.map(([name]) => name).join("; ")}` : ""}`);
ws.close();
process.exit(failed.length ? 1 : 0);
