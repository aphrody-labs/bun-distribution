// SPDX-License-Identifier: Apache-2.0
// Drive an OVH noVNC KVM console with Bun.WebView (Chrome backend, native trusted input).
// The console URL carries a session token: it is read from APHRODY_CONSOLE_URL, never argv.
const url = process.env.APHRODY_CONSOLE_URL;
if (!url) throw new Error("APHRODY_CONSOLE_URL is not set");
const text = process.env.APHRODY_CONSOLE_TYPE ?? "";
const enter = process.env.APHRODY_CONSOLE_ENTER === "1";
const shot = process.env.APHRODY_CONSOLE_SCREENSHOT ?? "";

const view = new Bun.WebView({
  width: 1280,
  height: 900,
  // Windows 11 build 28000: the out-of-process GPU host crashes on the first composited frame
  // ("GPU process isn't usable") and closes the pipe; keep it in the browser process there.
  backend: { type: "chrome", url: false, argv: process.platform === "win32" ? ["--in-process-gpu"] : [] },
});
try {
  await view.navigate(url);
  // noVNC draws into a <canvas> once the RFB WebSocket handshake completes.
  const deadline = Date.now() + 30_000;
  let state = "";
  while (Date.now() < deadline) {
    state = await view.evaluate(
      `(() => { const c = document.querySelector("canvas"); return c && c.width > 16 ? "ready" : document.readyState; })()`,
    );
    if (state === "ready") break;
    await Bun.sleep(250);
  }
  if (state !== "ready") throw new Error(`noVNC canvas not ready (${state})`);
  await view.click("canvas");
  // press() sends keyDown with key/text: noVNC maps e.key to a keysym.
  for (const ch of text) await view.press(ch);
  if (enter) await view.press("Enter");
  if (shot) {
    await Bun.sleep(500);
    await Bun.write(shot, await view.screenshot({ format: "png" }));
  }
  console.log(JSON.stringify({ canvas: "ready", typed: text.length, enter, screenshot: shot || null }));
} finally {
  view.close();
}
