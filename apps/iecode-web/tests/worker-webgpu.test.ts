import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { EmuToUi, UiToEmu } from "../src/message";

// Exercise the actual worker message handler; only the generated Wasm boundary
// and browser timer/postMessage primitives are replaced for this test.
test("GPU startup orders input, avoids CPU frame transfers, and reports fallback", async () => {
  const build = await Bun.build({
    entrypoints: [fileURLToPath(new URL("../src/emu/emu.ts", import.meta.url))],
    target: "browser",
    plugins: [
      {
        name: "wasm-test-boundary",
        setup(builder) {
          builder.onResolve({ filter: /\/pkg$/ }, () => ({ path: "wasm", namespace: "test" }));
          builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            loader: "js",
            contents: `export default async () => {};
            export const create_emu_state = () => globalThis.__workerTest.emu;
            export const WbgModel = { Lite: 1 };
            export const internal_get_module = () => "module";
            export const internal_get_memory = () => "memory";`,
          }));
        },
      },
    ],
  });
  expect(build.success).toBe(true);
  const source = await build.outputs[0]!.text();
  const globals = globalThis as any;
  const names = ["self", "postMessage", "setTimeout", "clearTimeout", "__workerTest"];
  const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globals, name));
  const settle = async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  };
  try {
    for (const fails of [false, true]) {
      const messages: EmuToUi.Message[] = [];
      const calls: string[] = [];
      let timer: () => void = () => {};
      let finish!: () => void;
      let reject!: (reason: unknown) => void;
      const gpuReady = new Promise<void>((resolve, rejectPromise) => {
        finish = resolve;
        reject = rejectPromise;
      });
      const worker = { onmessage: undefined as undefined | ((event: { data: unknown }) => void) };
      Object.assign(globals, {
        self: worker,
        postMessage: (message: EmuToUi.Message) => messages.push(message),
        setTimeout: (callback: () => void) => {
          timer = callback;
          return 1;
        },
        clearTimeout: () => {},
        __workerTest: {
          emu: {
            enable_webgpu: () => {
              calls.push("enable");
              return gpuReady;
            },
            run_frame_webgpu: () => calls.push("gpu-frame"),
            run_frame: () => {
              calls.push("cpu-frame");
              return new Uint32Array(4);
            },
            update_input: () => calls.push("input"),
            export_save: () => new Uint8Array(0),
          },
        },
      });
      // Execute only this locally built worker with the test Wasm module above.
      // eslint-disable-next-line no-eval
      (0, eval)(source);
      await settle();
      expect(messages[0]?.type).toBe(EmuToUi.MessageType.Loaded);
      const send = (data: unknown) => worker.onmessage!({ data });
      send({ type: UiToEmu.MessageType.Start, canvas: {}, rom: new Uint8Array(0) });
      send({ type: UiToEmu.MessageType.UpdateInput, pressed: 1, released: 0 });
      send({ type: UiToEmu.MessageType.UpdatePlaying, value: true });
      await settle();
      timer();
      expect(calls).toEqual(["enable"]);
      if (fails) reject(new Error("Adapter unavailable"));
      else finish();
      await settle();
      expect(calls).toEqual(["enable", "input"]);
      timer();
      expect(calls.at(-1)).toBe(fails ? "cpu-frame" : "gpu-frame");
      expect(messages.some((message) => message.type === EmuToUi.MessageType.RenderFrame)).toBe(
        fails,
      );
      expect(messages.some((message) => message.type === EmuToUi.MessageType.StartRenderer)).toBe(
        fails,
      );
      const fallback = messages.find(
        (message) => message.type === EmuToUi.MessageType.RendererFallback,
      );
      expect(Boolean(fallback)).toBe(fails);
      if (fallback?.type === EmuToUi.MessageType.RendererFallback) {
        expect(fallback.reason).toContain("Adapter unavailable");
      }
    }
  } finally {
    names.forEach((name, i) => {
      const descriptor = descriptors[i];
      if (descriptor) Object.defineProperty(globals, name, descriptor);
      else delete globals[name];
    });
  }
});
