// SPDX-License-Identifier: Apache-2.0
/** Host-agnostic shell session: browser WebSocket, Tauri IPC, or the in-WASM local shell. */

export interface WasmApi {
  WebTerminal: new (cols: number, rows: number) => {
    ingest(bytes: Uint8Array): void;
    resize(cols: number, rows: number): void;
    take_replies(): string[];
    snapshot_json(): string;
  };
  WebShell: new (cols: number, rows: number) => {
    input(bytes: Uint8Array): Uint8Array;
    resize(cols: number, rows: number): void;
    exited(): boolean;
    snapshot_json(): string;
  };
  resize_frame(cols: number, rows: number): string;
  data_frame(bytes: Uint8Array): string;
}

export interface Snapshot {
  columns: number;
  rows: number;
  lines: string[];
  cursor: { row: number; col: number; visible: boolean };
}

/** Bytes in/out of a shell. Implementations: WebSocket, Tauri, local. */
export interface Transport {
  send(bytes: Uint8Array): void;
  resize(cols: number, rows: number): void;
  onOutput(cb: (bytes: Uint8Array) => void): void;
  close(): void;
}

export function webSocketTransport(wasm: WasmApi, url: string, WS: typeof WebSocket = WebSocket): Transport {
  const ws = new WS(url);
  ws.binaryType = "arraybuffer";
  let out: (b: Uint8Array) => void = () => {};
  const queue: (() => void)[] = [];
  ws.onopen = () => queue.splice(0).forEach((f) => f());
  ws.onmessage = (e: MessageEvent) => {
    if (e.data instanceof ArrayBuffer) out(new Uint8Array(e.data));
  };
  const whenOpen = (f: () => void) => (ws.readyState === 1 ? f() : queue.push(f));
  return {
    send: (b) => whenOpen(() => ws.send(b as Uint8Array<ArrayBuffer>)),
    resize: (c, r) => whenOpen(() => ws.send(wasm.resize_frame(c, r))),
    onOutput: (cb) => (out = cb),
    close: () => ws.close(),
  };
}

/** Tauri bridge; `invoke`/`listen` come from `@tauri-apps/api` so this package stays dependency-free. */
export interface TauriBridge {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  listen(
    event: string,
    cb: (e: { payload: { session: string; bytes: number[]; exit: number | null | undefined } }) => void,
  ): Promise<() => void>;
}

/** Talks to the `aphrody-shell-tauri` plugin (plugin commands are namespaced `plugin:aphrody-shell-tauri|`). */
export function tauriTransport(bridge: TauriBridge, session = "default", cols = 80, rows = 24): Transport {
  const cmd = (name: string) => `plugin:aphrody-shell-tauri|${name}`;
  let out: (b: Uint8Array) => void = () => {};
  let unlisten: (() => void) | undefined;
  const ready = bridge
    .listen("aphrody-shell-output", ({ payload }) => {
      if (payload.session === session && payload.bytes.length) out(Uint8Array.from(payload.bytes));
    })
    .then((u) => {
      unlisten = u;
      return bridge.invoke(cmd("aphrody_shell_open"), { session, cols, rows });
    });
  const after = (name: string, args: Record<string, unknown>) =>
    void ready.then(() => bridge.invoke(cmd(name), { session, ...args }));
  return {
    send: (b) => after("aphrody_shell_write", { bytes: Array.from(b) }),
    resize: (c, r) => after("aphrody_shell_resize", { cols: c, rows: r }),
    onOutput: (cb) => (out = cb),
    close: () => {
      unlisten?.();
      after("aphrody_shell_close", {});
    },
  };
}

/** Backend-less transport running the shell inside WASM. */
export function localTransport(wasm: WasmApi, cols = 80, rows = 24): Transport & { snapshot(): Snapshot } {
  const shell = new wasm.WebShell(cols, rows);
  let out: (b: Uint8Array) => void = () => {};
  return {
    send: (b) => out(shell.input(b)),
    resize: (c, r) => shell.resize(c, r),
    onOutput: (cb) => (out = cb),
    close: () => {},
    snapshot: () => JSON.parse(shell.snapshot_json()) as Snapshot,
  };
}

/** Terminal bound to a transport: output bytes update the VT grid, VT replies flow back. */
export function attach(wasm: WasmApi, transport: Transport, cols = 80, rows = 24) {
  const term = new wasm.WebTerminal(cols, rows);
  transport.onOutput((bytes) => {
    term.ingest(bytes);
    const enc = new TextEncoder();
    for (const reply of term.take_replies()) transport.send(enc.encode(reply));
  });
  transport.resize(cols, rows);
  return {
    snapshot: () => JSON.parse(term.snapshot_json()) as Snapshot,
    resize: (c: number, r: number) => (term.resize(c, r), transport.resize(c, r)),
    type: (text: string) => transport.send(new TextEncoder().encode(text)),
    close: () => transport.close(),
  };
}
