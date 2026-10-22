// Runs RetroArch in this process and streams it to a WebGPU page: frames when their serial
// changes and audio chunks go out over one WebSocket, pads and commands come back.
import type { ServerWebSocket } from "bun";
import page from "./libretroarch-client/index.html";
import { AUDIO_HEADER, FRAME_HEADER, Message } from "./libretroarch-gpu";
import { statSync } from "node:fs";
import { join } from "node:path";
import { RetroArch, type OpenOptions } from "./libretroarch";
import { prepareProfileSaves } from "./frontend/saves";
import { usrRoot } from "./usr";

export interface ServeOptions extends OpenOptions {
  port?: number;
  hostname?: string;
  /** The frontend profile playing: states and screenshots go to its own folders (see frontend/saves.ts). */
  profile?: string;
}

type ClientMessage =
  | { type: "joypad"; port: number; buttons: number; axes?: number[] }
  | { type: "command"; line: string; id?: number }
  | { type: "pause"; paused: boolean };

export function serveRetroArch(options: ServeOptions = {}) {
  const home = options.home ?? join(usrRoot(), "var", "lib", "bep", "libretroarch");
  // a profile plays into its own states/screenshots folders; without one the shared folders stay in use
  const saves = options.profile ? prepareProfileSaves(home, options.profile) : undefined;
  const ra = RetroArch.open(
    saves
      ? { ...options, config: { ...options.config, savestate_directory: saves.states, screenshot_directory: saves.screenshots } }
      : options,
  );
  const clients = new Set<ServerWebSocket<unknown>>();
  const samples = new Float32Array(16384);
  let lastSerial = -1n;
  let running = true;
  const folders = { states: saves?.states ?? join(home, "states"), screenshots: saves?.screenshots ?? join(home, "screenshots") };
  // The newest file RetroArch wrote under the states/screenshots folder since `since`: the proof
  // a quick-menu action did something, since SAVE_STATE and SCREENSHOT answer nothing themselves.
  function written(sub: "states" | "screenshots", since: number): string | undefined {
    const dir = folders[sub];
    let best: { file: string; time: number } | undefined;
    for (const file of new Bun.Glob("**/*").scanSync({ cwd: dir, onlyFiles: true })) {
      if (sub === "states" && file.endsWith(".png")) continue;
      const time = statSync(join(dir, file)).mtimeMs;
      if (time >= since && (!best || time > best.time)) best = { file, time };
    }
    return best?.file;
  }

  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    routes: { "/": page },
    fetch(request, server) {
      if (new URL(request.url).pathname === "/ws" && server.upgrade(request))
        return;
      return new Response("not found", { status: 404 });
    },
    websocket: {
      // retro frames are flat colour: deflate shrinks them several times over
      perMessageDeflate: true,
      open(ws) {
        clients.add(ws);
        lastSerial = -1n;
      },
      close(ws) {
        clients.delete(ws);
      },
      message(_ws, raw) {
        const message = JSON.parse(String(raw)) as ClientMessage;
        if (message.type === "joypad")
          ra.joypad(message.port, message.buttons, message.axes);
        else if (message.type === "command") {
          const line = message.line.trim().toUpperCase();
          const since = Date.now() - 50;
          const sub = line === "SAVE_STATE" ? "states" : line === "SCREENSHOT" ? "screenshots" : undefined;
          if (line === "LOAD_STATE" && !new Bun.Glob("**/*").scanSync({ cwd: folders.states }).next().value) {
            _ws.send(JSON.stringify({ type: "result", id: message.id, line, ok: false, text: "no saved state yet" }));
            return;
          }
          ra.command(message.line);
          // the reply (status) reaches the sender a moment later; files are checked after RetroArch wrote them
          setTimeout(() => {
            if (!running) return;
            _ws.send(JSON.stringify({ type: "reply", id: message.id, line: message.line, text: ra.replies() }));
            if (sub) {
              const file = written(sub, since);
              _ws.send(JSON.stringify({ type: "result", id: message.id, line, ok: Boolean(file), text: file ?? "nothing was written" }));
            } else if (line === "LOAD_STATE") _ws.send(JSON.stringify({ type: "result", id: message.id, line, ok: true, text: "state loaded" }));
          }, sub ? 600 : 150);
        } else if (message.type === "pause") {
          if (message.paused !== ra.status().paused) ra.command("PAUSE_TOGGLE");
          // report what RetroArch says after it applied the toggle, not what was asked
          setTimeout(() => running && _ws.send(JSON.stringify({ type: "paused", paused: ra.status().paused })), 120);
        }
      },
    },
  });

  // a client that falls behind drops frames instead of queueing them
  const BACKLOG = 4 << 20;
  function send(bytes: Uint8Array, droppable = false) {
    for (const ws of clients)
      if (!droppable || ws.getBufferedAmount() < BACKLOG)
        ws.sendBinary(bytes, true);
  }

  function step() {
    if (!running) return;
    if (!ra.iterate()) return stop();
    const frame = ra.frame();
    if (clients.size && frame && frame.serial !== lastSerial) {
      lastSerial = frame.serial;
      const out = new Uint8Array(FRAME_HEADER + frame.data.byteLength);
      const view = new DataView(out.buffer);
      view.setUint8(0, Message.Frame);
      view.setUint8(1, frame.format);
      view.setUint32(4, frame.width, true);
      view.setUint32(8, frame.height, true);
      view.setUint32(12, frame.pitch, true);
      view.setBigUint64(16, frame.serial, true);
      out.set(frame.data, FRAME_HEADER);
      send(out, true);
    }
    const audio = ra.audio(samples);
    if (clients.size && audio.length) {
      const out = new Uint8Array(AUDIO_HEADER + audio.byteLength);
      const view = new DataView(out.buffer);
      view.setUint8(0, Message.Audio);
      view.setUint32(4, ra.status().audioRate, true);
      out.set(
        new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength),
        AUDIO_HEADER,
      );
      send(out);
    }
  }

  // The host paces: one iterate per core frame on a drift-free clock. The rate follows the
  // running core, which can change from the menu.
  let next = performance.now();
  let timer: Timer | undefined;
  function tick() {
    step();
    if (!running) return;
    const period = 1000 / (ra.status().fps || 60);
    next += period;
    const now = performance.now();
    if (next < now - period * 4) next = now;
    timer = setTimeout(tick, Math.max(0, next - now));
  }
  tick();

  function stop() {
    if (!running) return;
    running = false;
    clearTimeout(timer);
    server.stop(true);
    ra.close();
  }

  return { url: server.url, retroarch: ra, stop };
}
