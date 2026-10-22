// Phase 2 of the console-style frontend through headless Chrome (CDP): the game page, app tiles, interface
// sounds, the power menu's sleep entry, the Settings host panels and per-profile saves. No controller is
// attached to the VPS, so a fake Gamepad API object stands in for a pad (see ui-flow.ts); every other
// check reads the real service, the real files and the real processes.
// usage: BEP_ROOT=<usr> bun ui-flow2.ts <frontend-url> <cdp-port> <out-dir>
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const [base, cdp, out] = process.argv.slice(2);
const usr = process.env.BEP_ROOT!;
const retroarch = join(usr, "var", "lib", "bep", "libretroarch");
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
const evaluate = async (expression: string) => {
  const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? "evaluate failed");
  return reply.result?.result?.value;
};
const codes: Record<string, number> = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, F1: 112 };
const press = async (key: string) => {
  for (const type of ["rawKeyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: codes[key] ?? key.charCodeAt(0) });
};
const shot = async (name: string, redact = false) => {
  if (redact)
    await evaluate(`document.querySelectorAll('.card.info[aria-label="Network"] .mono').forEach(e => (e.textContent = "address hidden in this capture"))`);
  // an error toast from an earlier step may still be fading out
  await evaluate(`document.querySelector("#toast").className = "toast"`);
  const { result } = await send("Page.captureScreenshot", { format: "png" });
  await Bun.write(join(out!, name), await new Bun.Image(Buffer.from(result.data, "base64")).png({ palette: true, colors: 128 }).bytes());
};
const wait = (selector: string, ms = 20000) =>
  evaluate(`new Promise(ok => { const end = Date.now() + ${ms}; const t = setInterval(() => { const f = !!document.querySelector(${JSON.stringify(selector)}); if (f || Date.now() > end) { clearInterval(t); ok(f); } }, 50); })`);
const focus = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
const active = () =>
  evaluate(`(() => { const e = document.activeElement; return e.tagName + " " + JSON.stringify({ ...e.dataset }) + " " + (e.getAttribute("aria-label") || e.textContent.trim().slice(0, 30)); })()`);
const api = async (path: string, init?: RequestInit) => (await fetch(new URL(path, base!), init)).json() as Promise<any>;
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
const filesUnder = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name)) : [];
const checks: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean, detail = "") => {
  checks.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` | ${detail}` : ""}`);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const pad = { id: "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)", index: 0, connected: true, mapping: "standard", timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    window.__fake = false;
    const real = navigator.getGamepads.bind(navigator);
    navigator.getGamepads = () => (window.__fake ? [pad] : real());
    window.__press = (index, on = true) => { pad.buttons[index].pressed = on; pad.buttons[index].value = on ? 1 : 0; };
  })()`,
});

// state the flow needs: a second profile, no stale choice, motion and sounds at their defaults
// a fresh profile each run, so the first-play import is exercised every time
const sam = `Sam${Date.now().toString(36)}`;
await api("/api/profiles", { method: "POST", body: JSON.stringify({ name: sam }) });
await api("/api/settings/motion", { method: "PUT", body: JSON.stringify({ value: "system" }) });
await api("/api/settings/sounds", { method: "PUT", body: JSON.stringify({ value: "auto" }) });
await send("Page.navigate", { url: base! });
await wait("body[data-ready]");
await evaluate(`localStorage.removeItem("bunos.profile")`);
await send("Page.navigate", { url: base! });
await wait("body[data-ready]");
await evaluate("window.__fake = true");
await Bun.sleep(800);

// ---- 2. app tiles --------------------------------------------------------------------------------------
console.log("\n== app tiles");
const appTiles = await evaluate(`[...document.querySelectorAll("[data-app]")].map(e => e.textContent.trim().replace(/\\s+/g, " "))`);
check("a declared app shows as one tile", appTiles.length === 1, JSON.stringify(appTiles));
await shot("ui-home.png");
await focus("[data-app]");
await shot("ui-home-apps.png");
await press("Enter");
await Bun.sleep(900);
const running = await api("/api/running");
const appRun = running.find((item: any) => item.app);
check("Enter launches the app through the tracked spawn", Boolean(appRun), JSON.stringify(appRun));
check("the process exists on the host", Boolean(appRun) && existsSync(`/proc/${appRun.pid}`));
check("the tile says Running", (await evaluate(`document.querySelector("[data-app] .s").textContent`)) === "Running");
check("the status pill counts it", (await evaluate(`document.querySelector("#status").textContent`)).includes("1 running"));
await press("Enter");
await wait(".overlay.confirm", 3000);
check("a second Enter asks before stopping, Cancel focused first", (await active()).includes('"confirm":"no"'), await active());
await press("Enter");
await Bun.sleep(300);
check("Cancel keeps the app running", existsSync(`/proc/${appRun.pid}`));
await focus("[data-app]");
await press("Enter");
await wait(".overlay.confirm", 3000);
await focus('[data-confirm="yes"]');
await press("Enter");
await Bun.sleep(1200);
check("confirming stops the process", !existsSync(`/proc/${appRun.pid}`) || readFileSync(`/proc/${appRun.pid}/stat`, "utf8").split(") ")[1]?.startsWith("Z") === true);
const missing = await api("/api/apps/nope/launch", { method: "POST" });
check("an unknown app is refused", Boolean(missing.error), missing.error);

// ---- 1. game page ------------------------------------------------------------------------------------------
console.log("\n== game page");
await evaluate(`document.querySelector("[data-details]").focus()`);
await press("Enter");
console.log("game page:", await wait(".game-page"));
await Bun.sleep(500);
const heroButtons = await evaluate(`[...document.querySelectorAll(".game-hero .hero-actions button")].map(e => e.className.split(" ").includes("primary") ? "primary:" + e.textContent.trim() : e.textContent.trim())`);
check("one primary action (Play) in the hero", heroButtons.filter((text: string) => text.startsWith("primary")).length === 1 && heroButtons[0] === "primary:Play", JSON.stringify(heroButtons));
check("cover hero uses our homebrew capture", (await evaluate(`!!document.querySelector(".game-hero .hero-art img[src*='/cover']") && document.querySelector(".game-hero .hero-cover img")?.naturalWidth > 0`)) === true);
const shelves = await evaluate(`[...document.querySelectorAll(".game-page .shelf")].map(e => e.getAttribute("aria-label") + ":" + e.children.length)`);
check("related shelves are filled (same system, recently played)", shelves.length === 2 && shelves.every((text: string) => Number(text.split(":")[1]) > 0), JSON.stringify(shelves));
const meta = await evaluate(`document.querySelector("#plays").textContent`);
console.log("plays line:", meta);
const gameId = Number(await evaluate(`document.querySelector(".game-hero [data-play]").dataset.play`));
const before = (await api(`/api/games/${gameId}`)).favorite;
await focus('[data-action="fav-page"]');
await press("Enter");
await Bun.sleep(600);
const after = (await api(`/api/games/${gameId}`)).favorite;
check("favourite toggle persists on the server and flips aria-pressed", before !== after && (await evaluate(`document.querySelector('[data-action="fav-page"]').getAttribute("aria-pressed")`)) === String(Boolean(after)), `${before} -> ${after}; focus ${await active()}`);
await shot("ui-game-page.png");
await focus(".game-page .shelf .tile");
await Bun.sleep(300);
await shot("ui-game-page-related.png");
await focus('[data-action="fav-page"]');
await press("Enter"); // toggle back so the library is left as found
await Bun.sleep(400);
await focus(".game-page .shelf .tile");
await press("Enter");
await Bun.sleep(700);
const secondId = Number(await evaluate(`document.querySelector(".game-hero [data-play]").dataset.play`));
check("a related tile opens another game page", secondId !== gameId, `${gameId} -> ${secondId}`);
await press("Escape");
await Bun.sleep(500);
check("Back returns to the first game page", Number(await evaluate(`document.querySelector(".game-hero [data-play]")?.dataset.play`)) === gameId);
await press("Escape");
await Bun.sleep(500);
check("Back again returns home", (await evaluate(`!!document.querySelector(".hero [data-play]") && !document.querySelector(".game-page")`)) === true, await active());

// ---- 3. sounds -------------------------------------------------------------------------------------------------
console.log("\n== sounds");
const cues = await evaluate(`Promise.all(["focus", "select", "back", "error"].map(c => bunosSounds.render(c)))`);
for (const cue of cues) console.log("  ", JSON.stringify(cue));
check("every cue renders audible but quiet audio (peak 0.005 to 0.09, under 0.25 s)", cues.every((c: any) => c.peak > 0.005 && c.peak <= 0.09 && c.seconds < 0.25));
const config0 = (await api("/api/session")).config;
check("default is Automatic", config0.sounds === "auto", JSON.stringify(config0));
check("Automatic plays when motion is not reduced", (await evaluate(`bunosSounds.mode().on`)) === true);
const heard0 = (await evaluate(`bunosSounds.heard().length`)) as number;
await focus(".hero [data-play]");
await press("ArrowDown");
await Bun.sleep(150);
await press("ArrowRight");
await Bun.sleep(150);
const heard1 = (await evaluate(`bunosSounds.heard()`)) as string[];
check("moving focus plays the focus cue", heard1.length > heard0 && heard1.includes("focus"), heard1.join(","));
await api("/api/settings/motion", { method: "PUT", body: JSON.stringify({ value: "reduced" }) });
await send("Page.navigate", { url: base! });
await wait("body[data-ready]");
await evaluate("window.__fake = true");
check("reduced motion turns Automatic off", (await evaluate(`bunosSounds.mode().on`)) === false);
await focus(".hero [data-play]");
await press("ArrowDown");
await Bun.sleep(150);
check("and nothing plays", (await evaluate(`bunosSounds.heard().length`)) === 0);
await api("/api/settings/sounds", { method: "PUT", body: JSON.stringify({ value: "on" }) });
await send("Page.navigate", { url: base! });
await wait("body[data-ready]");
check("On overrides reduced motion and survives a reload (shell.db key)", (await evaluate(`bunosSounds.mode().on`)) === true && (await api("/api/session")).config.sounds === "on");
await api("/api/settings/sounds", { method: "PUT", body: JSON.stringify({ value: "off" }) });
await api("/api/settings/motion", { method: "PUT", body: JSON.stringify({ value: "system" }) });
await send("Page.navigate", { url: base! });
await wait("body[data-ready]");
await evaluate("window.__fake = true");
await focus(".hero [data-play]");
await press("ArrowDown");
await Bun.sleep(150);
check("Off is silent", (await evaluate(`bunosSounds.mode().on`)) === false && (await evaluate(`bunosSounds.heard().length`)) === 0);
await api("/api/settings/sounds", { method: "PUT", body: JSON.stringify({ value: "auto" }) });

// ---- 4 + 5. power menu and settings panels ----------------------------------------------------------------------
console.log("\n== power menu and settings panels");
await send("Page.navigate", { url: base! });
await wait("body[data-ready]");
await evaluate("window.__fake = true");
await evaluate(`document.querySelector(".power-btn").focus()`);
await press("Enter");
await wait(".overlay.power", 3000);
const sleepItem = await evaluate(`(() => { const e = document.querySelector("[data-power=sleep]"); return { disabled: e.getAttribute("aria-disabled"), text: e.textContent.trim().replace(/\\s+/g, " ") }; })()`);
console.log("sleep entry:", JSON.stringify(sleepItem));
const host = await api("/api/host");
check("the power menu says whether Sleep works, with the host's reason when not", sleepItem.disabled === String(!host.sleep.available) && (host.sleep.available || sleepItem.text.includes(host.sleep.reason)));
await shot("ui-power-sleep-na.png");
await focus("[data-power=sleep]");
await press("Enter");
await Bun.sleep(500);
if (!host.sleep.available)
  check(
    "an unavailable Sleep shows its reason and nothing goes dark",
    (await evaluate(`document.querySelector("#toast").textContent`)).includes("not available") && !(await evaluate(`!!document.querySelector("#sleep-cover")`)),
  );
await press("Escape");
await evaluate(`document.querySelector("[data-tab=settings]").click()`);
await wait(".settings .card.info");
await Bun.sleep(900);
const refresh = await evaluate(`document.querySelector("#refresh-rate").textContent`);
const panels = await evaluate(`[...document.querySelectorAll(".card.info")].map(card => ({ title: card.querySelector("h2").textContent, na: !!card.querySelector(".na"), controls: card.querySelectorAll("button, [role=switch], input").length }))`);
console.log("panels:", JSON.stringify(panels), "| refresh:", refresh);
check("display, audio, network, storage and controller panels exist", ["Display", "Audio", "Network", "Storage", "Controllers"].every(name => panels.some((p: any) => p.title === name)));
const audioText = await evaluate(`document.querySelector('.card.info[aria-label="Audio"]').textContent`);
check("audio lists exactly the sinks the host reports (or says it has none)", host.audio.available ? host.audio.sinks.every((sink: any) => audioText.includes(sink.name)) : audioText.includes("Not available"), host.audio.available ? host.audio.sinks.map((sink: any) => sink.name).join(", ") : host.audio.reason);
const padText = await evaluate(`document.querySelector('.card.info[aria-label="Controllers"]').textContent`);
check("controllers lists the pad the browser reports", padText.includes("Xbox 360") || padText.includes("No controller reported"), padText.slice(0, 90));
check("no panel offers a control that is not backed by anything", panels.every((p: any) => p.controls === 0));
check("a missing source shows the designed not-available state", panels.some((p: any) => p.na) === [host.display, host.audio, host.network, host.storage].some(s => !s.available), JSON.stringify([host.display.available, host.audio.available, host.network.available, host.storage.available]));
const display = await evaluate(`document.querySelector(".card.info").textContent`);
check("display shows the browser resolution and scale", display.includes("1280 × 720") && display.includes("1× scale"), display.slice(0, 120));
check("measured refresh rate is a real number", /\d+ Hz/.test(refresh), refresh);
// the page's numbers against `df` (within 64 MiB: other jobs write to the shared disks while this runs)
const volumes = host.storage.available ? host.storage.volumes : [];
const agree = await Promise.all(
  volumes.map(async (volume: any) => {
    const [avail, size] = (await $`df -B1 --output=avail,size ${volume.paths[0]}`.text()).trim().split("\n").at(-1)!.trim().split(/\s+/).map(Number);
    return Math.abs(avail! - volume.freeBytes) < 64 * 2 ** 20 && size === volume.totalBytes;
  }),
);
check("storage free space and size match df for every volume", volumes.length > 0 && agree.every(Boolean), volumes.map((volume: any) => `${volume.labels.join("+")}: ${Math.round(volume.freeBytes / 2 ** 30)} GiB free`).join("; "));
const meters = await evaluate(`[...document.querySelectorAll(".meter")].map(m => m.getAttribute("aria-valuenow"))`);
check("each volume has a meter with a real percentage", meters.length === volumes.length && meters.every((value: string) => value !== null && Number(value) >= 0 && Number(value) <= 100), meters.join(","));
// SHOT_SUFFIX=-na for a second run on a host without a sound server: the same page in its "not available" state
const suffix = process.env.SHOT_SUFFIX ?? "";
await focus('.card.info[aria-label="Display"]');
await shot(`ui-settings-display${suffix}.png`, true);
await focus('.card.info[aria-label="Audio"]');
await shot(`ui-settings-audio${suffix}.png`, true);
await focus('.card.info[aria-label="Storage"]');
await shot(`ui-settings-host${suffix}.png`, true);

// ---- 6. per-profile saves --------------------------------------------------------------------------------------------
console.log("\n== per-profile saves");
const legacyStates = filesUnder(join(retroarch, "states"));
const legacyBefore = legacyStates.map(path => [path, sha(path)] as const);
console.log("shared states before:", legacyStates.length, legacyStates.map(path => path.replace(retroarch, "")).join(" "));
await evaluate(`localStorage.setItem("bunos.profile", ${JSON.stringify(sam)})`);
await send("Page.navigate", { url: base! });
await wait("body[data-ready]");
await evaluate("window.__fake = true");
await Bun.sleep(500);
const lan = (await api("/api/systems/nes/games")).find((game: any) => game.name === "LanMaster");
await evaluate(`document.querySelector("[data-tab=systems]").click()`);
await wait(".system");
await evaluate(`document.querySelector('[data-system="nes"]').click()`);
await wait(`[data-game="${lan.id}"]`);
await focus(`[data-game="${lan.id}"]`);
await press("Enter");
console.log("player:", await wait("iframe.player", 30000));
await Bun.sleep(5000);
const dirs = join(retroarch, "profiles", sam);
check("first play by a new profile sets up his folders", existsSync(join(dirs, "states")) && existsSync(join(dirs, "screenshots")) && existsSync(join(dirs, ".imported-from-shared")));
const imported = filesUnder(join(dirs, "states"));
check("older shared states were copied in and match", legacyBefore.every(([path, hash]) => imported.some(file => file.endsWith(path.slice(join(retroarch, "states").length)) && sha(file) === hash)), `${imported.length} files`);
await press("F1");
await wait(".overlay.quick", 3000);
await Bun.sleep(900);
const startedAt = Date.now();
for (const action of ["save", "screenshot", "load"]) {
  await focus(`[data-q=${action}]`);
  await press("Enter");
  await Bun.sleep(1500);
  console.log("  ", action, "->", await evaluate(`document.querySelector("#quick-log").textContent`));
}
const newStates = filesUnder(join(dirs, "states")).filter(file => statSync(file).mtimeMs >= startedAt - 500 && !file.endsWith(".png"));
const newShots = filesUnder(join(dirs, "screenshots")).filter(file => statSync(file).mtimeMs >= startedAt - 500);
check("Save state wrote into the profile's folder", newStates.length > 0, newStates.map(file => file.replace(retroarch, "")).join(" "));
check("Screenshot wrote into the profile's folder", newShots.length > 0, newShots.map(file => file.replace(retroarch, "")).join(" "));
const untouched = (dir: string) => filesUnder(dir).every(path => statSync(path).mtimeMs < startedAt - 500);
check("nothing was written to the shared folders or to the default profile", untouched(join(retroarch, "states")) && untouched(join(retroarch, "screenshots")) && untouched(join(retroarch, "profiles", "default")));
check("the shared files are byte-identical to before", legacyBefore.every(([path, hash]) => sha(path) === hash));
check("Load state loaded the profile's state", (await evaluate(`document.querySelector("#quick-log").textContent`)).includes("loaded"));
await focus("[data-q=resume]");
await press("Enter");
await Bun.sleep(400);
await press("Escape");
await Bun.sleep(1500);
await evaluate(`document.querySelector("[data-details]")?.focus()`);
const page = await api(`/api/games/${lan.id}/page?profile=${sam}`);
console.log("saves summary for the new profile:", JSON.stringify(page.saves));
check("the game page counts the profile's saves", page.saves.states >= 1 && page.saves.screenshots >= 1 && page.saves.shared === false);
const other = await api(`/api/games/${lan.id}/page?profile=NeverPlayed`);
check("a profile that never played sees the shared saves as readable", other.saves.shared === true && other.saves.states >= 1, JSON.stringify(other.saves));
await evaluate(`localStorage.removeItem("bunos.profile")`);

const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? `; failed: ${failed.map(([name]) => name).join("; ")}` : ""}`);
ws.close();
process.exit(failed.length ? 1 : 0);
