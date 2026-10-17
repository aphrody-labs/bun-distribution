/** Messages exchanged between the browser, the Bun signalling server and the WebRTC sender. */

export interface SenderInfo {
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrateKbps: number;
  encoderThreads: number;
}

export interface SenderStats {
  fps: number;
  kbps: number;
  encodeMs: number | null;
  inputEvents: number;
  pointer: [number, number] | null;
}

/** Browser -> server (WebSocket). */
export type ClientMessage =
  | { type: "start" }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: string; sdpMLineIndex: number | null };

/** Server -> browser (WebSocket). */
export type ServerMessage =
  | { type: "hello"; sender: SenderInfo | null }
  | { type: "offer"; sdp: string }
  | { type: "ice"; candidate: string; sdpMLineIndex: number }
  | { type: "state"; ice: string }
  | ({ type: "stats" } & SenderStats)
  | { type: "error"; message: string };

/** Sender (stdout JSON lines) -> server. Session-scoped messages carry the viewer id. */
export type SenderMessage =
  | ({ type: "ready" } & SenderInfo)
  | { type: "offer"; id: string; sdp: string }
  | { type: "ice"; id: string; candidate: string; sdpMLineIndex: number }
  | { type: "state"; id: string; ice: string }
  | ({ type: "stats"; id: string } & SenderStats)
  | { type: "error"; id?: string; message: string };

/** Browser -> sender over the WebRTC data channel "input". */
export type InputMessage =
  | { t: "mm"; dx: number; dy: number }
  | { t: "ma"; x: number; y: number }
  | { t: "mb"; b: number; d: boolean }
  | { t: "mw"; dy: number }
  | { t: "k"; c: string; d: boolean }
  | { t: "gp"; i: number; b: number[]; a: number[] }
  | { t: "ping"; ts: number };
