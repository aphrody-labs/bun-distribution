import { UiToEmu, EmuToUi } from "../message";
import type * as wasm from "../../pkg";

function sendMessage(message: EmuToUi.Message, transfer?: Transferable[]) {
  postMessage(message, transfer as any);
}

class FpsLimiter {
  private limit_!: number | null;
  private timeout!: number;
  private expectedTimeoutTime!: number;
  private timeoutId: number | undefined;
  private handleTimeoutCallback: () => void;

  constructor(
    limit: number | null,
    public callback: () => void,
  ) {
    this.handleTimeoutCallback = this.handleTimeout.bind(this);
    this.limit = limit;
  }

  get limit(): number | null {
    return this.limit_;
  }

  set limit(limit: number | null) {
    if (limit === this.limit_) {
      return;
    }
    this.limit_ = limit;

    clearTimeout(this.timeoutId);
    this.timeout = limit === null ? 0 : 1000 / limit;
    this.expectedTimeoutTime = limit
      ? (this.expectedTimeoutTime || performance.now()) + this.timeout
      : 0;
    this.timeoutId = setTimeout(
      this.handleTimeoutCallback,
      Math.max(0, this.expectedTimeoutTime - performance.now()),
    );
  }

  handleTimeout() {
    this.callback();
    if (this.timeout) {
      const now = performance.now();
      this.expectedTimeoutTime = Math.max(this.expectedTimeoutTime + this.timeout, now);
      this.timeoutId = setTimeout(this.handleTimeoutCallback, this.expectedTimeoutTime - now);
    } else {
      setTimeout(this.handleTimeoutCallback, 0);
    }
  }
}

(async () => {
  const wasm = await import("../../pkg");
  await wasm.default();
  let playing = false;
  let fpsLimiter = new FpsLimiter(60, frame);
  let emu: wasm.EmuState | undefined;
  let webgpu = false;

  let lastSave = performance.now();

  function frame() {
    if (!playing) return;
    if (webgpu) {
      emu!.run_frame_webgpu();
    } else {
      const buffer = emu!.run_frame();
      sendMessage(
        {
          type: EmuToUi.MessageType.RenderFrame,
          buffer,
        },
        [buffer.buffer],
      );
    }
    const now = performance.now();
    if (now - lastSave >= 1000) {
      lastSave = now;
      const buffer = emu!.export_save();
      sendMessage(
        {
          type: EmuToUi.MessageType.ExportSave,
          buffer,
          triggerDownload: false,
        },
        [buffer.buffer],
      );
    }
  }

  async function handleMessage(message: UiToEmu.Message) {
    switch (message.type) {
      case UiToEmu.MessageType.Start: {
        emu = wasm.create_emu_state(
          message.bios7,
          message.bios9,
          message.firmware,
          message.rom,
          undefined,
          message.saveType as number | undefined,
          message.hasIR,
          wasm.WbgModel.Lite,
          (l: Float32Array, r: Float32Array) => {
            sendMessage(
              {
                type: EmuToUi.MessageType.PlayAudioChunk,
                l,
                r,
              },
              [l.buffer, r.buffer],
            );
          },
        );
        if (message.canvas) {
          try {
            await emu!.enable_webgpu(message.canvas);
            webgpu = true;
          } catch (error) {
            sendMessage({
              type: EmuToUi.MessageType.RendererFallback,
              reason: String(error),
            });
          }
        }
        if (!webgpu)
          sendMessage({
            type: EmuToUi.MessageType.StartRenderer,
            module: wasm.internal_get_module(),
            memory: wasm.internal_get_memory(),
          });
        break;
      }

      case UiToEmu.MessageType.Reset: {
        emu!.reset();
        break;
      }

      case UiToEmu.MessageType.Stop: {
        const buffer = emu!.export_save();
        emu!.free();
        sendMessage(
          {
            type: EmuToUi.MessageType.Stopped,
            buffer,
          },
          [buffer.buffer],
        );
        close();
        break;
      }

      case UiToEmu.MessageType.LoadSave: {
        emu!.load_save(new Uint8Array(message.buffer));
        break;
      }

      case UiToEmu.MessageType.ExportSave: {
        const buffer = emu!.export_save();
        lastSave = performance.now();
        sendMessage(
          {
            type: EmuToUi.MessageType.ExportSave,
            buffer,
            triggerDownload: true,
          },
          [buffer.buffer],
        );
        break;
      }

      case UiToEmu.MessageType.UpdateInput: {
        emu!.update_input(message.pressed, message.released);
        if (typeof message.touchPos !== "undefined") {
          emu!.update_touch(message.touchPos?.[0], message.touchPos?.[1]);
        }
        break;
      }

      case UiToEmu.MessageType.UpdatePlaying: {
        playing = message.value;
        break;
      }

      case UiToEmu.MessageType.UpdateFramerateLimit: {
        fpsLimiter.limit = message.value ? 60.0 : null;
        break;
      }
    }
  }

  // Startup awaits the GPU adapter. Input/save/play messages must retain
  // their order and cannot enter Wasm while its async mutable borrow is live.
  let messageQueue = Promise.resolve();
  self.onmessage = (event) => {
    const message = event.data as UiToEmu.Message;
    messageQueue = messageQueue
      .then(() => handleMessage(message))
      .catch((error) => {
        playing = false;
        console.error("Emulator worker failed", error);
      });
  };

  sendMessage({
    type: EmuToUi.MessageType.Loaded,
  });
})();
