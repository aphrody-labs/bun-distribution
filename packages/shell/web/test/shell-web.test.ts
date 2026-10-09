// SPDX-License-Identifier: Apache-2.0
import { beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  attach,
  localTransport,
  sandboxTransport,
  tauriTransport,
  workerTransport,
  type ShellWorker,
  type TauriOutput,
  type WasmApi,
  type WorkerMessage,
} from "../src/index";

const noop = (): void => {};
const pkg = new URL("../pkg/", import.meta.url);
const built = existsSync(new URL("aphrody_shell_web_bg.wasm", pkg));
let wasm: WasmApi;

beforeAll(async () => {
  if (!built) return;
  const mod = await import(new URL("aphrody_shell_web.js", pkg).href);
  await mod.default({ module_or_path: readFileSync(new URL("aphrody_shell_web_bg.wasm", pkg)) });
  wasm = mod as WasmApi;
});

test.skipIf(!built)("local shell runs inside WASM", () => {
  const t = localTransport(wasm, 60, 10);
  const term = attach(wasm, t, 60, 10);
  t.send(new TextEncoder().encode("echo hello wasm\r"));
  expect(t.snapshot().lines.join("\n")).toContain("hello wasm");
  term.close();
});

test.skipIf(!built)("wire frames match the backend protocol", () => {
  expect(JSON.parse(wasm.resize_frame(80, 24))).toEqual({ type: "resize", cols: 80, rows: 24 });
});

test.skipIf(!built)("WASM registry counts VFS entries through a pipeline", () => {
  const shell = new wasm.WebShell(80, 20);
  const encoder = new TextEncoder();
  shell.input(encoder.encode("touch alpha\r"));
  shell.input(encoder.encode("touch beta\r"));
  const output = new TextDecoder().decode(shell.input(encoder.encode("ls | wc -l\r")));
  expect(output).toContain("2\r\n");
});

test("tauri transport targets the plugin commands and filters by session", async () => {
  const calls: string[] = [];
  let emit: (e: { payload: { session: string; bytes: number[]; exit: null } }) => void = noop;
  const t = tauriTransport({
    invoke: async (c) => void calls.push(c),
    listen: async (_e, cb) => ((emit = cb), () => {}),
  });
  const got: number[][] = [];
  t.onOutput((b) => got.push([...b]));
  await new Promise((r) => setTimeout(r, 0));
  emit({ payload: { session: "default", bytes: [104, 105], exit: null } });
  emit({ payload: { session: "other", bytes: [1], exit: null } });
  t.send(new Uint8Array([108]));
  t.resize(100, 30);
  await new Promise((r) => setTimeout(r, 0));
  expect(got).toEqual([[104, 105]]);
  expect(calls).toEqual([
    "plugin:aphrody-shell-tauri|aphrody_shell_open",
    "plugin:aphrody-shell-tauri|aphrody_shell_write",
    "plugin:aphrody-shell-tauri|aphrody_shell_resize",
  ]);
});

test("tauri channel transport passes a channel to the plugin", async () => {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const channel = { onmessage: (_payload: TauriOutput) => {} };
  const t = tauriTransport({
    invoke: async (command, args) => {
      calls.push({ command, args });
    },
    createChannel: () => channel,
    listen: async () => {
      throw new Error("event fallback should not be used");
    },
  });
  const got: number[][] = [];
  t.onOutput((bytes) => got.push([...bytes]));
  channel.onmessage({ session: "default", bytes: [65], exit: null });
  channel.onmessage({ session: "other", bytes: [66], exit: null });
  await Promise.resolve();
  expect(got).toEqual([[65]]);
  expect(calls[0]?.command).toBe("plugin:aphrody-shell-tauri|aphrody_shell_open_channel");
  expect(calls[0]?.args?.onOutput).toBe(channel);
  t.close();
});

test("worker transport transfers input and closes after worker flush", () => {
  const messages: { type: string; bytes?: ArrayBuffer }[] = [];
  let listener: (event: MessageEvent<WorkerMessage>) => void = noop;
  let terminated = false;
  const worker: ShellWorker = {
    addEventListener: (_type, cb) => {
      listener = cb;
    },
    postMessage: (message) => {
      messages.push(message as { type: string; bytes?: ArrayBuffer });
    },
    terminate: () => {
      terminated = true;
    },
  };
  const t = workerTransport(80, 20, worker);
  const got: number[][] = [];
  t.onOutput((bytes) => got.push([...bytes]));
  listener({
    data: { type: "ready", bytes: new Uint8Array([62]).buffer },
  } as MessageEvent<WorkerMessage>);
  t.send(new Uint8Array([65, 66]));
  expect([...new Uint8Array(messages[1]!.bytes!)]).toEqual([65, 66]);
  listener({
    data: { type: "output", bytes: new Uint8Array([67]).buffer },
  } as MessageEvent<WorkerMessage>);
  t.close();
  expect(terminated).toBe(false);
  listener({ data: { type: "closed" } } as MessageEvent<WorkerMessage>);
  expect(terminated).toBe(true);
  expect(got).toEqual([[62], [67]]);
  expect(messages.map((message) => message.type)).toEqual(["init", "input", "close"]);
});

test("sandbox transport authenticates, reconnects, and replays queued input", async () => {
  class FakeSocket {
    static OPEN = 1;
    static sockets: FakeSocket[] = [];
    readonly url: string;
    readyState = 0;
    binaryType = "";
    sent: unknown[] = [];
    readonly #listeners = new Map<string, (() => void)[]>();
    constructor(url: string) {
      this.url = url;
      FakeSocket.sockets.push(this);
    }
    addEventListener(type: string, listener: () => void) {
      this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
    }
    #emit(type: string) {
      for (const listener of this.#listeners.get(type) ?? []) listener();
    }
    send(value: unknown) {
      this.sent.push(value);
    }
    close() {
      this.readyState = 3;
      this.#emit("close");
    }
    open() {
      this.readyState = 1;
      this.#emit("open");
    }
    drop() {
      this.close();
    }
  }
  const fakeWasm = { resize_frame: (cols: number, rows: number) => `${cols}x${rows}` } as WasmApi;
  const t = sandboxTransport(fakeWasm, "wss://shell.example/ws", "token with space", {
    sessionId: "session-1",
    reconnectDelayMs: 1,
    WS: FakeSocket as unknown as typeof WebSocket,
  });
  const first = FakeSocket.sockets[0]!;
  expect(new URL(first.url).searchParams.get("token")).toBe("token with space");
  expect(new URL(first.url).searchParams.get("session")).toBe("session-1");
  t.resize(90, 25);
  t.send(new Uint8Array([65]));
  first.open();
  expect(first.sent[0]).toBe("90x25");
  expect([...(first.sent[1] as Uint8Array)]).toEqual([65]);
  first.drop();
  t.send(new Uint8Array([66]));
  await Bun.sleep(10);
  const second = FakeSocket.sockets[1]!;
  expect(second.url).toBe(first.url);
  second.open();
  expect([...(second.sent[1] as Uint8Array)]).toEqual([66]);
  t.close();
});
