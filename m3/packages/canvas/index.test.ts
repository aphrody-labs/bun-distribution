import { describe, expect, test } from "bun:test";
import {
  aphrodyCanvasRuntime,
  createM3CanvasSurface,
  isBrowserCanvasAvailable,
  selectCanvasBackend,
} from "./site";

describe("@aphrody/canvas contract", () => {
  test("exposes the Aphrody runtime marker", () =>
    expect(aphrodyCanvasRuntime).toBe("aphrody-canvas/skia"));
  test("selects a deterministic backend", () => {
    expect(selectCanvasBackend("native-skia")).toBe("native-skia");
    expect(selectCanvasBackend("browser")).toBe("browser");
    expect(selectCanvasBackend()).toBe(isBrowserCanvasAvailable() ? "browser" : "native-skia");
  });
  test("provides M3 defaults without a UI framework", () => {
    expect(createM3CanvasSurface({ density: "expanded", colorScheme: "dark" })).toEqual({
      color: "var(--md-sys-color-surface, #fffbfe)",
      pixelRatio: 1,
      density: "expanded",
      colorScheme: "dark",
    });
  });
});
