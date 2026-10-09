// SPDX-License-Identifier: Apache-2.0
/** Page-side handles on the WebOS wasm workers: typed files API and process table. */
import { WORKER_BASE, type FsMethod, type FsMethods, type RpcResponse } from './protocol';

export interface ProcessInfo {
  pid: number;
  name: string;
  module: string;
  startedAt: number;
}

type Listener = (list: ProcessInfo[]) => void;

/** Every wasm worker the WebOS started; killing one terminates its Worker. */
class ProcessTable {
  private next = 1;
  private readonly entries = new Map<number, { info: ProcessInfo; worker: Worker }>();
  private readonly listeners = new Set<Listener>();

  spawn(name: string, module: string, script: string): { pid: number; worker: Worker } {
    const worker = new Worker(`${WORKER_BASE}/${script}`, { type: 'module', name });
    const pid = this.next++;
    this.entries.set(pid, { info: { pid, name, module, startedAt: Date.now() }, worker });
    this.emit();
    return { pid, worker };
  }

  kill(pid: number): boolean {
    const entry = this.entries.get(pid);
    if (!entry) return false;
    entry.worker.terminate();
    this.entries.delete(pid);
    if (pid === filesPid) filesClient = null;
    this.emit();
    return true;
  }

  list(): ProcessInfo[] {
    return [...this.entries.values()].map((e) => e.info);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.list());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const list = this.list();
    for (const l of this.listeners) l(list);
  }
}

export const processes = new ProcessTable();

interface Port {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  start?(): void;
}

/** Typed RPC over a files-worker port; works from the page and from other workers. */
export class FsClient {
  private next = 1;
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

  constructor(private readonly port: Port) {
    port.addEventListener('message', (event: MessageEvent) => {
      const res = event.data as RpcResponse;
      const p = this.pending.get(res.id);
      if (!p) return;
      this.pending.delete(res.id);
      if (res.ok) p.resolve(res.value);
      else p.reject(new Error(res.error));
    });
    port.start?.();
  }

  call<M extends FsMethod>(method: M, ...args: FsMethods[M]['args']): Promise<FsMethods[M]['result']> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.port.postMessage({ id, method, args });
    });
  }

  list = (path: string) => this.call('list', path);
  stat = (path: string) => this.call('stat', path);
  read = (path: string) => this.call('read', path);
  readText = async (path: string) => new TextDecoder().decode(await this.call('read', path));
  write = (path: string, data: Uint8Array | string) =>
    this.call('write', path, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  mkdir = (path: string) => this.call('mkdir', path);
  remove = (path: string) => this.call('remove', path);
  rename = (from: string, to: string) => this.call('rename', from, to);
  triage = (path: string) => this.call('triage', path);
  strings = (path: string, minLen = 4, limit = 500) => this.call('strings', path, minLen, limit);
  applyPatch = (patch: string, cwd = '/') => this.call('applyPatch', patch, cwd);
  diff = (oldText: string, newText: string) => this.call('diff', oldText, newText);
}

let filesClient: FsClient | null = null;
let filesWorker: Worker | null = null;
let filesPid = 0;

/** The single files worker (OPFS sync handles are exclusive), started on first use. */
export function files(): FsClient {
  if (!filesClient) {
    const { pid, worker } = processes.spawn('files', 'aphrody-webos-wasm', 'fs-worker.js');
    filesPid = pid;
    filesWorker = worker;
    filesClient = new FsClient(worker);
  }
  return filesClient;
}

/** A fresh port on the files worker, to hand to another worker. */
export function filesPort(): MessagePort {
  files();
  const channel = new MessageChannel();
  filesWorker!.postMessage({ type: 'connect', port: channel.port2 }, [channel.port2]);
  return channel.port1;
}
