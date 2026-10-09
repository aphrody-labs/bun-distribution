import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const ROOT = path.resolve(import.meta.dir, "../../../../crates/ui/identity/assets/aphrody");
const OUT = path.resolve(import.meta.dir, "../assets/icons");
const SVG_CANVAS = 32;
const SVG_CONTENT = 28;
const SVG_VIEWBOX = 24;
const SVG_THRESHOLD = 0.5;
const ICO_SIZES = [16, 24, 32, 48, 256];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Rect = { x: number; y: number; width: number; height: number };
type Frame = { index: number; atlasRect: Rect; alphaBoundsInCell: Rect };
type Animation = { frames: Frame[] };
type Animations = {
  pet: { id: string };
  atlas: { image: string; width: number; height: number; pngSha256: string };
  animations: Record<string, Animation>;
};
type Image = { width: number; height: number; data: Uint8Array };

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePng(buf: Uint8Array): Image {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  let pos = 8;
  while (pos < buf.length) {
    const len = view.getUint32(pos);
    const type = Buffer.from(buf.subarray(pos + 4, pos + 8)).toString("latin1");
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      if (buf[pos + 16] !== 8 || buf[pos + 17] !== 6 || buf[pos + 20] !== 0) {
        throw new Error("PNG attendu : RGBA 8 bits, non entrelacé");
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? (cur[i - 4] ?? 0) : 0;
      const b = prev[i] ?? 0;
      const c = i >= 4 ? (prev[i - 4] ?? 0) : 0;
      let predicted: number;
      switch (filter) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = a;
          break;
        case 2:
          predicted = b;
          break;
        case 3:
          predicted = (a + b) >> 1;
          break;
        case 4:
          predicted = paeth(a, b, c);
          break;
        default:
          throw new Error(`filtre PNG inconnu : ${filter}`);
      }
      cur[i] = ((line[i] ?? 0) + predicted) & 255;
    }
    prev = cur;
  }
  return { width, height, data: out };
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(Bun.hash.crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(image: Image): Buffer {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function crop(source: Image, rect: Rect): Image {
  const data = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const from = ((rect.y + y) * source.width + rect.x) * 4;
    data.set(source.data.subarray(from, from + rect.width * 4), y * rect.width * 4);
  }
  return { width: rect.width, height: rect.height, data };
}

// Box-filter resample of `src` into a square canvas, content scaled to fit `content` px and centred.
// Colour is averaged premultiplied by coverage, so transparent pixels do not bleed into edges.
function fit(src: Image, canvas: number, content: number): Image {
  const scale = Math.min(content / src.width, content / src.height);
  const dw = Math.max(1, Math.round(src.width * scale));
  const dh = Math.max(1, Math.round(src.height * scale));
  const ox = Math.floor((canvas - dw) / 2);
  const oy = Math.floor((canvas - dh) / 2);
  const out = new Uint8Array(canvas * canvas * 4);
  const sx = src.width / dw;
  const sy = src.height / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * sy;
    const y1 = (dy + 1) * sy;
    for (let dx = 0; dx < dw; dx++) {
      const x0 = dx * sx;
      const x1 = (dx + 1) * sx;
      let weight = 0;
      let alpha = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const w = wy * (Math.min(x + 1, x1) - Math.max(x, x0));
          const p = (y * src.width + x) * 4;
          const a = (src.data[p + 3] ?? 0) / 255;
          weight += w;
          alpha += w * a;
          r += w * a * (src.data[p] ?? 0);
          g += w * a * (src.data[p + 1] ?? 0);
          b += w * a * (src.data[p + 2] ?? 0);
        }
      }
      const o = ((oy + dy) * canvas + ox + dx) * 4;
      out[o + 3] = Math.round((alpha / weight) * 255);
      if (alpha > 0) {
        out[o] = Math.round(r / alpha);
        out[o + 1] = Math.round(g / alpha);
        out[o + 2] = Math.round(b / alpha);
      }
    }
  }
  return { width: canvas, height: canvas, data: out };
}

function monochromePath(image: Image): { d: string; cells: number } {
  const unit = SVG_VIEWBOX / SVG_CANVAS;
  const n = (v: number) => Number((v * unit).toFixed(2));
  const covered = (x: number, y: number) => (image.data[(y * image.width + x) * 4 + 3] ?? 0) / 255 >= SVG_THRESHOLD;
  let d = "";
  let cells = 0;
  for (let y = 0; y < image.height; y++) {
    let x = 0;
    while (x < image.width) {
      if (!covered(x, y)) {
        x++;
        continue;
      }
      const start = x;
      while (x < image.width && covered(x, y)) x++;
      d += `M${n(start)} ${n(y)}H${n(x)}V${n(y + 1)}H${n(start)}z`;
      cells += x - start;
    }
  }
  return { d, cells };
}

function encodeIco(entries: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach((entry, i) => {
    const at = 6 + 16 * i;
    header[at] = entry.size === 256 ? 0 : entry.size;
    header[at + 1] = entry.size === 256 ? 0 : entry.size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(entry.png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });
  return Buffer.concat([header, ...entries.map(entry => entry.png)]);
}

const animationsDoc = JSON.parse(await readFile(path.join(ROOT, "animations.json"), "utf8")) as Animations;
const sourcePath = path.join(ROOT, animationsDoc.atlas.image);
const sourceBytes = new Uint8Array(await readFile(sourcePath));
const sourceHash = sha256(sourceBytes);
if (sourceHash !== animationsDoc.atlas.pngSha256) {
  throw new Error(`empreinte du PNG source inattendue : ${sourceHash}`);
}
const atlas = decodePng(sourceBytes);
if (atlas.width !== animationsDoc.atlas.width || atlas.height !== animationsDoc.atlas.height) {
  throw new Error("dimensions du PNG source différentes de animations.json");
}

await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, "svg"), { recursive: true });
await mkdir(path.join(OUT, "ico"), { recursive: true });

const outputs = new Map<string, Buffer | string>();
const icons: {
  name: string;
  animation: string;
  frame: number;
  svg: string;
  cssClass: string;
  atlasRect: Rect;
  cells: number;
}[] = [];
const icos: { animation: string; file: string; sizes: number[] }[] = [];

for (const [animation, def] of Object.entries(animationsDoc.animations)) {
  for (const frame of def.frames) {
    const cell = crop(atlas, frame.atlasRect);
    const bounds = frame.alphaBoundsInCell;
    const content = crop(cell, bounds);
    const name = `aphrody-${animation}-${String(frame.index).padStart(2, "0")}`;
    if (outputs.has(`svg/${name}.svg`)) throw new Error(`nom d'icône dupliqué : ${name}`);

    const mask = fit(content, SVG_CANVAS, SVG_CONTENT);
    const { d, cells } = monochromePath(mask);
    if (cells === 0) throw new Error(`silhouette vide : ${name}`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_VIEWBOX} ${SVG_VIEWBOX}" width="${SVG_VIEWBOX}" height="${SVG_VIEWBOX}"><path fill="currentColor" d="${d}"/></svg>\n`;
    outputs.set(`svg/${name}.svg`, svg);
    icons.push({
      name,
      animation,
      frame: frame.index,
      svg: `svg/${name}.svg`,
      cssClass: `aphrody-icon--${name}`,
      atlasRect: frame.atlasRect,
      cells,
    });
  }

  const first = def.frames[0]!;
  const content = crop(crop(atlas, first.atlasRect), first.alphaBoundsInCell);
  const sizes = ICO_SIZES.map(size => {
    const png = encodePng(fit(content, size, size));
    return { size, png };
  });
  const file = `ico/aphrody-${animation}.ico`;
  outputs.set(file, encodeIco(sizes));
  icos.push({ animation, file, sizes: ICO_SIZES });
}

const cssRules = [
  ".aphrody-icon {",
  "  display: inline-block;",
  "  flex: none;",
  "  width: 24px;",
  "  height: 24px;",
  "  background-color: var(--aphrody-icon-color, var(--md-sys-color-on-surface, #1d1b20));",
  "  -webkit-mask: var(--aphrody-icon-mask) center / contain no-repeat;",
  "  mask: var(--aphrody-icon-mask) center / contain no-repeat;",
  "}",
  ".aphrody-icon--primary { --aphrody-icon-color: var(--md-sys-color-primary, #6750a4); }",
  ".aphrody-icon--on-surface-variant { --aphrody-icon-color: var(--md-sys-color-on-surface-variant, #49454f); }",
  ".aphrody-icon--outline { --aphrody-icon-color: var(--md-sys-color-outline, #79747e); }",
  ...icons.map(icon => `.${icon.cssClass} { --aphrody-icon-mask: url("${icon.svg}"); }`),
];
outputs.set("aphrody-icons.css", cssRules.join("\n") + "\n");

const index = {
  schemaVersion: 1,
  pet: animationsDoc.pet.id,
  source: animationsDoc.atlas.image,
  icons,
  ico: icos,
};
outputs.set("index.json", JSON.stringify(index, null, 2) + "\n");

const manifestOutputs = [...outputs.entries()]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([file, content]) => {
    const bytes = typeof content === "string" ? Buffer.from(content) : content;
    return { path: file, sha256: sha256(bytes), bytes: bytes.length };
  });

const manifest = {
  schemaVersion: 1,
  generator: "m3/packages/identity/scripts/icons.ts",
  source: {
    image: animationsDoc.atlas.image,
    sha256: sourceHash,
    animations: Object.keys(animationsDoc.animations).length,
    frames: icons.length,
  },
  parameters: {
    svgViewBox: SVG_VIEWBOX,
    svgCanvas: SVG_CANVAS,
    svgContent: SVG_CONTENT,
    svgThreshold: SVG_THRESHOLD,
    icoSizes: ICO_SIZES,
  },
  outputs: manifestOutputs,
};
outputs.set("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

for (const [file, content] of outputs) {
  await Bun.write(path.join(OUT, file), content);
}

console.log(
  `${icons.length} icônes SVG, ${icos.length} ICO, ${outputs.size} fichiers dans ${path.relative(process.cwd(), OUT)}`,
);
