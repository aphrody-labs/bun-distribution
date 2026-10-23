/**
 * Bun OS gamestream browser client: WebRTC receive, WebGPU presentation with FSR1 upscaling,
 * input over a data channel. Falls back to a plain <video> element without WebGPU.
 */
import type { InputMessage, SenderInfo, SenderStats, ServerMessage } from "../protocol.ts";
import { captureInput, type InputCounters } from "./input.ts";
import { type UpscaleMode, WebGpuPresenter } from "./renderer.ts";
import { createTestSource } from "./test-source.ts";

declare class MediaStreamTrackProcessor {
  constructor(init: { track: MediaStreamTrack; maxBufferSize?: number });
  readonly readable: ReadableStream<VideoFrame>;
}

interface ClientState {
  phase: "connecting" | "playing" | "unavailable" | "diagnostic";
  path: "pending" | "webgpu-trackprocessor" | "webgpu-videoframecallback" | "video-fallback";
  source: "webrtc" | "test";
  adapter: string;
  upscale: UpscaleMode;
  framesPresented: number;
  presentFps: number;
  frameSize: string;
  canvasSize: string;
  sender: SenderInfo | null;
  server: SenderStats | null;
  receiver: Record<string, number | string>;
  rttMs: number | null;
  inputSent: number;
  ice: string;
  errors: string[];
}

const query = new URLSearchParams(location.search);
const state: ClientState = {
  phase: "connecting",
  path: "pending",
  source: "webrtc",
  adapter: "",
  upscale: query.get("upscale") === "bilinear" ? "bilinear" : "fsr",
  framesPresented: 0,
  presentFps: 0,
  frameSize: "",
  canvasSize: "",
  sender: null,
  server: null,
  receiver: {},
  rttMs: null,
  inputSent: 0,
  ice: "new",
  errors: [],
};
(globalThis as unknown as { gamestream: ClientState }).gamestream = state;
let lastFrame: VideoFrame | null = null;
let halted = false;

/** Console qualification hook: average GPU presentation cost per frame for both upscalers. */
(
  globalThis as unknown as {
    gamestreamBenchmark: () => Promise<Record<string, number>>;
  }
).gamestreamBenchmark = async () => {
  if (!presenter || !lastFrame) throw new Error("no WebGPU frame presented yet");
  const frame = lastFrame.clone();
  const mode = presenter.mode;
  try {
    presenter.mode = "fsr";
    const fsr = await presenter.benchmark(frame);
    presenter.mode = "bilinear";
    const bilinear = await presenter.benchmark(frame);
    return {
      fsrMs: Math.round(fsr * 1000) / 1000,
      bilinearMs: Math.round(bilinear * 1000) / 1000,
    };
  } finally {
    presenter.mode = mode;
    frame.close();
  }
};

const stage = document.getElementById("stage") as HTMLDivElement;
const canvas = document.getElementById("view") as HTMLCanvasElement;
const video = document.getElementById("fallback") as HTMLVideoElement;
const audio = document.getElementById("audio") as HTMLAudioElement;
const hud = document.getElementById("hud") as HTMLPreElement;
const status = document.getElementById("status") as HTMLDivElement;

function fail(message: string): void {
  state.errors.push(message);
  console.error(`[gamestream] ${message}`);
  status.textContent = message;
}

// ---------------------------------------------------------------------------------------------
// Layout: fit the stream aspect ratio in the window, canvas in device pixels.
// ---------------------------------------------------------------------------------------------
function layout(): void {
  const aspect = state.sender ? state.sender.width / state.sender.height : 16 / 9;
  let width = innerWidth;
  let height = width / aspect;
  if (height > innerHeight) {
    height = innerHeight;
    width = height * aspect;
  }
  for (const element of [canvas, video]) {
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }
  canvas.width = Math.round(width * devicePixelRatio);
  canvas.height = Math.round(height * devicePixelRatio);
  state.canvasSize = `${canvas.width}x${canvas.height}`;
}
window.addEventListener("resize", layout);
layout();

// ---------------------------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------------------------
let presenter: WebGpuPresenter | null = null;
try {
  presenter = await WebGpuPresenter.create(canvas, state.upscale, Number(query.get("sharpness") ?? 0.2));
  state.adapter = presenter.adapterInfo;
  console.log(`[gamestream] WebGPU adapter: ${presenter.adapterInfo || "unknown"} (${presenter.canvasFormat})`);
} catch (error) {
  console.warn(`[gamestream] WebGPU unavailable, using <video>: ${String(error)}`);
}

const pictureElement = (): HTMLElement => (canvas.hidden ? video : canvas);

function presented(width: number, height: number): void {
  state.framesPresented++;
  state.frameSize = `${width}x${height}`;
}

async function pumpTrackProcessor(track: MediaStreamTrack, gpu: WebGpuPresenter): Promise<void> {
  const reader = new MediaStreamTrackProcessor({
    track,
    maxBufferSize: 1,
  }).readable.getReader();
  for (;;) {
    const { value: frame, done } = await reader.read();
    if (done || !frame) return;
    if (halted) {
      frame.close();
      await reader.cancel();
      return;
    }
    gpu.draw(frame);
    presented(frame.displayWidth, frame.displayHeight);
    lastFrame?.close();
    lastFrame = frame;
  }
}

function pumpVideoFrames(gpu: WebGpuPresenter): void {
  const onFrame: VideoFrameRequestCallback = (_now, meta) => {
    if (halted) return;
    gpu.draw(video);
    presented(meta.width, meta.height);
    video.requestVideoFrameCallback(onFrame);
  };
  video.requestVideoFrameCallback(onFrame);
}

function present(track: MediaStreamTrack, stream: MediaStream): void {
  if (halted) {
    track.stop();
    return;
  }
  state.phase = state.source === "test" ? "diagnostic" : "playing";
  status.textContent = state.source === "test" ? "Diagnostic test pattern · no game session" : "Live remote session";
  track.addEventListener(
    "ended",
    () => {
      if (state.source !== "test") unavailable("The remote video stream has stopped.");
    },
    { once: true },
  );
  if (!presenter) {
    state.path = "video-fallback";
    video.hidden = false;
    canvas.hidden = true;
    video.srcObject = stream;
    void video.play();
    return;
  }
  if (typeof MediaStreamTrackProcessor === "function" && query.get("source") !== "video") {
    state.path = "webgpu-trackprocessor";
    void pumpTrackProcessor(track, presenter).catch(error =>
      unavailable(`Remote frame presentation stopped: ${String(error)}`),
    );
  } else {
    state.path = "webgpu-videoframecallback";
    video.srcObject = stream;
    void video.play();
    pumpVideoFrames(presenter);
  }
  console.log(`[gamestream] presenting through ${state.path} (${state.upscale})`);
}

// ---------------------------------------------------------------------------------------------
// Signalling and WebRTC
// ---------------------------------------------------------------------------------------------
const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
const pc = new RTCPeerConnection({
  iceServers: [],
  bundlePolicy: "max-bundle",
});
let channel: RTCDataChannel | null = null;
let counters: InputCounters | null = null;

function unavailable(message: string): void {
  if (state.source === "test" || state.phase === "unavailable") return;
  halted = true;
  state.phase = "unavailable";
  fail(message);
  channel?.close();
  pc.close();
  for (const element of [video, audio]) {
    const stream = element.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
    element.pause();
    element.srcObject = null;
  }
  lastFrame?.close();
  lastFrame = null;
  canvas.hidden = true;
  video.hidden = true;
}
status.textContent = "Connecting to the remote streaming host…";

const sendInput = (message: InputMessage) => {
  if (channel?.readyState === "open") channel.send(JSON.stringify(message));
};

pc.ontrack = event => {
  if (halted) {
    event.track.stop();
    return;
  }
  const receiver = event.receiver as RTCRtpReceiver & {
    jitterBufferTarget?: number;
    playoutDelayHint?: number;
  };
  if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = 0;
  if ("playoutDelayHint" in receiver) receiver.playoutDelayHint = 0;
  const stream = event.streams[0] ?? new MediaStream([event.track]);
  if (event.track.kind === "video") {
    present(event.track, stream);
  } else {
    audio.srcObject = new MediaStream([event.track]);
    void audio.play().catch(() => undefined);
  }
};
pc.ondatachannel = event => {
  channel = event.channel;
  channel.onopen = () => {
    console.log("[gamestream] input channel open");
    counters ??= captureInput(stage, pictureElement, sendInput);
  };
  channel.onmessage = event => {
    const message = JSON.parse(String(event.data)) as { t: string; ts: number };
    if (message.t === "pong") state.rttMs = Math.round((performance.now() - message.ts) * 10) / 10;
  };
};
pc.onicecandidate = event => {
  if (event.candidate?.candidate && socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: "ice",
        candidate: event.candidate.candidate,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      }),
    );
  }
};
pc.oniceconnectionstatechange = () => {
  state.ice = pc.iceConnectionState;
  if (state.source !== "test" && ["failed", "disconnected"].includes(state.ice))
    unavailable("The remote stream connection is unavailable. Reload to reconnect.");
};

/** Local qualification without a streaming host: same presentation and input paths. */
function startTestSource(): void {
  if (query.get("source") !== "test") throw new Error("Diagnostic test source requires explicit ?source=test");
  state.source = "test";
  state.phase = "diagnostic";
  state.sender = {
    width: 1280,
    height: 720,
    fps: 60,
    codec: "local canvas",
    bitrateKbps: 0,
    encoderThreads: 0,
  };
  layout();
  status.textContent = "Diagnostic test pattern · no game session";
  document.title = "Gamestream diagnostics · synthetic test pattern";
  const test = createTestSource();
  present(test.track, test.stream);
  counters = captureInput(stage, pictureElement, message => {
    const values = Object.entries(message)
      .filter(([key]) => key !== "t")
      .map(([, value]) => (typeof value === "number" ? Math.round(value * 1000) / 1000 : String(value)));
    if (message.t !== "ping") test.note(`${message.t} ${values.join(" ")}`);
  });
  console.log("[gamestream] local test source active");
}

socket.onmessage = async event => {
  try {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (state.source === "test") return;
    switch (message.type) {
      case "hello":
        state.sender = message.sender;
        layout();
        if (!message.sender) {
          unavailable(
            "No streaming sender is available. Start the game on the streaming host, then reload to connect.",
          );
          return;
        }
        socket.send(JSON.stringify({ type: "start" }));
        break;
      case "offer": {
        await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.send(JSON.stringify({ type: "answer", sdp: answer.sdp }));
        break;
      }
      case "ice":
        await pc.addIceCandidate({
          candidate: message.candidate,
          sdpMLineIndex: message.sdpMLineIndex,
        });
        break;
      case "state":
        if (["failed", "closed", "disconnected"].includes(message.ice))
          unavailable("The streaming host has stopped this session.");
        break;
      case "stats": {
        const { type: _type, ...stats } = message;
        state.server = stats;
        break;
      }
      case "error":
        unavailable(message.message);
        break;
    }
  } catch (error) {
    unavailable(`Streaming negotiation failed: ${String(error)}`);
  }
};
socket.onclose = event => {
  if (state.source !== "test" && state.phase !== "unavailable")
    unavailable(`Streaming signalling closed (${event.code} ${event.reason}). Reload to reconnect.`);
};
socket.onerror = () => {
  if (state.source !== "test") unavailable("The streaming signalling service is unavailable.");
};
if (query.get("source") === "test") startTestSource();
stage.addEventListener("click", () => void audio.play().catch(() => undefined));

// ---------------------------------------------------------------------------------------------
// Measurements: receiver stats, data channel RTT, presented frame rate.
// ---------------------------------------------------------------------------------------------
let lastPresented = 0;
let previous: {
  decode: number;
  frames: number;
  jitter: number;
  emitted: number;
} | null = null;
let showHud = query.get("hud") === "1";
let ticks = 0;
window.addEventListener("keydown", event => {
  if (event.code === "F8") showHud = !showHud;
});

setInterval(async () => {
  sendInput({ t: "ping", ts: performance.now() });
  state.presentFps = state.framesPresented - lastPresented;
  lastPresented = state.framesPresented;
  state.inputSent = counters?.sent ?? 0;
  const report = await pc.getStats().catch(() => new Map());
  report.forEach(entry => {
    if (entry.type === "inbound-rtp" && entry.kind === "video") {
      const current = {
        decode: entry.totalDecodeTime ?? 0,
        frames: entry.framesDecoded ?? 0,
        jitter: entry.jitterBufferDelay ?? 0,
        emitted: entry.jitterBufferEmittedCount ?? 0,
      };
      if (previous) {
        const frames = Math.max(1, current.frames - previous.frames);
        const emitted = Math.max(1, current.emitted - previous.emitted);
        state.receiver.decodeMs = Math.round(((current.decode - previous.decode) / frames) * 10000) / 10;
        state.receiver.jitterBufferMs = Math.round(((current.jitter - previous.jitter) / emitted) * 10000) / 10;
      }
      previous = current;
      state.receiver.fps = entry.framesPerSecond ?? 0;
      state.receiver.decoder = entry.decoderImplementation ?? "";
      state.receiver.powerEfficientDecoder = String(entry.powerEfficientDecoder ?? "");
      state.receiver.dropped = entry.framesDropped ?? 0;
      state.receiver.lost = entry.packetsLost ?? 0;
      state.receiver.size = `${entry.frameWidth ?? 0}x${entry.frameHeight ?? 0}`;
    }
    if (entry.type === "candidate-pair" && entry.nominated && entry.state === "succeeded") {
      state.receiver.iceRttMs = Math.round((entry.currentRoundTripTime ?? 0) * 1000 * 10) / 10;
    }
  });
  const encode = state.server?.encodeMs ?? 0;
  const network = (state.rttMs ?? 0) / 2;
  const jitter = Number(state.receiver.jitterBufferMs ?? 0);
  const decode = Number(state.receiver.decodeMs ?? 0);
  const frameMs = state.sender ? 1000 / state.sender.fps : 16.7;
  // capture wait (half a frame) + encode + one-way network + jitter buffer + decode + present (half a refresh)
  state.receiver.estimatedLatencyMs = Math.round(frameMs / 2 + encode + network + jitter + decode + 8.3);
  hud.hidden = !showHud;
  hud.textContent = [
    `path      ${state.phase} ${state.source} ${state.path} / ${state.upscale}  ${state.frameSize} -> ${state.canvasSize}`,
    `gpu       ${state.adapter || "-"}`,
    `server    ${state.server?.fps ?? "-"} fps  ${state.server?.kbps ?? "-"} kbps  encode ${state.server?.encodeMs ?? "-"} ms`,
    `client    ${state.receiver.fps ?? "-"} fps recv  ${state.presentFps} fps presented  decode ${state.receiver.decodeMs ?? "-"} ms (${state.receiver.decoder ?? "-"})`,
    `network   rtt ${state.rttMs ?? "-"} ms  jitter buffer ${state.receiver.jitterBufferMs ?? "-"} ms  lost ${state.receiver.lost ?? 0}`,
    `latency   ~${state.receiver.estimatedLatencyMs} ms (estimate)  input sent ${state.inputSent}  ice ${state.ice}`,
  ].join("\n");
  if (++ticks % 5 === 0) {
    console.log(`[gamestream] stats ${JSON.stringify({ ...state, errors: state.errors.length })}`);
  }
}, 1000);
