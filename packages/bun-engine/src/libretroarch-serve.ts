// Runs RetroArch in this process and streams it to a WebGPU page: frames when their serial
// changes and audio chunks go out over one WebSocket, pads and commands come back.
import type { ServerWebSocket } from "bun";
import page from "./libretroarch-client/index.html";
import { AUDIO_HEADER, FRAME_HEADER, Message } from "./libretroarch-gpu";
import { RetroArch, type OpenOptions } from "./libretroarch";

export interface ServeOptions extends OpenOptions {
  port?: number;
  hostname?: string;
}

type ClientMessage =
  | { type: "joypad"; port: number; buttons: number; axes?: number[] }
  | { type: "command"; line: string };

export function serveRetroArch(options: ServeOptions = {}) {
  const ra = RetroArch.open(options);
  const clients = new Set<ServerWebSocket<unknown>>();
  const samples = new Float32Array(16384);
  let lastSerial = -1n;
  let running = true;

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
        else if (message.type === "command") ra.command(message.line);
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
