// The frontend driven by a REAL gamepad: a virtual Xbox 360 style pad made with /dev/uinput (uinput-pad.py),
// seen by headless Chrome through its own Gamepad stack (udev, joydev, the standard mapping). Nothing is
// faked in the page: there is no navigator.getGamepads override. The pad commands go over a FIFO.
// setup (as root, once):  mkfifo $FIFO; sleep 3000 > $FIFO &   sudo python3 uinput-pad.py $FIFO --acl $USER > /dev/shm/pad.log &
// (keep the log off a throttled disk: a blocked print stalls the pad)
// usage: PAD_FIFO=$FIFO bun pad-real.ts <frontend-url> <cdp-port>
import { appendFileSync } from "node:fs";

const [base, cdp] = process.argv.slice(2);
const fifo = process.env.PAD_FIFO!;
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
const pad = (line: string) => appendFileSync(fifo, `${line}\n`);
// a tap lasts 200 ms in uinput-pad.py; the page polls the pad every frame
const tap = async (button: string, wait = 450) => {
  pad(`tap ${button}`);
  await Bun.sleep(wait);
};
const hat = async (axis: "X" | "Y", value: number) => {
  pad(`hat ${axis} ${value}`);
  await Bun.sleep(120);
  pad(`hat ${axis} 0`);
  await Bun.sleep(350);
};
const wait = (selector: string, ms = 20000) =>
  evaluate(`new Promise(ok => { const end = Date.now() + ${ms}; const t = setInterval(() => { const f = !!document.querySelector(${JSON.stringify(selector)}); if (f || Date.now() > end) { clearInterval(t); ok(f); } }, 50); })`);
const active = () => evaluate(`(() => { const e = document.activeElement; return e.tagName + " " + JSON.stringify({ ...e.dataset }) + " " + (e.getAttribute("aria-label") || e.textContent.trim().slice(0, 24)); })()`);
const checks: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean, detail = "") => {
  checks.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` | ${detail}` : ""}`);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
/** A fresh home page with the pad exposed (Chrome lists a pad only after a button press; Select does nothing here). */
async function fresh(): Promise<void> {
  await send("Page.navigate", { url: base! });
  await wait("body[data-ready]");
  await evaluate(`localStorage.removeItem("bunos.profile")`);
  await send("Page.navigate", { url: base! });
  await wait("body[data-ready]");
  await Bun.sleep(600);
  await tap("SELECT", 300);
  await tap("SELECT", 300);
  await evaluate(`document.querySelector(".hero [data-play]").focus()`);
}
/** Waits for a condition on the page instead of a fixed time: the host is shared and slow at times. */
const until = (condition: string, ms = 8000) =>
  evaluate(`new Promise(ok => { const end = Date.now() + ${ms}; const t = setInterval(() => { let f = false; try { f = !!(${condition}); } catch {} if (f || Date.now() > end) { clearInterval(t); ok(f); } }, 50); })`);

await fresh();
console.log("overridden getGamepads:", (await evaluate(`navigator.getGamepads.toString().includes("[native code]")`)) ? "no (native)" : "YES");
const reported = await evaluate(`JSON.stringify([...navigator.getGamepads()].filter(Boolean).map(p => ({ id: p.id, mapping: p.mapping, buttons: p.buttons.length, axes: p.axes.length })))`);
console.log("Chrome reports:", reported);
check("Chrome's Gamepad API sees the uinput pad with the standard mapping", reported.includes('"mapping":"standard"'));
check("the footer shows Xbox style glyphs for this pad", await until(`document.querySelector("#hints .hint svg text")?.textContent === "A"`), String(await evaluate(`document.querySelector("#pad").textContent.trim()`)));

// navigation: D-pad, A, B, left stick, shoulder buttons, Start
await hat("X", 1);
check("D-pad right moves focus to the next button", await until(`document.activeElement.dataset.details`), await active());
await tap("A", 300);
check("A opens the game page", await until(`document.querySelector(".game-page")`));
await tap("B", 300);
check("B goes back to the home page", await until(`!document.querySelector(".game-page") && document.querySelector(".hero [data-play]")`), await active());
await fresh();
pad("axis X 30000");
await Bun.sleep(400);
pad("axis X 0");
check("the left stick moves focus too", await until(`!document.activeElement.matches(".hero [data-play]")`), await active());
await fresh();
await tap("RB", 1500);
check("RB cycles to the next page (Systems)", await until(`document.querySelector("[data-tab=systems]").getAttribute("aria-current") === "page"`));
await tap("LB", 1500);
check("LB goes back a page (Library)", await until(`document.querySelector("[data-tab=home]").getAttribute("aria-current") === "page"`));
await fresh();
await tap("START", 300);
check("Start opens the quick menu", await until(`document.querySelector(".overlay.quick")`));
await tap("B", 300);
check("B closes it", await until(`!document.querySelector(".overlay")`));

// a running game: A launches, Select + R3 and the Guide button open the quick menu, Select + Start leaves
await fresh();
await tap("A", 300);
check("A launches the game into the player", await until(`document.querySelector("iframe.player")`, 60000));
await Bun.sleep(6000);
pad("down SELECT");
await Bun.sleep(100);
pad("down R3");
await Bun.sleep(400);
pad("up R3");
pad("up SELECT");
const quick = await until(`document.querySelector(".overlay.quick")`, 4000);
check("Select + R3 opens the quick menu over the game", quick);
if (quick) {
  await until(`document.querySelector("#quick-state")?.textContent === "Paused"`, 3000);
  console.log("pause state:", await evaluate(`document.querySelector("#quick-state").textContent`));
  await hat("Y", 1);
  console.log("focus after D-pad down:", await active());
  await tap("B", 300);
  check("B resumes the game and closes the menu", await until(`!document.querySelector(".overlay")`));
}
await Bun.sleep(600);
pad("down MODE");
await Bun.sleep(200);
pad("up MODE");
check("the Guide button opens the quick menu (Chrome reports it as button 16)", await until(`document.querySelector(".overlay.quick")`, 4000));
await tap("B", 300);
await until(`!document.querySelector(".overlay")`);
await Bun.sleep(500);
pad("down SELECT");
await Bun.sleep(100);
pad("down START");
await Bun.sleep(500);
pad("up START");
pad("up SELECT");
check("Select + Start leaves the game and returns to the library", await until(`!document.querySelector("iframe.player")`, 6000), await active());

const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? `; failed: ${failed.map(([name]) => name).join("; ")}` : ""}`);
ws.close();
process.exit(failed.length ? 1 : 0);
