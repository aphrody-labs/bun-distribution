// The console-style frontend through headless Chrome (CDP): home with pad glyphs, the quick menu over a
// running game (real host actions), search with the on-screen keyboard, and the measurements behind the
// "premium" rules (focus latency, layout shift, accessible names). No controller is attached to the VPS,
// so a fake Gamepad API object (Xbox-style id) stands in for the pad: it exercises our pad code, not
// Chrome's or the OS's gamepad stack.
// usage: bun ui-flow.ts <frontend-url> <cdp-port> <out-dir>
import { join } from "node:path";

const [base, cdp, out] = process.argv.slice(2);
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
const codes: Record<string, number> = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, F1: 112 };
const press = async (key: string) => {
  for (const type of ["rawKeyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: codes[key] ?? key.charCodeAt(0) });
};
const shot = async (name: string) => {
  const { result } = await send("Page.captureScreenshot", { format: "png" });
  // a 128-colour palette keeps every PNG under 150 KB
  await Bun.write(join(out!, name), await new Bun.Image(Buffer.from(result.data, "base64")).png({ palette: true, colors: 128 }).bytes());
};
const wait = (selector: string, ms = 20000) =>
  evaluate(`new Promise(ok => { const end = Date.now() + ${ms}; const t = setInterval(() => { const f = !!document.querySelector(${JSON.stringify(selector)}); if (f || Date.now() > end) { clearInterval(t); ok(f); } }, 50); })`);
const focus = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
const active = () => evaluate(`(() => { const e = document.activeElement; return e.tagName + " " + JSON.stringify({ ...e.dataset }) + " " + (e.getAttribute("aria-label") || e.textContent.trim().slice(0, 30)); })()`);

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setFocusEmulationEnabled", { enabled: true }); // headless pages are not focused otherwise
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const pad = { id: "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)", index: 0, connected: true, mapping: "standard", timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    window.__fake = false;
    const real = navigator.getGamepads.bind(navigator);
    navigator.getGamepads = () => (window.__fake ? [pad] : real());
    window.__press = (index, on = true) => { pad.buttons[index].pressed = on; pad.buttons[index].value = on ? 1 : 0; };
    window.__cls = 0; window.__lat = []; let t0 = 0;
    new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    addEventListener("keydown", () => (t0 = performance.now()), true);
    addEventListener("focusin", () => { if (t0) { window.__lat.push(performance.now() - t0); t0 = 0; } }, true);
  })()`,
});
await send("Page.navigate", { url: base! });
await wait("body[data-ready]");
await evaluate(`localStorage.removeItem("bunos.profile")`); // the default profile, whatever an earlier run chose
await send("Page.navigate", { url: base! });
console.log("ready", await wait("body[data-ready]"));
await Bun.sleep(1000);

// 1. home, with the footer glyphs of a connected pad
await evaluate("window.__fake = true");
await Bun.sleep(400);
console.log("footer glyph for the select action:", await evaluate(`document.querySelector("#hints .hint svg text")?.textContent`));
console.log("initial focus:", await active());
console.log("layout shift after load:", await evaluate("window.__cls"));
console.log("controls without an accessible name:", JSON.stringify(await evaluate(`[...document.querySelectorAll("button, input, [role=slider]")].filter(e => !(e.getAttribute("aria-label") || e.textContent || e.labels?.[0]?.textContent || e.placeholder || "").trim()).map(e => e.outerHTML.slice(0, 60))`)));
await shot("ui-home.png");
for (const key of ["ArrowDown", "ArrowRight", "ArrowRight", "ArrowDown", "ArrowUp"]) {
  await press(key);
  await Bun.sleep(150);
}
const latency = (await evaluate("window.__lat")) as number[];
console.log("focus latency (keydown to focusin), ms:", latency.map(value => value.toFixed(1)).join(" "));

// 2. quick menu over a running game
await evaluate(`document.querySelector("[data-play]").focus()`);
await press("Enter");
console.log("player iframe:", await wait("iframe.player", 30000));
await Bun.sleep(6000);
await press("F1");
console.log("quick menu:", await wait(".overlay.quick", 3000));
await Bun.sleep(900);
console.log("pause confirmed by RetroArch:", await evaluate(`document.querySelector("#quick-state").textContent`), "| focus:", await active());
await shot("ui-quick-menu.png");
for (const action of ["save", "screenshot", "load"]) {
  await focus(`[data-q=${action}]`);
  await press("Enter");
  await Bun.sleep(1400);
  console.log(action, "->", await evaluate(`document.querySelector("#quick-log").textContent`));
}
await focus("[data-adjust=volume]");
await press("ArrowLeft");
console.log("volume:", await evaluate(`document.querySelector("[data-adjust=volume]").getAttribute("aria-valuenow")`));
await focus("[data-q=stop]");
await press("Enter");
console.log("stop asks first, focus on:", await active());
await press("Enter"); // Cancel
await focus("[data-q=resume]");
await press("Enter");
await Bun.sleep(600);
console.log("resumed, focus back on:", await active());
await press("Escape"); // leaves the game
await Bun.sleep(1500);

// 3. search with the pad keyboard
await evaluate(`document.querySelector("[data-tab=search]").click()`);
console.log("search page:", await wait("#q"));
for (const key of ["s", "w"]) {
  await focus(`.key[data-key="${key}"]`);
  await press("Enter");
}
await Bun.sleep(500);
console.log("typed:", await evaluate(`document.querySelector("#q").value`), "|", await evaluate(`document.querySelector("#q-status").textContent`));
await focus("#results .game");
await shot("ui-search.png");
ws.close();
