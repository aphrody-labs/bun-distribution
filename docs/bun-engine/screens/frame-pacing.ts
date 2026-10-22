// Frame pacing while a core runs: requestAnimationFrame deltas (p50/p95/p99/max, late frames) of the launcher
// page and of the player page, and the interval between GAME frames that actually reach the screen (the
// player's presented-frame counter). Headless Chrome over CDP, software rendering: it measures this host,
// not a console or a GPU. A baseline on the idle home page is taken first.
// usage: [RENDERER=2d|webgpu] bun frame-pacing.ts <frontend-url> <cdp-port> <out.json> [seconds=20]
// RENDERER reloads the player frame with `?renderer=...` to measure one presenter; without it the player chooses.
import { loadavg, cpus } from "node:os";

const [base, cdp, outFile, secondsArg] = process.argv.slice(2);
const seconds = Number(secondsArg ?? 20);

interface Client {
  send(method: string, params?: object): Promise<any>;
  evaluate(expression: string, contextId?: number): Promise<any>;
  frameContext(match: (origin: string) => boolean): number | undefined;
  close(): void;
}

async function connect(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  await new Promise(resolve => (ws.onopen = resolve));
  let id = 0;
  const pending = new Map<number, (value: any) => void>();
  // the player iframe shares the browser process (same site), so it is not a CDP target: it is reached through
  // its execution context
  const contexts = new Map<number, { id: number; origin: string; auxData?: { isDefault?: boolean } }>();
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
  return {
    send,
    frameContext: match => [...contexts.values()].find(context => context.auxData?.isDefault && match(context.origin))?.id,
    evaluate: async (expression, contextId) => {
      const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
      if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? "evaluate failed");
      return reply.result?.result?.value;
    },
    close: () => ws.close(),
  };
}

const targets = async () => (await (await fetch(`http://127.0.0.1:${cdp}/json`)).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
const page = await connect((await targets()).find(t => t.type === "page")!.webSocketDebuggerUrl);
await page.send("Page.enable");
await page.send("Runtime.enable");
await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
const wait = (client: Client, selector: string, ms = 30000) =>
  client.evaluate(`new Promise(ok => { const end = Date.now() + ${ms}; const t = setInterval(() => { const f = !!document.querySelector(${JSON.stringify(selector)}); if (f || Date.now() > end) { clearInterval(t); ok(f); } }, 50); })`);

// the collector: rAF deltas, and (in the player) the instants at which the presented-game-frame counter moved
const collector = (ms: number) => `new Promise(done => {
  const deltas = [], gameDeltas = [];
  let last = 0, lastGame = 0, frames = window.retroarch ? window.retroarch.frames() : -1;
  const end = performance.now() + ${ms};
  const tick = t => {
    if (last) deltas.push(t - last);
    last = t;
    if (window.retroarch) {
      const now = window.retroarch.frames();
      if (now !== frames) { if (lastGame) gameDeltas.push((t - lastGame) / (now - frames)); lastGame = t; frames = now; }
    }
    if (t < end) requestAnimationFrame(tick); else done({ deltas, gameDeltas, presented: window.retroarch ? window.retroarch.frames() : null });
  };
  requestAnimationFrame(tick);
})`;

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
function summarize(label: string, values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    label,
    samples: values.length,
    p50: Number(percentile(sorted, 50).toFixed(2)),
    p95: Number(percentile(sorted, 95).toFixed(2)),
    p99: Number(percentile(sorted, 99).toFixed(2)),
    max: Number(sorted.at(-1)!.toFixed(2)),
    mean: Number(mean.toFixed(2)),
    // a frame is late when it takes more than 1.5 display intervals (25 ms at 60 Hz)
    late: values.filter(value => value > 25).length,
  };
}

await page.send("Page.navigate", { url: base! });
await wait(page, "body[data-ready]");
await Bun.sleep(1500);
const rows: Array<ReturnType<typeof summarize>> = [];
const load0 = loadavg()[0]!;

// baseline: the home page, idle
const idle = (await page.evaluate(collector(seconds * 1000))) as { deltas: number[] };
rows.push(summarize("home page, idle (launcher rAF)", idle.deltas));

// a game: Enter on the first Play button, the embedded NES core in the player iframe
await page.evaluate(`document.querySelector("[data-play]").focus()`);
for (const type of ["rawKeyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
console.log("player iframe:", await wait(page, "iframe.player", 60000));
if (process.env.RENDERER) {
  const player = (await page.evaluate(`document.querySelector("iframe.player").src`)) as string;
  await page.evaluate(`document.querySelector("iframe.player").src = ${JSON.stringify(`${player}?renderer=${process.env.RENDERER}`)}`);
}
await Bun.sleep(8000); // let the core settle and the presenter start
const meta = (await page.evaluate(`document.querySelector("iframe.player").title`)) as string;
const launcher = (await page.evaluate(collector(seconds * 1000))) as { deltas: number[] };
rows.push(summarize(`launcher page while "${meta.replace(" (playing)", "")}" plays (rAF)`, launcher.deltas));

// the player page itself (a cross-origin iframe, reached through its JavaScript context)
const pageOrigin = new URL((await page.evaluate("location.href")) as string).origin;
const frameId = page.frameContext(origin => origin.startsWith("http://127.0.0.1:") && origin !== pageOrigin);
let playerNote = "the player frame has no JavaScript context";
if (frameId) {
  const result = (await page.evaluate(collector(seconds * 1000), frameId)) as { deltas: number[]; gameDeltas: number[]; presented: number };
  const renderer = await page.evaluate("retroarch.renderer", frameId);
  rows.push(summarize(`player page, ${renderer} presenter (rAF)`, result.deltas));
  if (result.gameDeltas.length) rows.push(summarize("game frames reaching the screen (ms per core frame)", result.gameDeltas));
  playerNote = `${result.presented} game frames presented in total, ${renderer} presenter`;
}

const report = {
  when: new Date().toISOString(),
  host: { cores: cpus().length, loadavgAtStart: Number(load0.toFixed(1)), note: "shared build host: other jobs were running, so tails include scheduling noise" },
  browser: "headless Chrome, software rendering (SwiftShader), 1280x720",
  seconds,
  playerNote,
  rows,
};
console.table(rows);
console.log(playerNote);
await Bun.write(outFile!, `${JSON.stringify(report, null, 2)}\n`);
for (const type of ["rawKeyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
page.close();
