// SPDX-License-Identifier: Apache-2.0
/** Dedicated-worker local shell with two OPFS image slots. The main thread owns VT rendering. */

export type WorkerRequest =
  | { type: "init"; cols: number; rows: number }
  | { type: "input"; bytes: ArrayBuffer }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close" };

export type WorkerResponse =
  | { type: "ready"; bytes: ArrayBuffer }
  | { type: "output"; bytes: ArrayBuffer }
  | { type: "exited" }
  | { type: "closed" }
  | { type: "error"; message: string };

interface SyncAccess {
  getSize(): number;
  read(buffer: Uint8Array, options: { at: number }): number;
  write(buffer: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}

interface OpfsRoot {
  getFileHandle(
    name: string,
    options: { create: true },
  ): Promise<{
    createSyncAccessHandle(): Promise<SyncAccess>;
  }>;
}

interface RawEngine {
  take_greeting(): Uint8Array;
  input(bytes: Uint8Array): Uint8Array;
  resize(cols: number, rows: number): void;
  image_if_dirty(): Uint8Array;
  mark_persisted(): void;
  exited(): boolean;
}

interface WasmModule {
  default(): Promise<unknown>;
  WebLocalEngine: new (image: Uint8Array, cols: number, rows: number) => RawEngine;
}

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}

const SLOT_NAMES = ["aphrody-shell-0.img", "aphrody-shell-1.img"] as const;
const SLOT_MAGIC = new TextEncoder().encode("APH-SLOT");
const SLOT_HEADER_BYTES = 16;
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;

interface Candidate {
  index: number;
  sequence: bigint;
  image: Uint8Array;
}
interface State {
  engine: RawEngine;
  handles: [SyncAccess, SyncAccess];
  active: number;
  sequence: bigint;
}

function readSlot(handle: SyncAccess, index: number): Candidate | null {
  const size = handle.getSize();
  if (size === 0) return null;
  if (size < SLOT_HEADER_BYTES || size > MAX_IMAGE_BYTES + SLOT_HEADER_BYTES) return null;
  const bytes = new Uint8Array(size);
  for (let offset = 0; offset < size;) {
    const count = handle.read(bytes.subarray(offset), { at: offset });
    if (count <= 0) return null;
    offset += count;
  }
  if (!SLOT_MAGIC.every((byte, i) => bytes[i] === byte)) return null;
  const sequence = new DataView(bytes.buffer).getBigUint64(SLOT_MAGIC.length, true);
  return { index, sequence, image: bytes.subarray(SLOT_HEADER_BYTES) };
}

function writeSlot(handle: SyncAccess, sequence: bigint, image: Uint8Array): void {
  if (image.byteLength > MAX_IMAGE_BYTES) throw new Error("OPFS image exceeds 80 MiB");
  const bytes = new Uint8Array(SLOT_HEADER_BYTES + image.byteLength);
  bytes.set(SLOT_MAGIC);
  new DataView(bytes.buffer).setBigUint64(SLOT_MAGIC.length, sequence, true);
  bytes.set(image, SLOT_HEADER_BYTES);
  handle.truncate(0);
  for (let offset = 0; offset < bytes.byteLength;) {
    const count = handle.write(bytes.subarray(offset), { at: offset });
    if (count <= 0) throw new Error("OPFS write made no progress");
    offset += count;
  }
  handle.truncate(bytes.byteLength);
  handle.flush();
}

function sendBytes(scope: WorkerScope, type: "ready" | "output", bytes: Uint8Array): void {
  const owned = new Uint8Array(bytes);
  scope.postMessage({ type, bytes: owned.buffer }, [owned.buffer]);
}

async function openState(cols: number, rows: number): Promise<State> {
  const storage = navigator.storage as unknown as { getDirectory(): Promise<OpfsRoot> };
  const root = await storage.getDirectory();
  const opened: SyncAccess[] = [];
  try {
    for (const name of SLOT_NAMES) {
      // oxlint-disable-next-line no-await-in-loop -- slot files are opened in order; a failure closes only the handles already opened
      const file = await root.getFileHandle(name, { create: true });
      // oxlint-disable-next-line no-await-in-loop -- slot files are opened in order; a failure closes only the handles already opened
      opened.push(await file.createSyncAccessHandle());
    }
    const handles = opened as [SyncAccess, SyncAccess];
    const wasm = (await import(import.meta.resolve("@aphrody/shell-web/wasm-glue"))) as WasmModule;
    await wasm.default();
    const candidates = handles
      .map(readSlot)
      .filter((candidate): candidate is Candidate => candidate !== null)
      .toSorted((a, b) => (a.sequence > b.sequence ? -1 : a.sequence < b.sequence ? 1 : 0));
    for (const candidate of candidates) {
      try {
        return {
          engine: new wasm.WebLocalEngine(candidate.image, cols, rows),
          handles,
          active: candidate.index,
          sequence: candidate.sequence,
        };
      } catch {
        /* A torn newest slot may leave the previous valid slot. */
      }
    }
    if (handles.some((handle) => handle.getSize() > 0)) {
      throw new Error("both OPFS shell images are invalid; existing data was preserved");
    }
    return {
      engine: new wasm.WebLocalEngine(new Uint8Array(), cols, rows),
      handles,
      active: 1,
      sequence: 0n,
    };
  } catch (error) {
    for (const handle of opened) handle.close();
    throw error;
  }
}

function persist(state: State): void {
  const image = state.engine.image_if_dirty();
  if (image.byteLength === 0) return;
  const next = state.active === 0 ? 1 : 0;
  const sequence = state.sequence + 1n;
  writeSlot(state.handles[next], sequence, image);
  state.active = next;
  state.sequence = sequence;
  state.engine.mark_persisted();
}

/** Install the bounded, sequential worker message loop. */
export function startOpfsWorker(scope: WorkerScope): void {
  let state: State | null = null;
  let queue = Promise.resolve();
  scope.addEventListener("message", (event) => {
    queue = queue
      .then(async () => {
        const request = event.data;
        if (request.type === "init") {
          if (state) throw new Error("worker already initialized");
          state = await openState(request.cols, request.rows);
          sendBytes(scope, "ready", state.engine.take_greeting());
          return;
        }
        if (!state) throw new Error("worker is not initialized");
        if (request.type === "input") {
          const output = state.engine.input(new Uint8Array(request.bytes));
          persist(state);
          sendBytes(scope, "output", output);
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope.postMessage takes a transfer list, not a targetOrigin
          if (state.engine.exited()) scope.postMessage({ type: "exited" });
        } else if (request.type === "resize") {
          state.engine.resize(request.cols, request.rows);
        } else {
          for (const handle of state.handles) handle.close();
          state = null;
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope.postMessage takes a transfer list, not a targetOrigin
          scope.postMessage({ type: "closed" });
        }
        return;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope.postMessage takes a transfer list, not a targetOrigin
        scope.postMessage({ type: "error", message });
      });
  });
}

if (
  typeof document === "undefined" &&
  typeof navigator !== "undefined" &&
  "storage" in navigator &&
  typeof (globalThis as unknown as WorkerScope).postMessage === "function"
) {
  startOpfsWorker(globalThis as unknown as WorkerScope);
}
