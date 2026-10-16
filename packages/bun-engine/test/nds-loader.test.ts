import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NintendoDsFirmware } from "../src/nds/loader";

async function fixture(path: string, bytes: number, seed: number): Promise<void> {
  const data = new Uint8Array(bytes);
  for (let index = 0; index < data.length; index++) data[index] = (index + seed) & 0xff;
  await Bun.write(path, data);
}

describe("Nintendo DS firmware loader", () => {
  test("maps ARM7, ARM9, SPI firmware and GBA BIOS ranges", async () => {
    const root = await mkdtemp(join(tmpdir(), "bun-engine-ds-"));
    try {
      await Promise.all([
        fixture(join(root, "biosnds7.rom"), 16 * 1024, 7),
        fixture(join(root, "biosnds9.rom"), 4 * 1024, 9),
        fixture(join(root, "firmware.bin"), 256 * 1024, 11),
        fixture(join(root, "BIOSGBA.ROM"), 16 * 1024, 13),
      ]);
      const loader = await NintendoDsFirmware.load(root);
      expect(loader.readArm7(0, 4)).toEqual(new Uint8Array([7, 8, 9, 10]));
      expect(loader.readArm9(0xffff0000, 4)).toEqual(new Uint8Array([9, 10, 11, 12]));
      expect(loader.readFirmwareSpi(4, 3)).toEqual(new Uint8Array([15, 16, 17]));
      expect(loader.readGbaBios(0, 2)).toEqual(new Uint8Array([13, 14]));
      expect(() => loader.readArm9(0, 4)).toThrow(RangeError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("loads the owner's local hardware dumps when present", async () => {
    const root = join(import.meta.dir, "..", "..", "..", "bin");
    if (!(await Bun.file(join(root, "firmware.bin")).exists())) return;
    const loader = await NintendoDsFirmware.load(root);
    expect(loader.summary()).toMatchObject({
      arm7: { bytes: 16 * 1024 },
      arm9: { bytes: 4 * 1024 },
      firmware: { bytes: 256 * 1024 },
      gba: { bytes: 16 * 1024 },
    });
    expect(loader.readArm7(0, 4)).toHaveLength(4);
    expect(loader.readArm9(0xffff0000, 4)).toHaveLength(4);
  });
});
