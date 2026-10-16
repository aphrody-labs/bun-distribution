import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importFirmware } from "../src/firmware/import";

describe("local firmware proof of concept", () => {
  test("imports a user dump into a hash-addressed protected store", async () => {
    const root = await mkdtemp(join(tmpdir(), "bun-engine-firmware-"));
    try {
      const source = join(root, "test-bios.bin");
      const store = join(root, "protected");
      await Bun.write(source, new Uint8Array([0x42, 0x55, 0x4e]));
      const manifest = await importFirmware("Nintendo DS", source, store);

      expect(manifest.console).toBe("nintendo-ds");
      expect(manifest.bytes).toBe(3);
      expect(manifest.sha256).toHaveLength(64);
      expect(await Bun.file(join(store, "nintendo-ds", manifest.file)).bytes()).toEqual(
        new Uint8Array([0x42, 0x55, 0x4e]),
      );
      expect(await Bun.file(join(store, "nintendo-ds", `${manifest.sha256}.json`)).json()).toMatchObject({
        sha256: manifest.sha256,
        bytes: 3,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
