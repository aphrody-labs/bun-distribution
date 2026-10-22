// RetroArch driven in process through bun:ffi: the aphrody-labs/retroarch fork builds
// libretroarch (./configure --enable-libretroarch), whose "host" drivers hand frames, audio and
// pads to this module instead of a window. Every call stays on the thread that opened it.
import {
  CString,
  dlopen,
  FFIType,
  ptr,
  read,
  suffix,
  toArrayBuffer,
  type Pointer,
} from "bun:ffi";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, usrRoot } from "./usr";

const ABI_VERSION = 1;

const symbols = {
  libretroarch_api_version: { args: [], returns: FFIType.u32 },
  libretroarch_init: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  libretroarch_iterate: { args: [], returns: FFIType.i32 },
  libretroarch_deinit: { args: [], returns: FFIType.void },
  libretroarch_status: { args: [FFIType.ptr], returns: FFIType.void },
  libretroarch_frame: { args: [FFIType.ptr], returns: FFIType.i32 },
  libretroarch_audio_read: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.u64,
  },
  libretroarch_joypad: {
    args: [FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32],
    returns: FFIType.void,
  },
  libretroarch_command: { args: [FFIType.cstring], returns: FFIType.i32 },
  libretroarch_command_reply: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.u64,
  },
} as const;

export enum PixelFormat {
  XRGB8888 = 0,
  RGB565 = 1,
  /** The menu's own framebuffer. */
  RGBA4444 = 2,
}

/** RETRO_DEVICE_ID_JOYPAD_* bits for {@link RetroArch.joypad}. */
export const Button = {
  B: 1 << 0,
  Y: 1 << 1,
  Select: 1 << 2,
  Start: 1 << 3,
  Up: 1 << 4,
  Down: 1 << 5,
  Left: 1 << 6,
  Right: 1 << 7,
  A: 1 << 8,
  X: 1 << 9,
  L: 1 << 10,
  R: 1 << 11,
  L2: 1 << 12,
  R2: 1 << 13,
  L3: 1 << 14,
  R3: 1 << 15,
} as const;

export interface Frame {
  /** Grows with each new picture: upload only when it changed. */
  serial: bigint;
  width: number;
  height: number;
  pitch: number;
  format: PixelFormat;
  /** Zero-copy view of RetroArch's buffer, valid until the next iterate. */
  data: Uint8Array;
}

export interface Status {
  fps: number;
  coreSampleRate: number;
  audioRate: number;
  coreRunning: boolean;
  paused: boolean;
  menu: boolean;
  fastForward: boolean;
}

export interface OpenOptions {
  /** libretroarch shared library; defaults to $LIBRETROARCH, usr/lib, then the vendor build. */
  library?: string;
  /** libretro core (-L). Without one, content goes to the built-in cores or RetroArch's menu. */
  core?: string;
  content?: string;
  /** Extra retroarch.cfg keys, over the host drivers' defaults. */
  config?: Record<string, string | number | boolean>;
  /** Extra command-line arguments. */
  args?: string[];
  /** Directory for the isolated retroarch.cfg; defaults to usr/var/lib/bep/libretroarch. */
  home?: string;
}

export function libretroarchLibrary(): string | undefined {
  const name = `libretroarch.${suffix}`;
  return [
    process.env.LIBRETROARCH,
    join(usrRoot(), "lib", name),
    join(repoRoot, "vendor", "retroarch", name),
  ].find((path) => path && existsSync(path));
}

function cfgValue(value: string | number | boolean): string {
  return `"${String(value).replaceAll("\\", "/").replaceAll('"', '\\"')}"`;
}

let rgb565: Uint32Array | undefined;
let rgba4444: Uint32Array | undefined;

/** RGBA8 words, little-endian, for every 16-bit pixel. */
function lut(format: PixelFormat.RGB565 | PixelFormat.RGBA4444): Uint32Array {
  if (format === PixelFormat.RGB565 && rgb565) return rgb565;
  if (format === PixelFormat.RGBA4444 && rgba4444) return rgba4444;
  const table = new Uint32Array(65536);
  for (let p = 0; p < 65536; p++) {
    let r: number, g: number, b: number, a: number;
    if (format === PixelFormat.RGB565) {
      r = (((p >> 11) & 0x1f) * 255) / 31;
      g = (((p >> 5) & 0x3f) * 255) / 63;
      b = ((p & 0x1f) * 255) / 31;
      a = 255;
    } else {
      r = ((p >> 12) & 0xf) * 17;
      g = ((p >> 8) & 0xf) * 17;
      b = ((p >> 4) & 0xf) * 17;
      a = (p & 0xf) * 17;
    }
    table[p] =
      ((a << 24) |
        (Math.round(b) << 16) |
        (Math.round(g) << 8) |
        Math.round(r)) >>>
      0;
  }
  if (format === PixelFormat.RGB565) rgb565 = table;
  else rgba4444 = table;
  return table;
}

/**
 * The frame as tightly packed RGBA8 (`rgba8unorm`). An XRGB8888 frame is already
 * `bgra8unorm` bytes: hand {@link Frame.data} to `writeTexture` with `bytesPerRow: pitch`
 * instead, with no conversion at all.
 */
export function toRGBA(frame: Frame, out?: Uint8Array): Uint8Array {
  const { width, height, pitch, format, data } = frame;
  const target =
    out && out.byteLength >= width * height * 4
      ? out
      : new Uint8Array(width * height * 4);
  const dst = new Uint32Array(target.buffer, target.byteOffset, width * height);
  if (format === PixelFormat.XRGB8888) {
    for (let y = 0; y < height; y++) {
      const row = new Uint32Array(
        data.buffer,
        data.byteOffset + y * pitch,
        width,
      );
      for (let x = 0; x < width; x++) {
        const p = row[x]!;
        dst[y * width + x] =
          (0xff000000 |
            ((p & 0xff) << 16) |
            (p & 0xff00) |
            ((p >> 16) & 0xff)) >>>
          0;
      }
    }
    return target;
  }
  const table = lut(format);
  for (let y = 0; y < height; y++) {
    const row = new Uint16Array(
      data.buffer,
      data.byteOffset + y * pitch,
      width,
    );
    for (let x = 0; x < width; x++) dst[y * width + x] = table[row[x]!]!;
  }
  return target;
}

type Library = ReturnType<typeof dlopen<typeof symbols>>;

/** One RetroArch per process: the library holds the frontend's global state. */
export class RetroArch implements Disposable {
  #lib: Library;
  #frame = new Uint8Array(32);
  #status = new Uint8Array(24);
  #axes = new Int16Array(6);
  #reply = new Uint8Array(64 * 1024);
  #open = true;

  private constructor(lib: Library) {
    this.#lib = lib;
  }

  static open(options: OpenOptions = {}): RetroArch {
    const path = options.library ?? libretroarchLibrary();
    if (!path)
      throw new Error(
        "libretroarch is not built: ./configure --enable-libretroarch && make in vendor/retroarch",
      );
    const lib = dlopen(path, symbols);
    const abi = lib.symbols.libretroarch_api_version();
    if (abi !== ABI_VERSION) {
      lib.close();
      throw new Error(`libretroarch ABI ${abi}, expected ${ABI_VERSION}`);
    }

    const home =
      options.home ?? join(usrRoot(), "var", "lib", "bep", "libretroarch");
    mkdirSync(home, { recursive: true });
    const cfg = join(home, "retroarch.cfg");
    const settings: Record<string, string | number | boolean> = {
      video_driver: "host",
      audio_driver: "host",
      input_driver: "null",
      input_joypad_driver: "host",
      menu_driver: "rgui",
      video_threaded: false,
      video_vsync: false,
      audio_sync: false,
      audio_out_rate: 48000,
      config_save_on_exit: false,
      ...options.config,
    };
    // read synchronously by libretroarch_init below
    writeFileSync(
      cfg,
      Object.entries(settings)
        .map(([key, value]) => `${key} = ${cfgValue(value)}\n`)
        .join(""),
    );

    const argv = ["retroarch", "--config", cfg];
    if (options.core) argv.push("-L", options.core);
    argv.push(...(options.args ?? []));
    if (options.content) argv.push(options.content);
    else if (!options.core) argv.push("--menu");

    const strings = argv.map((arg) => Buffer.from(`${arg}\0`));
    const pointers = new BigUint64Array(strings.length + 1);
    strings.forEach((bytes, i) => (pointers[i] = BigInt(ptr(bytes))));
    if (lib.symbols.libretroarch_init(argv.length, ptr(pointers)) !== 0) {
      lib.close();
      throw new Error(`libretroarch failed to start: ${argv.join(" ")}`);
    }
    return new RetroArch(lib);
  }

  /** Runs one frame; false once RetroArch quits. */
  iterate(): boolean {
    return this.#open && this.#lib.symbols.libretroarch_iterate() === 0;
  }

  frame(): Frame | undefined {
    const out = this.#frame;
    if (!this.#lib.symbols.libretroarch_frame(ptr(out))) return;
    const at = ptr(out);
    const height = read.u32(at, 20);
    const pitch = read.u32(at, 24);
    return {
      serial: read.u64(at, 0),
      width: read.u32(at, 16),
      height,
      pitch,
      format: read.u32(at, 28) as PixelFormat,
      data: new Uint8Array(
        toArrayBuffer(read.ptr(at, 8) as Pointer, 0, pitch * height),
      ),
    };
  }

  status(): Status {
    const at = ptr(this.#status);
    this.#lib.symbols.libretroarch_status(at);
    const flags = read.u32(at, 20);
    return {
      fps: read.f64(at, 0),
      coreSampleRate: read.f64(at, 8),
      audioRate: read.u32(at, 16),
      coreRunning: (flags & 1) !== 0,
      paused: (flags & 2) !== 0,
      menu: (flags & 4) !== 0,
      fastForward: (flags & 8) !== 0,
    };
  }

  /** Interleaved stereo float frames at {@link Status.audioRate}, as an AudioWorklet takes them. */
  audio(out = new Float32Array(8192)): Float32Array {
    const frames = Number(
      this.#lib.symbols.libretroarch_audio_read(
        ptr(out),
        BigInt(out.length >> 1),
      ),
    );
    return out.subarray(0, frames * 2);
  }

  /** axes: left x, left y, right x, right y, L2, R2 in [-0x7fff, 0x7fff]. */
  joypad(port: number, buttons: number, axes: ArrayLike<number> = []): void {
    const values = this.#axes;
    values.fill(0);
    for (let i = 0; i < Math.min(axes.length, values.length); i++)
      values[i] = axes[i]!;
    this.#lib.symbols.libretroarch_joypad(
      port,
      buttons >>> 0,
      ptr(values),
      values.length,
    );
  }

  /** A RetroArch network command ("PAUSE_TOGGLE", "SAVE_STATE", "READ_CORE_MEMORY 0x100 16"). */
  command(line: string): void {
    if (!this.#lib.symbols.libretroarch_command(Buffer.from(`${line}\0`)))
      throw new Error("libretroarch command queue is full");
  }

  /** Replies to earlier commands, as they came. */
  replies(): string {
    const at = ptr(this.#reply);
    const length = Number(
      this.#lib.symbols.libretroarch_command_reply(
        at,
        BigInt(this.#reply.length),
      ),
    );
    return length ? new CString(at, 0, length).toString() : "";
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#lib.symbols.libretroarch_deinit();
    this.#lib.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
