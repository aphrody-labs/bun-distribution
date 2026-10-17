import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { deflateSync } from "node:zlib";

import { compressFile, targetFormat, type Options } from "../../src/creator/commands/img-compress.ts";

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(Bun.hash.crc32(body) >>> 0, 8 + data.length);
  return out;
}

/** 64x64 RGB gradient stored with deflate level 0: large on purpose. */
function bigPng(): Buffer {
  const size = 64;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = x * 4;
      raw[i + 1] = y * 4;
      raw[i + 2] = 128;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const options: Options = {
  format: "keep",
  quality: 80,
  pngColors: 64,
  pngLossless: false,
  minGain: 3,
};

test("targetFormat keeps the source format unless one is requested", () => {
  expect(targetFormat("a.PNG", "keep")).toBe("png");
  expect(targetFormat("a.jpeg", "keep")).toBe("jpeg");
  expect(targetFormat("a.png", "webp")).toBe("webp");
});

test("compressFile writes a smaller copy and never touches the original", async () => {
  const dir = await mkdtemp(join(tmpdir(), "img-"));
  const source = join(dir, "pic.png");
  const original = bigPng();
  await Bun.write(source, original);
  const place = (s: string) => join(dir, "compressed", basename(s));
  const outcome = await compressFile(source, options, place, false);
  expect(outcome.status).toBe("written");
  expect(outcome.after).toBeLessThan(outcome.before);
  expect(await readdir(join(dir, "compressed"))).toEqual(["pic.png"]);
  expect((await readFile(source)).equals(original)).toBe(true);
});

test("webp conversion changes the extension", async () => {
  const dir = await mkdtemp(join(tmpdir(), "img-"));
  const source = join(dir, "pic.png");
  await Bun.write(source, bigPng());
  const outcome = await compressFile(
    source,
    { ...options, format: "webp" },
    (s, format) => join(dir, "out", `${basename(s, ".png")}.${format}`),
    false,
  );
  expect(outcome.status).toBe("written");
  expect(outcome.dest?.endsWith(".webp")).toBe(true);
});
