// SPDX-License-Identifier: Apache-2.0
/**
 * Loader for `bun_wasm.wasm` (C:\bun\src\wasm, wasm32-wasip1-threads): Bun's
 * own semver, shell parser and markdown, called through the C ABI. WASI comes
 * from browser_wasi_shim; results are packed `ptr << 32 | len` with a status byte.
 */
import { ConsoleStdout, File, OpenFile, WASI } from '@bjorn3/browser_wasi_shim';
import { BUN_WASM } from './protocol';

interface Exports {
  _initialize?: () => void;
  memory?: WebAssembly.Memory;
  bun_wasm_alloc(len: number): number;
  bun_wasm_free(ptr: number, len: number): void;
  bun_wasm_version(): bigint;
  bun_wasm_semver_order(a: number, al: number, b: number, bl: number): bigint;
  bun_wasm_semver_satisfies(a: number, al: number, b: number, bl: number): bigint;
  bun_wasm_shell_parse(p: number, l: number): bigint;
  bun_wasm_markdown_html(p: number, l: number): bigint;
}

export interface BunWasm {
  version: string;
  semverOrder(a: string, b: string): -1 | 0 | 1;
  semverSatisfies(version: string, range: string): boolean;
  /** Bun Shell AST (same JSON as the native `bun_shell_parser::json_fmt`). */
  shellParse(source: string): unknown;
  markdownHtml(markdown: string): string;
}

/** wasip1-threads imports a shared memory; 1 GiB matches rustc's default `--max-memory`. */
const SHARED_INITIAL_PAGES = 512;
const SHARED_MAX_PAGES = 16384;

export async function loadBunWasm(url: string = BUN_WASM): Promise<BunWasm> {
  const module = await WebAssembly.compileStreaming(fetch(url));
  const stderr: string[] = [];
  const wasi = new WASI([], [], [
    new OpenFile(new File([])),
    ConsoleStdout.lineBuffered((line) => console.log(`[bun_wasm] ${line}`)),
    ConsoleStdout.lineBuffered((line) => stderr.push(line)),
  ]);
  const needsMemory = WebAssembly.Module.imports(module).some((i) => i.kind === 'memory');
  const memory = needsMemory
    ? new WebAssembly.Memory({ initial: SHARED_INITIAL_PAGES, maximum: SHARED_MAX_PAGES, shared: true })
    : undefined;
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
    wasi: { 'thread-spawn': () => -1 },
    ...(memory ? { env: { memory } } : {}),
  });
  const raw = instance.exports as unknown as Exports;
  const mem = memory ?? raw.memory!;
  wasi.initialize({ exports: { memory: mem, _initialize: raw._initialize ?? (() => {}) } } as never);

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const put = (s: string): [number, number] => {
    const bytes = encoder.encode(s);
    const ptr = raw.bun_wasm_alloc(bytes.length);
    new Uint8Array(mem.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  };
  const take = (packed: bigint): string => {
    const ptr = Number(packed >> 32n);
    const len = Number(packed & 0xffffffffn);
    const view = new Uint8Array(mem.buffer, ptr, len).slice();
    raw.bun_wasm_free(ptr, len);
    const text = decoder.decode(view.subarray(1));
    if (view[0] !== 0) throw new Error(text || stderr.splice(0).join('\n') || 'bun_wasm call failed');
    return text;
  };
  const withInputs = (inputs: string[], fn: (...a: number[]) => bigint): string => {
    const spans = inputs.map(put);
    try {
      return take(fn(...spans.flat()));
    } finally {
      for (const [p, l] of spans) raw.bun_wasm_free(p, l);
    }
  };

  return {
    version: take(raw.bun_wasm_version()),
    semverOrder: (a, b) => Number(withInputs([a, b], raw.bun_wasm_semver_order)) as -1 | 0 | 1,
    semverSatisfies: (v, r) => withInputs([v, r], raw.bun_wasm_semver_satisfies) === 'true',
    shellParse: (src) => JSON.parse(withInputs([src], raw.bun_wasm_shell_parse)),
    markdownHtml: (md) => withInputs([md], raw.bun_wasm_markdown_html),
  };
}
