// SPDX-License-Identifier: Apache-2.0
// Shape of the wasm-bindgen output of ../../crates/webos-wasm (`--target web`), built by
// this package's build:wasm script. `#webos-wasm-glue` maps to wasm/aphrody_webos_wasm.js.
declare module "#webos-wasm-glue" {
  export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;
  export type InitOptions = { module_or_path?: InitInput | Promise<InitInput> };

  export default function init(input?: InitInput | Promise<InitInput> | InitOptions): Promise<unknown>;

  export class WebOsShell {
    private constructor();
    input(bytes: Uint8Array): Uint8Array;
    resize(cols: number, rows: number): void;
    exited(): boolean;
    snapshotJson(): string;
    free(): void;
  }

  export class WebOsFs {
    constructor(image: Uint8Array);
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
    rpc(request: string, now: string): string;
    ragSearch(query: string, limit: number): string;
    ragStats(): string;
    shell(cols: number, rows: number): WebOsShell;
    free(): void;
  }

  export function unifiedDiff(oldText: string, newText: string): string;
  export function detectLanguage(text: string): string;
  export function version(): string;
}
