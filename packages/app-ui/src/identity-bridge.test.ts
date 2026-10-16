// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { createIdentityBridge, type Invoke } from "./identity-bridge";

function recorder() {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const invoke: Invoke = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ) => {
    calls.push({ command, args });
    return undefined as T;
  };
  return { calls, bridge: createIdentityBridge(invoke) };
}

describe("identity bridge", () => {
  test("pet commands use the Rust command names", async () => {
    const { calls, bridge } = recorder();
    await bridge.petState();
    await bridge.petFramePngBase64("idle", 2);
    expect(calls).toEqual([
      { command: "aphrody_pet_etat", args: undefined },
      {
        command: "aphrody_pet_frame_png_b64",
        args: { animation: "idle", index: 2 },
      },
    ]);
  });

  test("measure maps options onto the command parameters and defaults the mask to alpha", async () => {
    const { calls, bridge } = recorder();
    await bridge.measure("C:/logo.png", {
      paletteSize: 5,
      bounds: [0, 0, 10, 10],
      hueMin: 10,
    });
    expect(calls[0]).toEqual({
      command: "aphrody_pixel_mesurer",
      args: {
        chemin: "C:/logo.png",
        k: 5,
        boite: [0, 0, 10, 10],
        mode: "alpha",
        seuil: null,
        teinteMin: 10,
        teinteMax: null,
        saturation: null,
      },
    });
  });

  test("sheet, compare, vectorize and palette CSS pass their arguments", async () => {
    const { calls, bridge } = recorder();
    await bridge.spriteSheet(["a.png", "b.png"], "icons", 4);
    await bridge.compare("a.png", "b.png");
    await bridge.vectorize("a.png", { mode: "sombre", threshold: 40 });
    await bridge.paletteCss("a.png", "brand");
    expect(calls.map((c) => c.command)).toEqual([
      "aphrody_pixel_planche",
      "aphrody_pixel_comparer",
      "aphrody_pixel_vectoriser",
      "aphrody_pixel_tokens_css",
    ]);
    expect(calls[0]?.args).toEqual({
      chemins: ["a.png", "b.png"],
      colonnes: 4,
      nom: "icons",
    });
    expect(calls[1]?.args).toEqual({ a: "a.png", b: "b.png", tolerance: null });
    expect(calls[2]?.args).toEqual({
      chemin: "a.png",
      k: null,
      tolerance: null,
      mode: "sombre",
      seuil: 40,
    });
    expect(calls[3]?.args).toEqual({
      chemin: "a.png",
      prefixe: "brand",
      k: null,
    });
  });
});
