// SPDX-License-Identifier: Apache-2.0
/** Bun REPL worker: evaluates input on the worker's JS engine with the WebOS `Bun`. */
import { loadBunWasm } from './bun-wasm';
import { createBunApi, type WebBun } from './bun-api';
import { FsClient } from './client';
import type { ReplRequest, ReplResponse } from './protocol';

const post = (m: ReplResponse) => (self as unknown as Worker).postMessage(m);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<unknown>;

let bun: WebBun | null = null;
let current = 0;

function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v), 2) ?? String(value);
  } catch {
    return String(value);
  }
}

const consoleProxy = Object.fromEntries(
  (['log', 'info', 'warn', 'error'] as const).map((level) => [
    level,
    (...args: unknown[]) =>
      post({
        type: 'log',
        id: current,
        level: level === 'info' ? 'log' : level,
        text: args.map((a) => (typeof a === 'string' ? a : show(a))).join(' '),
      }),
  ]),
);

async function evaluate(code: string): Promise<unknown> {
  let fn: (...a: unknown[]) => Promise<unknown>;
  try {
    fn = new AsyncFunction('Bun', 'console', `return (${code}\n);`);
  } catch {
    fn = new AsyncFunction('Bun', 'console', code);
  }
  return fn(bun, consoleProxy);
}

self.addEventListener('message', async (event: MessageEvent<ReplRequest>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    const core = await loadBunWasm();
    bun = createBunApi(core, new FsClient(msg.fsPort));
    post({ type: 'ready', bunVersion: core.version });
    return;
  }
  current = msg.id;
  try {
    post({ type: 'result', id: msg.id, ok: true, text: show(await evaluate(msg.code)) });
  } catch (error) {
    post({ type: 'result', id: msg.id, ok: false, text: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  }
});
