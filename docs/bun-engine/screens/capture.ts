// Headless capture through the real binding: bun capture.ts <core.so> <content|-> <frames> <out.png> [press=START@120+6,A@180+6]
// RetroArch is driven in process (packages/bun-engine/src/libretroarch.ts); the last frame is written as a PNG.
import { deflateSync } from "node:zlib";
import { Button, PixelFormat, RetroArch, toRGBA } from "../../../packages/bun-engine/src/libretroarch";

const [core, content, frames, out, script = ""] = process.argv.slice(2);
const home = process.env.CAPTURE_HOME ?? `/tmp/capture-home-${process.pid}`;
const config: Record<string, string> = {};
if (process.env.LIBRETRO_INFO) config.libretro_info_path = process.env.LIBRETRO_INFO;
if (process.env.CAPTURE_LOG) config.log_verbosity = "true";
if (process.env.LIBRETRO_SYSTEM) config.system_directory = process.env.LIBRETRO_SYSTEM;
const library = process.env.LIBRETROARCH_LIB;

// "NAME@from+length" pairs, e.g. Start@120+6
const presses = script.split(",").filter(Boolean).map(part => {
  const [name, span] = part.split("@");
  const [from, len] = span!.split("+").map(Number);
  return { mask: Button[name as keyof typeof Button], from: from!, to: from! + len! };
});

function png(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length);
    body.set(new TextEncoder().encode(type));
    body.set(data, 4);
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(8 + data.length, crc(body));
    return out;
  };
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, d = y * (width * 3 + 1) + 1 + x * 3;
      raw[d] = rgba[s]!; raw[d + 1] = rgba[s + 1]!; raw[d + 2] = rgba[s + 2]!;
    }
  const head = new Uint8Array(13);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, width); hv.setUint32(4, height); head[8] = 8; head[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array())];
  return Buffer.concat(parts);
}

const ra = RetroArch.open({ library, core: core!, content: content === "-" ? undefined : content, home, config });
let frame, n = 0;
for (; n < Number(frames); n++) {
  ra.joypad(0, presses.reduce((m, p) => (n >= p.from && n < p.to ? m | p.mask : m), 0));
  if (!ra.iterate()) break;
  frame = ra.frame() ?? frame;
}
if (!frame) throw new Error("no frame");
const rgba = toRGBA(frame);
let lit = 0;
for (let i = 0; i < rgba.length; i += 4) if (rgba[i] | rgba[i + 1] | rgba[i + 2]) lit++;
let bytes: Uint8Array = png(frame.width, frame.height, rgba);
const scale = Number(process.env.SCALE ?? 1);
if (scale > 1) bytes = await new Bun.Image(bytes).resize(frame.width * scale, frame.height * scale, { filter: "nearest" }).png().bytes();
await Bun.write(out!, bytes);
console.log(JSON.stringify({ out, frames: n, width: frame.width, height: frame.height, format: PixelFormat[frame.format], litPixels: lit, bytes: bytes.length, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") }));
ra.close();
