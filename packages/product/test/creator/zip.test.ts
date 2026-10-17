import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { buildZip, crc32 } = require("../../resources/creator/web/image-compressor/zip.js") as {
  buildZip(files: { name: string; data: Uint8Array }[], now?: Date): Uint8Array;
  crc32(bytes: Uint8Array): number;
};

test("crc32 matches the reference vector", () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
});

test("buildZip produces an archive that unzip/bsdtar can read back", async () => {
  const files = [
    { name: "a.webp", data: new TextEncoder().encode("hello") },
    { name: "b.png", data: new Uint8Array([1, 2, 3, 4]) },
  ];
  const dir = await mkdtemp(join(tmpdir(), "zip-"));
  const path = join(dir, "t.zip");
  await Bun.write(path, buildZip(files, new Date(2026, 9, 6, 12, 0, 0)));
  const tool = Bun.which("unzip") ? ["unzip", "-p"] : Bun.which("bsdtar") ? ["bsdtar", "-xOf"] : undefined;
  if (!tool) {
    // No extractor on this host: at least check the end-of-central-directory record.
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteLength - 22);
    expect(view.getUint32(0, true)).toBe(0x06054b50);
    expect(view.getUint16(10, true)).toBe(2);
    return;
  }
  const out = Bun.spawnSync([...tool, path, "a.webp"], { windowsHide: true });
  expect(out.stdout.toString()).toBe("hello");
});
