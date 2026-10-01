import "./setup";
import { describe, it, expect } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { container } from "tsyringe";
import { BxcBridgeService } from "../src/services/BxcBridgeService";

async function withAphrodyBin<T>(source: string, run: () => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "shenron-bxc-translate-"));
  const bin = join(directory, "aphrody-translate");
  const previousBin = process.env.APHRODY_BIN;
  writeFileSync(bin, `#!${process.execPath}\n${source}\n`);
  chmodSync(bin, 0o755);
  process.env.APHRODY_BIN = bin;

  try {
    return await run();
  } finally {
    if (previousBin === undefined) delete process.env.APHRODY_BIN;
    else process.env.APHRODY_BIN = previousBin;
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("BxcBridgeService (Bot DI)", () => {
  it("resolves via tsyringe container and checks status", async () => {
    const service = container.resolve(BxcBridgeService);
    expect(service).toBeDefined();

    const status = await service.getStatus();
    expect(status.available).toBe(true);
    expect(status.binaryPath.length).toBeGreaterThan(0);
    expect(status.version?.length).toBeGreaterThan(0);
  });

  it("queries dragonballcn catalog via bot service", async () => {
    const service = container.resolve(BxcBridgeService);
    const catalog = await service.getDragonballCnCatalog("full_color");
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].id).toBe("0-10-1");
  });

  it("queries local frames index stats via bot service", async () => {
    const service = container.resolve(BxcBridgeService);
    const stats = await service.getFramesStats();
    expect(stats).toHaveProperty("frames");
    expect(stats.frames).toBeGreaterThanOrEqual(0);
    expect(stats.media).toBeGreaterThanOrEqual(0);
    if (Bun.env.BXC_FRAMES_DB) expect(stats.frames).toBeGreaterThan(0);
  });

  it.skipIf(process.platform === "win32")(
    "delegates translation to the Aphrody owner",
    async () => {
      await withAphrodyBin(
        `const args = process.argv.slice(2);
if (args[0] !== "translate" || !args.includes("--json") || args.at(-2) !== "--") process.exit(2);
const source = args[args.indexOf("--source") + 1];
const target = args[args.indexOf("--target") + 1];
if (source !== "ja" || target !== "fr" || args.at(-1) !== "Kamehameha") process.exit(3);
console.log(JSON.stringify({ translatedText: "Kamehameha traduit", detectedSource: source, target, provider: "aphrody-translate" }));`,
        async () => {
          const service = container.resolve(BxcBridgeService);
          await expect(service.translate("Kamehameha", "fr", "ja")).resolves.toEqual({
            translatedText: "Kamehameha traduit",
            detectedSource: "ja",
            target: "fr",
            provider: "aphrody-translate",
          });
        },
      );
    },
  );

  it.skipIf(process.platform === "win32")("propagates translation owner failures", async () => {
    await withAphrodyBin(
      'console.error("translation backend unavailable"); process.exit(7);',
      async () => {
        const service = container.resolve(BxcBridgeService);
        await expect(service.translate("Kamehameha", "fr", "ja")).rejects.toThrow(
          "exited 7: translation backend unavailable",
        );
      },
    );
  });
});
