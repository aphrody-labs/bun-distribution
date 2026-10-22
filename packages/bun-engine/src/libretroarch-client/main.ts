/// <reference types="@webgpu/types" />
// Page side of libretroarch-serve: presents frames with WebGPU, plays audio through an
// AudioWorklet and sends the standard gamepad (or the keyboard) as RetroPad bits.
import {
  decodeFrame,
  Message,
  AUDIO_HEADER,
  RetroArchPresenter,
  type PresentableFrame,
} from "../libretroarch-gpu";

const canvas = document.querySelector<HTMLCanvasElement>("#screen")!;
const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) throw new Error("WebGPU unavailable");
const device = await adapter.requestDevice();
const context = canvas.getContext("webgpu")!;
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: "opaque" });
const presenter = new RetroArchPresenter(device, format);

let pending: PresentableFrame | undefined;
let frames = 0;

// Audio: a ring in the worklet, fed by posted chunks; underruns play silence.
const WORKLET = `
class Ring extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(1 << 15);
    this.read = 0;
    this.write = 0;
    this.port.onmessage = (e) => {
      const s = e.data, n = this.ring.length;
      for (let i = 0; i < s.length; i++) this.ring[(this.write + i) % n] = s[i];
      this.write = (this.write + s.length) % n;
    };
  }
  process(_in, [out]) {
    const n = this.ring.length, l = out[0], r = out[1] ?? out[0];
    for (let i = 0; i < l.length; i++) {
      if (this.read === this.write) { l[i] = r[i] = 0; continue; }
      l[i] = this.ring[this.read];
      r[i] = this.ring[(this.read + 1) % n];
      this.read = (this.read + 2) % n;
    }
    return true;
  }
}
registerProcessor("retroarch-ring", Ring);
`;
let audio: { context: AudioContext; node: AudioWorkletNode; gain: GainNode } | undefined;
// the quick menu's volume, 0..1 (kept here so it also applies to audio that starts later)
let volume = 1;
let audioStarting = false;

async function startAudio(rate: number) {
  audioStarting = true;
  const audioContext = new AudioContext({ sampleRate: rate });
  const url = URL.createObjectURL(
    new Blob([WORKLET], { type: "text/javascript" }),
  );
  await audioContext.audioWorklet.addModule(url);
  const node = new AudioWorkletNode(audioContext, "retroarch-ring", {
    outputChannelCount: [2],
  });
  const gain = audioContext.createGain();
  gain.gain.value = volume;
  node.connect(gain).connect(audioContext.destination);
  audio = { context: audioContext, node, gain };
  window.addEventListener("pointerdown", () => audioContext.resume(), {
    once: true,
  });
  window.addEventListener("keydown", () => audioContext.resume(), {
    once: true,
  });
}

const ws = new WebSocket(new URL("/ws", location.href.replace(/^http/, "ws")));
ws.binaryType = "arraybuffer";
// Embedded in the frontend, the parent window owns the quick menu: this page forwards the menu
// requests (F1, pad Guide, Select+R3) and carries out its actions over the RetroArch socket.
const embedded = window.parent !== window;
let menuOpen = false;
const toParent = (message: object) => embedded && window.parent.postMessage({ bunos: true, ...message }, "*");
ws.onmessage = ({ data }) => {
  if (typeof data === "string") {
    const reply = JSON.parse(data) as { type: string; id?: number; paused?: boolean; ok?: boolean; line?: string; text?: string };
    if (reply.type === "paused") toParent({ type: "paused", paused: reply.paused });
    else if (reply.type === "result") toParent({ type: "result", id: reply.id, line: reply.line, ok: reply.ok, text: reply.text });
    return;
  }
  const message = data as ArrayBuffer;
  const kind = new Uint8Array(message, 0, 1)[0];
  if (kind === Message.Frame) pending = decodeFrame(message);
  else if (kind === Message.Audio) {
    const rate = new DataView(message).getUint32(4, true);
    if (!audio && !audioStarting) void startAudio(rate);
    audio?.node.port.postMessage(new Float32Array(message, AUDIO_HEADER));
  }
};

// RetroPad bits indexed by the standard gamepad mapping's buttons.
const STANDARD = [
  1 << 0, // south: B
  1 << 8, // east: A
  1 << 1, // west: Y
  1 << 9, // north: X
  1 << 10, // L
  1 << 11, // R
  1 << 12, // L2
  1 << 13, // R2
  1 << 2, // select
  1 << 3, // start
  1 << 14, // L3
  1 << 15, // R3
  1 << 4, // up
  1 << 5, // down
  1 << 6, // left
  1 << 7, // right
];
const KEYS: Record<string, number> = {
  KeyZ: 1 << 0,
  KeyX: 1 << 8,
  KeyA: 1 << 1,
  KeyS: 1 << 9,
  KeyQ: 1 << 10,
  KeyW: 1 << 11,
  ShiftRight: 1 << 2,
  Enter: 1 << 3,
  ArrowUp: 1 << 4,
  ArrowDown: 1 << 5,
  ArrowLeft: 1 << 6,
  ArrowRight: 1 << 7,
};
let keys = 0;
window.addEventListener("keydown", (e) => {
  // embedded in the frontend: Escape returns to the library, F1 opens the quick menu
  if (e.code === "Escape" && embedded) window.parent.postMessage("retroarch-exit", "*");
  if (e.code === "F1" && embedded) {
    e.preventDefault();
    toParent({ type: "menu" });
  }
  if (!menuOpen) keys |= KEYS[e.code] ?? 0;
});
window.addEventListener("keyup", (e) => (keys &= ~(KEYS[e.code] ?? 0)));

const sent = new Map<number, string>();
let menuHeld = false;
function pollInput() {
  if (ws.readyState !== WebSocket.OPEN) return;
  const pads = navigator.getGamepads();
  // Guide / Home (button 16) or Select + R3 asks the frontend for its quick menu
  const asking = pads.some((pad) => pad?.buttons[16]?.pressed || (pad?.buttons[8]?.pressed && pad.buttons[11]?.pressed));
  if (asking && !menuHeld && !menuOpen) toParent({ type: "menu" });
  menuHeld = asking;
  for (let port = 0; port < Math.max(1, pads.length); port++) {
    const pad = pads[port];
    let buttons = port === 0 && !menuOpen ? keys : 0;
    const axes: number[] = [];
    if (pad?.mapping === "standard" && !menuOpen) {
      pad.buttons.forEach((b, i) => b.pressed && (buttons |= STANDARD[i] ?? 0));
      for (let i = 0; i < 4; i++)
        axes.push(Math.round((pad.axes[i] ?? 0) * 0x7fff));
      axes.push(
        Math.round((pad.buttons[6]?.value ?? 0) * 0x7fff),
        Math.round((pad.buttons[7]?.value ?? 0) * 0x7fff),
      );
    }
    const state = `${buttons}:${axes}`;
    if (sent.get(port) === state) continue;
    sent.set(port, state);
    ws.send(JSON.stringify({ type: "joypad", port, buttons, axes }));
  }
}

function render() {
  const width = Math.round(canvas.clientWidth * devicePixelRatio);
  const height = Math.round(canvas.clientHeight * devicePixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  pollInput();
  if (pending) {
    presenter.upload(pending);
    pending = undefined;
    frames++;
  }
  presenter.present(context);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// Quick-menu requests from the frontend window (checked against our parent in the handler).
window.addEventListener("message", ({ source, data }) => {
  if (source !== window.parent || !data?.bunos) return;
  const send = (message: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(message));
  switch (data.action) {
    case "open": // pause the core and stop feeding it input while the menu is up
      menuOpen = true;
      keys = 0;
      send({ type: "pause", paused: true });
      break;
    case "close": // buttons held for the menu must not reach the game: release input first
      send({ type: "pause", paused: false });
      setTimeout(() => (menuOpen = false), 250);
      break;
    case "save":
      send({ type: "command", line: "SAVE_STATE", id: data.id });
      break;
    case "load":
      send({ type: "command", line: "LOAD_STATE", id: data.id });
      break;
    case "screenshot":
      send({ type: "command", line: "SCREENSHOT", id: data.id });
      break;
    case "volume":
      volume = Math.min(1, Math.max(0, Number(data.value)));
      if (audio) audio.gain.gain.value = volume;
      toParent({ type: "volume", value: volume });
      break;
  }
});

/** For automation: frames presented, a command sender and an offscreen readback summary. */
Object.assign(globalThis, {
  retroarch: {
    adapter: adapter.info.description || adapter.info.vendor,
    frames: () => frames,
    command: (line: string) =>
      ws.send(JSON.stringify({ type: "command", line })),
    async capture(width = presenter.width, height = presenter.height) {
      const rgba = await presenter.capture(width, height);
      const colors = new Set<number>();
      let lit = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        const c = rgba[i]! | (rgba[i + 1]! << 8) | (rgba[i + 2]! << 16);
        if (c) lit++;
        colors.add(c);
      }
      return { width, height, lit, colors: colors.size };
    },
  },
});
