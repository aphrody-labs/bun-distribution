// SPDX-License-Identifier: Apache-2.0
// Drives the demo in headless Chrome over the DevTools protocol and checks what a user would see:
// the idle clock, the state API, prefers-reduced-motion, gaze following the pointer. Writes a
// screenshot. Needs Chrome (CHROME=path, or the default install).
//   bun demo/check.ts [screenshot.png]
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PET_WEB } from "../src/runtime";
import { serveDemo } from "./serve";

const chrome =
  process.env.CHROME ??
  Bun.which("chrome") ??
  Bun.which("google-chrome") ??
  Bun.which("chromium") ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const shot = process.argv[2] ?? join(tmpdir(), "aphrody-pet.png");

const server = serveDemo(0);
const profile = mkdtempSync(join(tmpdir(), "aphrody-pet-chrome-"));
const browser = Bun.spawn(
  [
    chrome,
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--window-size=900,700",
    "about:blank",
  ],
  { stderr: "pipe", stdout: "ignore" },
);

async function devtoolsUrl(): Promise<string> {
  let seen = "";
  const decoder = new TextDecoder();
  for await (const chunk of browser.stderr) {
    seen += decoder.decode(chunk);
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
    if (m?.[1]) return m[1];
  }
  throw new Error(`chrome did not start: ${seen}`);
}

const ws = new WebSocket(await devtoolsUrl());
await new Promise(r => ws.addEventListener("open", r, { once: true }));
let nextId = 0;
const pending = new Map<number, (v: { result?: any; error?: { message: string } }) => void>();
ws.addEventListener("message", e => {
  const msg = JSON.parse(String(e.data));
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});
async function cdp(method: string, params: object = {}, sessionId?: string): Promise<any> {
  const id = ++nextId;
  const reply = await new Promise<{
    result?: any;
    error?: { message: string };
  }>(resolve => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
  return reply.result;
}

const { targetId } = await cdp("Target.createTarget", { url: server.url.href });
const { sessionId } = await cdp("Target.attachToTarget", {
  targetId,
  flatten: true,
});
await cdp(
  "Page.addScriptToEvaluateOnNewDocument",
  {
    source:
      'globalThis.__errors=[];addEventListener("error",(e)=>__errors.push(String(e.message)));addEventListener("unhandledrejection",(e)=>__errors.push(String(e.reason)))',
  },
  sessionId,
);
const page = (method: string, params: object = {}) => cdp(method, params, sessionId);
async function evaluate<T>(expression: string): Promise<T> {
  const r = await page("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? expression);
  return r.result.value as T;
}

const cell = `(() => { const d = document.querySelector("aphrody-pet")?.shadowRoot?.querySelector(".nie-sprite");
  const c = [...(d?.classList ?? [])].find((c) => c.startsWith("nie-c")); return c ? Number(c.slice(5)) : null; })()`;
/** Distinct cells shown during `ms`, sampled every 40 ms in the page. */
const sample = (ms: number) =>
  evaluate<number[]>(`new Promise((done) => { const seen = []; const t0 = performance.now();
    const id = setInterval(() => { const c = ${cell}; if (c !== null && seen.at(-1) !== c) seen.push(c);
      if (performance.now() - t0 > ${ms}) { clearInterval(id); done(seen); } }, 40); })`);

const failures: string[] = [];
const check = (ok: boolean, what: string, detail: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}: ${JSON.stringify(detail)}`);
  if (!ok) failures.push(what);
};

try {
  const t0 = performance.now();
  // The target navigates from about:blank: contexts die until the demo page is up.
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- polling until the demo page paints; each probe depends on the previous result
    const shown = await evaluate<number | null>(cell).catch(() => null);
    if (shown !== null) break;
    if (performance.now() - t0 > 15_000) {
      // oxlint-disable-next-line no-await-in-loop -- diagnostic read happens only after the polling deadline, once
      const why = await evaluate<string>(
        `JSON.stringify({ url: location.href, ready: document.readyState, defined: !!customElements.get("aphrody-pet"),
          shadow: document.querySelector("aphrody-pet")?.shadowRoot?.innerHTML.slice(0, 200) ?? null, errors: globalThis.__errors ?? [] })`,
      ).catch(e => String(e));
      throw new Error(`the pet never painted: ${why}`);
    }
    // oxlint-disable-next-line no-await-in-loop -- fixed-interval polling of the page state
    await Bun.sleep(25);
  }
  check(true, "first frame painted (ms after navigation)", Math.round(performance.now() - t0));

  const idleCells = new Set(PET_WEB.tracks.idle!.frames.map(([c]) => c));
  const idle = await sample(2600);
  check(idle.length >= 2 && idle.every(c => idleCells.has(c)), "idle plays its own cells", idle);

  await evaluate(`document.querySelector("aphrody-pet").setState("running")`);
  const running = await sample(700);
  const runningCells = new Set(PET_WEB.tracks.running!.frames.map(([c]) => c));
  check(running.length >= 4 && running.every(c => runningCells.has(c)), "setState('running') plays running", running);
  check(
    (await evaluate<string>(`document.querySelector("aphrody-pet").state`)) === "running",
    "state getter",
    "running",
  );

  await page("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const still = await sample(800);
  check(
    still.length === 1 && still[0] === PET_WEB.tracks.running!.frames[0]![0],
    "reduced motion freezes the first frame",
    still,
  );
  await page("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });

  await evaluate(`document.querySelector("aphrody-pet").clearState()`);
  const box = await evaluate<{ x: number; y: number; w: number; h: number }>(
    `(() => { const r = document.querySelector("aphrody-pet").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`,
  );
  const eyes = { x: box.x + box.w / 2, y: box.y + box.h * 0.42 };
  const looks: [string, number, number, number][] = [
    ["right", 200, 0, 4],
    ["down", 0, 200, 8],
    ["left", -90, 0, 12],
    ["up-right", 120, -120, 2],
  ];
  for (const [name, dx, dy, index] of looks) {
    // oxlint-disable-next-line no-await-in-loop -- gaze checks run in order: each look must settle before the next sample
    await page("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: eyes.x + dx,
      y: Math.max(1, eyes.y + dy),
    });
    // oxlint-disable-next-line no-await-in-loop -- gaze checks run in order: each look must settle before the next sample
    const seen = await sample(150);
    const expected = PET_WEB.directions[index];
    check(seen.at(-1) === expected, `gaze ${name}`, { seen, expected });
  }
  await page("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: eyes.x + 5,
    y: eyes.y + 5,
  });
  check((await sample(120)).at(-1) === PET_WEB.neutral, "gaze dead zone shows the neutral pose", PET_WEB.neutral);

  const { data } = await page("Page.captureScreenshot", { format: "png" });
  await Bun.write(shot, Buffer.from(data, "base64"));
  console.log(`screenshot: ${shot}`);
} finally {
  ws.close();
  browser.kill();
  await browser.exited;
  server.stop(true);
  rmSync(profile, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
