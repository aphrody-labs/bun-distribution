// SPDX-License-Identifier: Apache-2.0
/**
 * Files worker: owns the `WebOsFs` wasm instance and its two OPFS image slots.
 * Slot layout is the one of `@aphrody/shell-web`'s worker (APH-SLOT header,
 * sequence, APFS1 image) so both read the same images.
 */
import {
  ROOTFS_SEED,
  WEBOS_GLUE,
  type FsControl,
  type FsMethod,
  type RootfsSeed,
  type RpcRequest,
  type RpcResponse,
} from './protocol';

interface SyncAccess {
  getSize(): number;
  read(buffer: Uint8Array, options: { at: number }): number;
  write(buffer: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}

interface RawFs {
  list(path: string): string;
  stat(path: string): string;
  read(path: string): Uint8Array;
  write(path: string, data: Uint8Array): void;
  mkdir(path: string): void;
  remove(path: string): void;
  rename(from: string, to: string): void;
  imageIfDirty(): Uint8Array;
  markPersisted(): void;
  triage(path: string): string;
  strings(path: string, minLen: number, limit: number): string;
  applyPatch(patch: string, cwd: string): string;
}

interface WebOsModule {
  default(): Promise<unknown>;
  WebOsFs: new (image: Uint8Array) => RawFs;
  unifiedDiff(oldText: string, newText: string): string;
}

const SLOT_NAMES = ['aphrody-webos-0.img', 'aphrody-webos-1.img'] as const;
const SLOT_MAGIC = new TextEncoder().encode('APH-SLOT');
const SLOT_HEADER_BYTES = 16;
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const MUTATING = new Set<FsMethod>(['write', 'mkdir', 'remove', 'rename', 'applyPatch']);

interface State {
  wasm: WebOsModule;
  fs: RawFs;
  handles: SyncAccess[];
  active: number;
  sequence: bigint;
}

function readSlot(handle: SyncAccess): { sequence: bigint; image: Uint8Array } | null {
  const size = handle.getSize();
  if (size < SLOT_HEADER_BYTES || size > MAX_IMAGE_BYTES + SLOT_HEADER_BYTES) return null;
  const bytes = new Uint8Array(size);
  for (let at = 0; at < size; ) {
    const n = handle.read(bytes.subarray(at), { at });
    if (n <= 0) return null;
    at += n;
  }
  if (!SLOT_MAGIC.every((b, i) => bytes[i] === b)) return null;
  const sequence = new DataView(bytes.buffer).getBigUint64(SLOT_MAGIC.length, true);
  return { sequence, image: bytes.subarray(SLOT_HEADER_BYTES) };
}

function writeSlot(handle: SyncAccess, sequence: bigint, image: Uint8Array): void {
  const bytes = new Uint8Array(SLOT_HEADER_BYTES + image.byteLength);
  bytes.set(SLOT_MAGIC);
  new DataView(bytes.buffer).setBigUint64(SLOT_MAGIC.length, sequence, true);
  bytes.set(image, SLOT_HEADER_BYTES);
  handle.truncate(0);
  for (let at = 0; at < bytes.byteLength; ) {
    const n = handle.write(bytes.subarray(at), { at });
    if (n <= 0) throw new Error('OPFS write made no progress');
    at += n;
  }
  handle.flush();
}

async function seed(fs: RawFs): Promise<void> {
  const res = await fetch(ROOTFS_SEED);
  if (!res.ok) return;
  const entries = Object.entries((await res.json()) as RootfsSeed).sort(([a], [b]) => a.localeCompare(b));
  const encoder = new TextEncoder();
  for (const [path, text] of entries) {
    if (text === null) fs.mkdir(path);
    else fs.write(path, encoder.encode(text));
  }
}

async function open(): Promise<State> {
  const root = await (navigator.storage as unknown as {
    getDirectory(): Promise<{ getFileHandle(n: string, o: { create: true }): Promise<{ createSyncAccessHandle(): Promise<SyncAccess> }> }>;
  }).getDirectory();
  const handles: SyncAccess[] = [];
  for (const name of SLOT_NAMES) handles.push(await (await root.getFileHandle(name, { create: true })).createSyncAccessHandle());
  const wasm = (await import(new URL(WEBOS_GLUE, self.location.origin).href)) as WebOsModule;
  await wasm.default();
  const slots = handles
    .map((h, index) => ({ index, slot: readSlot(h) }))
    .filter((s): s is { index: number; slot: { sequence: bigint; image: Uint8Array } } => s.slot !== null)
    .sort((a, b) => (a.slot.sequence > b.slot.sequence ? -1 : 1));
  for (const { index, slot } of slots) {
    try {
      return { wasm, fs: new wasm.WebOsFs(slot.image), handles, active: index, sequence: slot.sequence };
    } catch {
      /* torn newest slot: fall back to the previous one */
    }
  }
  if (handles.some((h) => h.getSize() > 0)) {
    for (const h of handles) h.close();
    throw new Error('both OPFS WebOS images are invalid; existing data was preserved');
  }
  const state: State = { wasm, fs: new wasm.WebOsFs(new Uint8Array()), handles, active: 1, sequence: 0n };
  await seed(state.fs);
  persist(state);
  return state;
}

function persist(state: State): void {
  const image = state.fs.imageIfDirty();
  if (image.byteLength === 0) return;
  const next = state.active === 0 ? 1 : 0;
  const sequence = state.sequence + 1n;
  writeSlot(state.handles[next]!, sequence, image);
  state.active = next;
  state.sequence = sequence;
  state.fs.markPersisted();
}

function call(state: State, req: RpcRequest): unknown {
  const { fs } = state;
  const a = req.args as unknown[];
  switch (req.method) {
    case 'list':
    case 'stat':
    case 'triage':
      return JSON.parse(fs[req.method](a[0] as string));
    case 'strings':
      return JSON.parse(fs.strings(a[0] as string, a[1] as number, a[2] as number));
    case 'applyPatch':
      return JSON.parse(fs.applyPatch(a[0] as string, a[1] as string));
    case 'read':
      return fs.read(a[0] as string);
    case 'write':
      return fs.write(a[0] as string, a[1] as Uint8Array);
    case 'mkdir':
    case 'remove':
      return fs[req.method](a[0] as string);
    case 'rename':
      return fs.rename(a[0] as string, a[1] as string);
    case 'diff':
      return state.wasm.unifiedDiff(a[0] as string, a[1] as string);
  }
}

const ready = open();

function serve(port: { postMessage(m: RpcResponse, t?: Transferable[]): void; addEventListener(t: 'message', l: (e: MessageEvent) => void): void; start?(): void }): void {
  let queue = Promise.resolve();
  port.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as RpcRequest | FsControl;
    if ('type' in data) {
      serve(data.port);
      return;
    }
    queue = queue.then(async () => {
      try {
        const state = await ready;
        const value = call(state, data);
        if (MUTATING.has(data.method)) persist(state);
        const transfer = value instanceof Uint8Array ? [value.buffer as ArrayBuffer] : [];
        port.postMessage({ id: data.id, ok: true, value }, transfer);
      } catch (error) {
        port.postMessage({ id: data.id, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  });
  port.start?.();
}

serve(self as unknown as Parameters<typeof serve>[0]);
