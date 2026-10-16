import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probeMedia } from "../src/native-capabilities";

describe("native Bun media capabilities", () => {
  test("probes an image through Bun.Image", async () => {
    const path = join(tmpdir(), `bun-engine-${Bun.randomUUIDv7()}.png`);
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
      byte => byte.charCodeAt(0),
    );
    try {
      await Bun.write(path, png);
      const result = await probeMedia(path);
      expect(result.kind).toBe("image");
      expect(result.metadata).toMatchObject({ width: 1, height: 1 });
    } finally {
      await rm(path, { force: true });
    }
  });
});
