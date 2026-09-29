import "./setup";
import { describe, it, expect } from "bun:test";
import { container } from "tsyringe";
import { BxcBridgeService } from "../src/services/BxcBridgeService";

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

  it("translates text using multi-provider fallback", async () => {
    const service = container.resolve(BxcBridgeService);
    const res = await service.translate("Kamehameha", "fr", "ja");
    expect(res).toHaveProperty("translatedText");
    expect(res.translatedText.length).toBeGreaterThan(0);
  });
});
