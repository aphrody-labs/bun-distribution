import { describe, expect, test } from "bun:test";
import {
  GlobalFonts,
  createCanvas,
  createNativeCanvas,
  loadNativeCanvas,
  loadNativeImage,
  type SKRSContext2D,
} from "./index";

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

describe("@aphrody/canvas native Skia runtime", () => {
  test("root re-exports and loadNativeCanvas() share one upstream module", async () => {
    const native = await loadNativeCanvas();
    expect(native.createCanvas).toBe(createCanvas);
    expect(native.GlobalFonts).toBe(GlobalFonts);
  });

  test("draws and encodes PNG, WebP and AVIF", async () => {
    const canvas = await createNativeCanvas(96, 48);
    const ctx: SKRSContext2D = canvas.getContext("2d");
    ctx.fillStyle = "#6750a4";
    ctx.fillRect(0, 0, 96, 48);
    ctx.fillStyle = "#ffffff";
    ctx.font = "16px sans-serif";
    ctx.fillText("M3", 8, 30);

    const png = await canvas.encode("png");
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const webp = await canvas.encode("webp", 90);
    expect(ascii(webp, 0, 4) + ascii(webp, 8, 12)).toBe("RIFFWEBP");
    const avif = await canvas.encode("avif", { quality: 80 });
    expect(ascii(avif, 4, 12)).toBe("ftypavif");

    const image = await loadNativeImage(png);
    expect([image.width, image.height]).toEqual([96, 48]);
    const [r, g, b] = ctx.getImageData(90, 2, 1, 1).data;
    expect([r, g, b]).toEqual([0x67, 0x50, 0xa4]);
  });
});
