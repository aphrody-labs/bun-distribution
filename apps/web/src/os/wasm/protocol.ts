// SPDX-License-Identifier: Apache-2.0
/** Messages between the WebOS page, its wasm workers and the Aphrody Bun server. */

/** Where `bun build --target=wasm` (fallback: scripts/build/rust/wasm-package.ts) puts the modules. */
export const WASM_BASE = '/dist/wasm';
export const WEBOS_GLUE = `${WASM_BASE}/webos/aphrody_webos_wasm.js`;
export const CLI_GLUE = `${WASM_BASE}/cli/aphrody_command_wasm.js`;
export const BUN_WASM = `${WASM_BASE}/bun/bun_wasm.wasm`;
export const ROOTFS_SEED = `${WASM_BASE}/rootfs-seed.json`;
export const WORKER_BASE = '/dist/workers';

export interface FsEntry {
  name: string;
  kind: 'file' | 'dir';
  size: number;
}

export interface FsStat {
  kind: 'file' | 'dir';
  size: number;
}

export interface PatchSummary {
  added: string[];
  modified: string[];
  deleted: string[];
}

/** Every call the files worker answers; `result` is what the caller gets back. */
export interface FsMethods {
  list: { args: [path: string]; result: FsEntry[] };
  stat: { args: [path: string]; result: FsStat };
  read: { args: [path: string]; result: Uint8Array };
  write: { args: [path: string, data: Uint8Array]; result: void };
  mkdir: { args: [path: string]; result: void };
  remove: { args: [path: string]; result: void };
  rename: { args: [from: string, to: string]; result: void };
  triage: { args: [path: string]; result: unknown };
  strings: { args: [path: string, minLen: number, limit: number]; result: string[] };
  applyPatch: { args: [patch: string, cwd: string]; result: PatchSummary };
  diff: { args: [oldText: string, newText: string]; result: string };
}

export type FsMethod = keyof FsMethods;

export interface RpcRequest<M extends FsMethod = FsMethod> {
  id: number;
  method: M;
  args: FsMethods[M]['args'];
}

export type RpcResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

/** Sent once to the files worker; extra ports (REPL workers) arrive as `connect`. */
export type FsControl = { type: 'connect'; port: MessagePort };

/** Seed applied to an empty filesystem: absolute path → UTF-8 text, or `null` for a directory. */
export type RootfsSeed = Record<string, string | null>;

export type ReplRequest =
  | { type: 'init'; fsPort: MessagePort }
  | { type: 'eval'; id: number; code: string };

export type ReplResponse =
  | { type: 'ready'; bunVersion: string }
  | { type: 'log'; id: number; level: 'log' | 'warn' | 'error'; text: string }
  | { type: 'result'; id: number; ok: boolean; text: string };
