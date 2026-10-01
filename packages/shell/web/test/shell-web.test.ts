// SPDX-License-Identifier: Apache-2.0
import { beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { attach, localTransport, tauriTransport, type WasmApi } from "../src/index";

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

test("tauri transport targets the plugin commands and filters by session", async () => {
  const calls: string[] = [];
  let emit: (e: { payload: { session: string; bytes: number[]; exit: null } }) => void = () => {};
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
